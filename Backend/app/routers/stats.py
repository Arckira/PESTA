from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.core.deps import exigir_pin_alterado, obter_utilizador_atual
from app.db.database import get_session
from app.models.base import RoleUtilizador
from app.models.avaria import Avaria
from app.models.equipamento import Equipamento
from app.models.reserva import Reserva
from app.models.sessao import SessaoUso
from app.models.utilizador import Utilizador
from app.services.auth_service import agora_utc, iso_z, validar_dias
from app.services.oee_service import calcular_oee_temporal, calcular_mtbf_mttr, calcular_tempo_disponivel_s

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stats"])


@router.get("/dashboard/oee", summary="OEE global de todos os equipamentos")
def oee_global(
    dias: int = 30,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(obter_utilizador_atual),
) -> list[dict[str, Any]]:
    _ = admin
    dias = validar_dias(dias)
    agora = agora_utc()
    limite = agora - timedelta(days=dias)
    equipamentos = session.exec(select(Equipamento)).all()

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.inicio >= limite,
            SessaoUso.fim.is_not(None),
        )
    ).all()
    avarias_periodo = session.exec(
        select(Avaria).where(Avaria.data_registo < agora)
    ).all()

    reservas_por_equipamento: dict = defaultdict(list)
    for reserva in reservas_periodo:
        reservas_por_equipamento[reserva.equipamento_id].append(reserva)

    sessoes_por_equipamento: dict = defaultdict(list)
    for sessao in sessoes_periodo:
        sessoes_por_equipamento[sessao.equipamento_id].append(sessao)

    resultado: list[dict[str, Any]] = []
    for eq in equipamentos:
        tempo_disponivel_s = calcular_tempo_disponivel_s(
            eq.id, avarias_periodo, limite, agora, agora
        )
        tempo_real_s = sum(
            (s.fim - s.inicio).total_seconds()
            for s in sessoes_por_equipamento.get(eq.id, [])
            if s.fim is not None
        )
        oee_pct = calcular_oee_temporal(tempo_real_s, tempo_disponivel_s)
        resultado.append({
            "id": eq.id,
            "nome": eq.nome,
            "codigo": eq.codigo,
            "estado_atual": eq.estado_atual,
            "oee_pct": oee_pct,
            "tempo_disponivel_h": round(tempo_disponivel_s / 3600, 2),
            "tempo_real_h": round(tempo_real_s / 3600, 2),
            "total_reservas": len(reservas_por_equipamento.get(eq.id, [])),
        })
    return resultado


@router.get("/stats/oee_summary", summary="Sumário OEE global e por equipamento para o Dashboard")
def oee_summary(
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> dict[str, Any]:
    dias = validar_dias(dias)
    agora = agora_utc()
    limite = agora - timedelta(days=dias)
    equipamentos = session.exec(select(Equipamento)).all()

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(SessaoUso.inicio >= limite)
    ).all()

    reservas_por_eq: dict = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_eq[r.equipamento_id].append(r)

    sessoes_por_eq: dict = defaultdict(list)
    for s in sessoes_periodo:
        sessoes_por_eq[s.equipamento_id].append(s)

    sessoes_ativas_pre_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_(None),
            SessaoUso.inicio < limite,
        )
    ).all()
    for s in sessoes_ativas_pre_periodo:
        sessoes_por_eq[s.equipamento_id].append(s)

    avarias_periodo = session.exec(
        select(Avaria).where(Avaria.data_registo < agora)
    ).all()

    individual: list[dict[str, Any]] = []
    oee_com_dados: list[float] = []

    for eq in equipamentos:
        reservas_eq = reservas_por_eq.get(eq.id, [])
        sessoes_eq = sessoes_por_eq.get(eq.id, [])

        tempo_disponivel_s = calcular_tempo_disponivel_s(
            eq.id, avarias_periodo, limite, agora, agora
        )

        tempo_real_s = 0.0
        for s in sessoes_eq:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())

        oee_pct = calcular_oee_temporal(tempo_real_s, tempo_disponivel_s)
        if oee_pct is not None:
            ratio = tempo_real_s / tempo_disponivel_s
            desvio_pct: float | None = round(max(0.0, ratio - 1.0) * 100, 1)
            oee_com_dados.append(oee_pct)
        else:
            desvio_pct = None

        individual.append({
            "id": eq.id,
            "nome": eq.nome,
            "codigo": eq.codigo,
            "tipo": eq.tipo or "Outros",
            "estado_atual": eq.estado_atual,
            "oee_pct": oee_pct,
            "desvio_planeamento_pct": desvio_pct,
            "tempo_disponivel_h": round(tempo_disponivel_s / 3600, 2),
            "tempo_real_h": round(tempo_real_s / 3600, 2),
            "total_reservas": len(reservas_eq),
            "tem_sessao_ativa": any(s.fim is None for s in sessoes_eq),
        })

    oee_global_val = round(sum(oee_com_dados) / len(oee_com_dados), 1) if oee_com_dados else None

    return {
        "oee_global": oee_global_val,
        **calcular_mtbf_mttr(session, dias),
        "individual": individual,
    }


@router.get("/stats/oee_historico", summary="OEE agregado por dia para gráfico de tendência")
def oee_historico(
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> list[dict[str, Any]]:
    dias = validar_dias(dias)
    dias = min(dias, 90)
    agora = agora_utc()
    limite = agora - timedelta(days=dias)

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(SessaoUso.inicio >= limite)
    ).all()
    avarias_periodo = session.exec(
        select(Avaria).where(Avaria.data_registo < agora)
    ).all()

    reservas_por_dia: dict = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_dia[r.data_inicio.date()].append(r)

    sessoes_por_dia: dict = defaultdict(list)
    for s in sessoes_periodo:
        sessoes_por_dia[s.inicio.date()].append(s)

    resultado: list[dict[str, Any]] = []

    todos_os_dias = sorted(set(list(reservas_por_dia.keys()) + list(sessoes_por_dia.keys())))
    for dia in todos_os_dias:
        sessoes_dia = sessoes_por_dia.get(dia, [])

        dia_inicio = datetime(dia.year, dia.month, dia.day, tzinfo=timezone.utc)
        dia_fim = dia_inicio + timedelta(days=1)
        tempo_disponivel_s = calcular_tempo_disponivel_s(
            None, avarias_periodo, dia_inicio, dia_fim, agora
        )

        tempo_real_s = 0.0
        for s in sessoes_dia:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())

        oee_pct = calcular_oee_temporal(tempo_real_s, tempo_disponivel_s)
        if oee_pct is None:
            continue

        resultado.append({
            "data": dia.isoformat(),
            "oee_pct": oee_pct,
            "tempo_disponivel_h": round(tempo_disponivel_s / 3600, 2),
            "tempo_real_h": round(tempo_real_s / 3600, 2),
        })

    return resultado


@router.post("/admin/stats/limpar-sessoes-invalidas", summary="Marcar sessões históricas inválidas para OEE")
def limpar_sessoes_invalidas(
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    if utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Apenas administradores podem executar esta operação.")

    agora = agora_utc()
    limite_orfas = agora - timedelta(hours=24)

    sessoes_orfas = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_(None),
            SessaoUso.inicio <= limite_orfas,
        )
    ).all()
    invalidadas_orfas = 0
    for s in sessoes_orfas:
        s.fim = agora
        s.termino_forcado = True
        s.valida_para_stats = False
        session.add(s)
        invalidadas_orfas += 1

    sessoes_fechadas = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_not(None),
            SessaoUso.valida_para_stats == True,
        )
    ).all()
    invalidadas_curtas = 0
    for s in sessoes_fechadas:
        if s.termino_forcado or (s.fim - s.inicio).total_seconds() < 300:
            s.valida_para_stats = False
            session.add(s)
            invalidadas_curtas += 1

    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao limpar sessões inválidas")
        raise HTTPException(status_code=503, detail="Falha ao limpar sessões inválidas") from exc

    total = invalidadas_orfas + invalidadas_curtas
    logger.info("Limpeza OEE: %d sessões órfãs fechadas, %d sessões curtas/forçadas invalidadas", invalidadas_orfas, invalidadas_curtas)
    return {
        "mensagem": f"{total} sessões marcadas como inválidas para OEE.",
        "sessoes_orfas_fechadas": invalidadas_orfas,
        "sessoes_curtas_ou_forcadas": invalidadas_curtas,
        "total_invalidadas": total,
    }


@router.get("/metricas/oee/{equipamento_id}", summary="OEE específico para um equipamento")
def oee_equipamento(
    equipamento_id: int,
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> dict[str, Any]:
    dias = validar_dias(dias)
    agora = agora_utc()
    limite = agora - timedelta(days=dias)

    eq = session.get(Equipamento, equipamento_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")

    reservas = session.exec(
        select(Reserva).where(
            Reserva.equipamento_id == equipamento_id,
            Reserva.data_inicio >= limite,
        )
    ).all()

    sessoes = list(session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id == equipamento_id,
            SessaoUso.inicio >= limite,
        )
    ).all())

    sessao_pre = session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id == equipamento_id,
            SessaoUso.fim.is_(None),
            SessaoUso.inicio < limite,
        )
    ).first()
    if sessao_pre is not None:
        sessoes.append(sessao_pre)

    avarias = session.exec(
        select(Avaria).where(
            Avaria.equipamento_id == equipamento_id,
            Avaria.data_registo < agora,
        )
    ).all()
    tempo_disponivel_s = calcular_tempo_disponivel_s(
        equipamento_id, avarias, limite, agora, agora
    )

    tempo_real_s = 0.0
    for s in sessoes:
        try:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())
        except (TypeError, ValueError):
            continue

    oee_pct = calcular_oee_temporal(tempo_real_s, tempo_disponivel_s)

    reservas_sucesso = [r for r in reservas if r.concluido_com_sucesso is True]
    taxa_sucesso_planeamento = (
        len(reservas_sucesso) / len(reservas) * 100 if reservas else 0.0
    )

    return {
        "equipamento_id": equipamento_id,
        "equipamento_nome": eq.nome,
        "oee_pct": oee_pct if oee_pct is not None else 0.0,
        "taxa_sucesso_planeamento_pct": round(taxa_sucesso_planeamento, 2),
        "tempo_disponivel_h": round(tempo_disponivel_s / 3600, 2),
        "tempo_real_h": round(tempo_real_s / 3600, 2),
        "total_reservas": len(reservas),
        "reservas_sucesso": len(reservas_sucesso),
        "periodo_dias": dias,
        "desde": iso_z(limite),
    }
