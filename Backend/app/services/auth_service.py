"""Serviços de autenticação, sessão e utilitários gerais."""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, TypeVar

import secrets
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import _hash_pin
from app.models.sessao import SessaoAuth
from app.models.utilizador import Utilizador

logger = logging.getLogger(__name__)
ModeloT = TypeVar("ModeloT")

TOKEN_TTL_MINUTOS: int = settings.ACCESS_TOKEN_EXPIRE_MINUTES
PIN_INICIAL = "0000"

# deque(maxlen=500): evicção automática O(1) quando cheio (list seria O(n))
_logs_auth: deque[dict] = deque(maxlen=500)


# ─── Utilitários de tempo ─────────────────────────────────────────────────────

def agora_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ─── Utilitários de utilizador ────────────────────────────────────────────────

def iniciais_nome(nome: str) -> str:
    partes = [p for p in nome.split() if p]
    if not partes:
        return ""
    if len(partes) == 1:
        return partes[0][0].upper()
    return f"{partes[0][0]}{partes[-1][0]}".upper()


def iniciais_utilizador(utilizador: Optional[Utilizador]) -> str:
    if not utilizador:
        return ""
    if utilizador.iniciais:
        return utilizador.iniciais
    return iniciais_nome(utilizador.nome or "")


# ─── Utilitários genéricos ────────────────────────────────────────────────────

def obter_ou_404(session: Session, modelo: type[ModeloT], identificador: int, detalhe: str) -> ModeloT:
    item = session.get(modelo, identificador)
    if not item:
        raise HTTPException(status_code=404, detail=detalhe)
    return item


def persistir_sessao(session: Session, detalhe_erro: str) -> None:
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Falha transacional: %s", detalhe_erro)
        raise HTTPException(status_code=503, detail=detalhe_erro) from exc


def validar_formato_pin(pin: str) -> None:
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN deve ter exatamente 4 dígitos")


def normalizar_pin(pin: str) -> str:
    return pin.strip()


def validar_dias(dias: int) -> int:
    if dias < 1 or dias > 365:
        raise HTTPException(status_code=400, detail="O parâmetro 'dias' deve estar entre 1 e 365")
    return dias


# ─── Logging de autenticação ──────────────────────────────────────────────────

def registar_log(acao: str, sucesso: bool, detalhe: str, utilizador_id: Optional[int] = None) -> None:
    _logs_auth.append({
        "timestamp": iso_z(agora_utc()),
        "acao": acao,
        "sucesso": sucesso,
        "detalhe": detalhe,
        "utilizador_id": utilizador_id,
    })


def registar_log_bd(
    session: Session,
    acao: str,
    sucesso: bool,
    detalhe: str,
    utilizador_id: Optional[int] = None,
    utilizador_nome: Optional[str] = None,
    role: Optional[str] = None,
    entidade: Optional[str] = None,
    entidade_id: Optional[int] = None,
) -> None:
    """Persiste registo de auditoria na BD.

    Erros de escrita são ignorados (não bloqueiam a operação principal).
    Rollback explícito: um flush falhado deixa a sessão em estado inválido;
    sem rollback, o commit do endpoint lançaria InvalidRequestError.
    """
    from app.models.log import Log  # importação local — evita circular no topo

    try:
        entrada = Log(
            utilizador_id=utilizador_id,
            utilizador_nome=utilizador_nome,
            role=role,
            acao=acao,
            entidade=entidade,
            entidade_id=entidade_id,
            detalhe=detalhe,
            sucesso=sucesso,
        )
        session.add(entrada)
        session.flush()
    except SQLAlchemyError:
        logger.warning("Falha ao persistir log de auditoria para acção '%s'", acao)
        try:
            session.rollback()
        except Exception:
            pass


def obter_logs_auth() -> list[dict]:
    return list(reversed(_logs_auth))


# ─── Criação e limpeza de sessões ─────────────────────────────────────────────

def criar_sessao_auth(utilizador: Utilizador, session: Session) -> dict[str, Any]:
    """Cria e persiste nova sessão de autenticação.

    Persistência em BD garante resiliência a reinícios de servidor.
    """
    try:
        token = secrets.token_urlsafe(32)
        expira_em = agora_utc() + timedelta(minutes=TOKEN_TTL_MINUTOS)
        sessao = SessaoAuth(
            token=token,
            utilizador_id=utilizador.id,
            role=utilizador.role,
            expira_em=expira_em,
        )
        session.add(sessao)
        session.commit()
        return {
            "token": token,
            "expira_em": iso_z(expira_em),
            "expira_em_epoch_ms": int(expira_em.timestamp() * 1000),
        }
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Falha ao criar sessão de autenticação para utilizador %d", utilizador.id)
        raise HTTPException(status_code=503, detail="Falha ao criar sessão de autenticação") from exc


def limpar_sessoes_expiradas(session: Session) -> int:
    try:
        agora = agora_utc()
        sessoes = session.exec(select(SessaoAuth).where(SessaoAuth.expira_em <= agora)).all()
        for s in sessoes:
            session.delete(s)
        if sessoes:
            session.commit()
            logger.info("Removidas %d sessões expiradas de autenticação", len(sessoes))
        return len(sessoes)
    except SQLAlchemyError:
        session.rollback()
        logger.exception("Erro ao limpar sessões expiradas")
        return 0


# ─── Lógica de reservas enriquecidas (usada em reservas e PDF) ────────────────

def listar_reservas_enriquecidas(session: Session) -> list[dict[str, Any]]:
    from app.models.reserva import Reserva
    from app.models.equipamento import Equipamento
    from app.models.sessao import SessaoUso

    reservas = session.exec(select(Reserva)).all()
    if not reservas:
        return []

    reserva_ids = {r.id for r in reservas}
    equipamento_ids = {r.equipamento_id for r in reservas}
    utilizador_ids = {r.utilizador_id for r in reservas}

    equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all()
    utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all()
    sessoes = session.exec(select(SessaoUso).where(SessaoUso.reserva_id.in_(reserva_ids))).all()
    sessoes_adhoc = session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id.in_(equipamento_ids),
            SessaoUso.reserva_id.is_(None),
            SessaoUso.fim.is_(None),
        )
    ).all()

    equipamentos_por_id = {e.id: e for e in equipamentos}
    utilizadores_por_id = {u.id: u for u in utilizadores}

    sessao_por_reserva: dict[int, SessaoUso] = {}
    for s in sessoes:
        if s.reserva_id is not None:
            anterior = sessao_por_reserva.get(s.reserva_id)
            if anterior is None or s.inicio > anterior.inicio:
                sessao_por_reserva[s.reserva_id] = s

    sessao_adhoc_por_equipamento: dict[int, SessaoUso] = {}
    for s in sessoes_adhoc:
        anterior = sessao_adhoc_por_equipamento.get(s.equipamento_id)
        if anterior is None or s.inicio > anterior.inicio:
            sessao_adhoc_por_equipamento[s.equipamento_id] = s

    resultado: list[dict[str, Any]] = []
    for r in reservas:
        eq = equipamentos_por_id.get(r.equipamento_id)
        ut = utilizadores_por_id.get(r.utilizador_id)
        sess = sessao_por_reserva.get(r.id)

        if sess is None or sess.fim is not None:
            adhoc = sessao_adhoc_por_equipamento.get(r.equipamento_id)
            if adhoc is not None and r.data_inicio <= adhoc.inicio <= r.data_fim:
                sess = adhoc

        resultado.append({
            "id": r.id,
            "equipamento_id": r.equipamento_id,
            "equipamento_nome": eq.nome if eq else "—",
            "equipamento_codigo": eq.codigo if eq else "—",
            "utilizador_id": r.utilizador_id,
            "utilizador_nome": ut.nome if ut else "—",
            "utilizador_iniciais": iniciais_utilizador(ut),
            "projeto": r.projeto,
            "metodo": r.metodo,
            "data_inicio": r.data_inicio,
            "data_fim": r.data_fim,
            "notas": r.notas,
            "sessao_inicio": sess.inicio if sess else None,
            "sessao_fim": sess.fim if sess else None,
            "esta_ativa": sess is not None and sess.fim is None,
        })
    return resultado


# ─── Validações de reserva ────────────────────────────────────────────────────

def validar_intervalo_reserva(data_inicio: datetime, data_fim: datetime) -> None:
    if data_fim <= data_inicio:
        raise HTTPException(status_code=400, detail="A data de fim tem de ser posterior à data de início")
    for campo, valor in (("data_inicio", data_inicio), ("data_fim", data_fim)):
        if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
            raise HTTPException(status_code=400, detail=f"{campo} deve estar alinhado à hora cheia (ex: 09:00)")
    duracao_s = (data_fim - data_inicio).total_seconds()
    if duracao_s < 3600:
        raise HTTPException(status_code=400, detail="A reserva mínima é de 1 hora")
    if duracao_s % 3600 != 0:
        raise HTTPException(status_code=400, detail="A duração da reserva deve ser em horas inteiras")


def validar_colisao_reserva(
    session: Session,
    equipamento_id: int,
    data_inicio: datetime,
    data_fim: datetime,
    reserva_id: Optional[int] = None,
) -> None:
    from app.models.reserva import Reserva

    consulta = select(Reserva).where(
        Reserva.equipamento_id == equipamento_id,
        Reserva.data_inicio < data_fim,
        Reserva.data_fim > data_inicio,
    )
    if reserva_id is not None:
        consulta = consulta.where(Reserva.id != reserva_id)
    conflito = session.exec(consulta).first()
    if conflito:
        raise HTTPException(
            status_code=409,
            detail="Já existe uma reserva para este equipamento no intervalo selecionado",
        )


# ─── OEE helper (pequeno — o principal está em oee_service) ──────────────────

def calcular_valida_para_stats(inicio: datetime, fim: datetime, termino_forcado: bool) -> bool:
    return (fim - inicio).total_seconds() >= 300 and not termino_forcado
