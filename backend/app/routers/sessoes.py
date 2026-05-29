from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.core.deps import exigir_pin_alterado
from app.db.database import get_session, garantir_colunas_sessaouso
from app.models.base import EstadoEquipamento, RoleUtilizador, normalizar_estado_equipamento
from app.models.equipamento import Equipamento
from app.models.reserva import Reserva
from app.models.sessao import SessaoUso
from app.models.utilizador import Utilizador
from app.schemas.sessao import AtualizarDuracaoCreate, CheckinCreate, CheckoutCreate
from app.services.auth_service import (
    agora_utc,
    calcular_valida_para_stats,
    iso_z,
    obter_ou_404,
    persistir_sessao,
    registar_log_bd,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sessoes"])


@router.post("/equipamentos/{equipamento_id}/checkin", summary="Iniciar utilização real")
def fazer_checkin(
    equipamento_id: int,
    dados: CheckinCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    garantir_colunas_sessaouso()
    try:
        eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
        estados_bloqueantes = [
            EstadoEquipamento.AVARIADO.value,
            EstadoEquipamento.MANUTENCAO.value,
            EstadoEquipamento.CALIBRACAO.value,
        ]
        estado_atual = normalizar_estado_equipamento(eq.estado_atual)
        if estado_atual in estados_bloqueantes:
            raise HTTPException(status_code=400, detail=f"Operação negada. Equipamento em estado: {estado_atual}.")

        sessao_aberta = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()

        if sessao_aberta:
            if estado_atual == EstadoEquipamento.DISPONIVEL.value and sessao_aberta.utilizador_id != utilizador_atual.id:
                sessao_aberta.fim = agora_utc()
                session.add(sessao_aberta)
                session.flush()
            elif sessao_aberta.utilizador_id == utilizador_atual.id:
                raise HTTPException(
                    status_code=409,
                    detail=f"Já tem um check-in ativo iniciado às {iso_z(sessao_aberta.inicio)}. Para alterar a duração, use 'Editar Duração'.",
                )
            else:
                raise HTTPException(
                    status_code=409,
                    detail=f"Equipamento em uso por '{sessao_aberta.utilizador}' desde {iso_z(sessao_aberta.inicio)}.",
                )

        agora = agora_utc()
        fim_auto = (agora + timedelta(minutes=dados.duracao_prevista_minutos)) if dados.duracao_prevista_minutos else None
        nova_sessao = SessaoUso(
            equipamento_id=equipamento_id,
            utilizador_id=utilizador_atual.id,
            utilizador=utilizador_atual.nome,
            reserva_id=dados.reserva_id,
            inicio=agora,
            duracao_prevista_minutos=dados.duracao_prevista_minutos,
            fim_automatico=fim_auto,
            projeto=dados.projeto,
            metodo=dados.metodo,
        )
        eq.estado_atual = EstadoEquipamento.OCUPADO.value
        session.add(nova_sessao)
        session.add(eq)

        if dados.duracao_prevista_minutos and dados.reserva_id:
            reserva = session.get(Reserva, dados.reserva_id)
            if reserva:
                reserva.duracao_prevista_minutos = dados.duracao_prevista_minutos
                reserva.fim_automatico = fim_auto
                session.add(reserva)

        persistir_sessao(session, "Falha ao registar check-in")
        session.refresh(nova_sessao)

        registar_log_bd(
            session, acao="checkin", sucesso=True,
            detalhe=f"Check-in no equipamento '{eq.nome}' (ID={equipamento_id}). Projeto: {dados.projeto or '—'} | Método: {dados.metodo or '—'} | Duração: {dados.duracao_prevista_minutos or '?'} min.",
            utilizador_id=utilizador_atual.id, utilizador_nome=utilizador_atual.nome,
            role=utilizador_atual.role, entidade="SessaoUso", entidade_id=nova_sessao.id,
        )
        return {"mensagem": "Check-in realizado com sucesso.", "sessao": nova_sessao}

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.patch("/atualizar-duracao/{equipamento_id}", summary="Atualizar duração estimada")
@router.patch("/equipamentos/{equipamento_id}/sessao-ativa/duracao", summary="Editar duração de sessão em progresso")
def editar_duracao_sessao(
    equipamento_id: int,
    dados: AtualizarDuracaoCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    try:
        if dados.duracao_prevista_minutos <= 0:
            raise HTTPException(status_code=400, detail="A duração prevista deve ser superior a 0 minutos.")
        sessao = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.utilizador_id == utilizador_atual.id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if not sessao:
            raise HTTPException(status_code=404, detail="Nenhuma sessão ativa para este utilizador neste equipamento.")

        novo_fim = sessao.inicio + timedelta(minutes=dados.duracao_prevista_minutos)
        sessao.duracao_prevista_minutos = dados.duracao_prevista_minutos
        sessao.fim_automatico = novo_fim
        session.add(sessao)

        reserva = None
        if sessao.reserva_id:
            reserva = session.get(Reserva, sessao.reserva_id)
            if reserva:
                reserva.duracao_prevista_minutos = dados.duracao_prevista_minutos
                reserva.fim_automatico = reserva.data_inicio + timedelta(minutes=dados.duracao_prevista_minutos)
                session.add(reserva)

        persistir_sessao(session, "Falha ao atualizar duração da sessão")
        session.refresh(sessao)
        return {
            "mensagem": f"Duração atualizada para {dados.duracao_prevista_minutos} minutos.",
            "sessao": sessao,
            "reserva": {
                "id": reserva.id,
                "data_inicio": reserva.data_inicio,
                "duracao_prevista_minutos": reserva.duracao_prevista_minutos,
                "fim_automatico": reserva.fim_automatico,
            } if reserva else None,
        }
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.patch("/equipamentos/{equipamento_id}/checkout", summary="Terminar utilização real")
def fazer_checkout(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    try:
        sessao_aberta = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()
        if not sessao_aberta:
            raise HTTPException(status_code=404, detail="Não existe sessão ativa para este equipamento.")
        if (sessao_aberta.utilizador_id and sessao_aberta.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN):
            raise HTTPException(status_code=403, detail="Apenas o operador da sessão (ou admin) pode fazer checkout")
        sessao_aberta.fim = agora_utc()
        sessao_aberta.termino_forcado = False
        sessao_aberta.valida_para_stats = calcular_valida_para_stats(sessao_aberta.inicio, sessao_aberta.fim, termino_forcado=False)
        eq = session.get(Equipamento, equipamento_id)
        if eq:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
            session.add(eq)
        session.add(sessao_aberta)
        persistir_sessao(session, "Falha ao registar check-out")
        session.refresh(sessao_aberta)
        return {"mensagem": "Check-out realizado. Equipamento libertado.", "sessao": sessao_aberta}
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.patch("/equipamentos/{equipamento_id}/checkout-com-status", summary="Terminar utilização com status de sucesso/falha")
def fazer_checkout_com_status(
    equipamento_id: int,
    dados: CheckoutCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    try:
        sessao_aberta = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()
        if not sessao_aberta:
            raise HTTPException(status_code=404, detail="Não existe sessão ativa para este equipamento.")
        if (sessao_aberta.utilizador_id and sessao_aberta.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN):
            raise HTTPException(status_code=403, detail="Apenas o operador da sessão (ou admin) pode fazer checkout")
        sessao_aberta.fim = agora_utc()
        sessao_aberta.termino_forcado = False
        sessao_aberta.valida_para_stats = calcular_valida_para_stats(sessao_aberta.inicio, sessao_aberta.fim, termino_forcado=False)
        if sessao_aberta.reserva_id:
            reserva = session.get(Reserva, sessao_aberta.reserva_id)
            if reserva:
                reserva.concluido_com_sucesso = dados.concluido_com_sucesso
                session.add(reserva)
        eq = session.get(Equipamento, equipamento_id)
        if eq:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
            session.add(eq)
        session.add(sessao_aberta)
        persistir_sessao(session, "Falha ao registar check-out com status")
        session.refresh(sessao_aberta)
        return {
            "mensagem": f"Check-out realizado. Ensaio marcado como {'concluído com sucesso' if dados.concluido_com_sucesso else 'falhou'}.",
            "sessao": sessao_aberta,
            "concluido_com_sucesso": dados.concluido_com_sucesso,
        }
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.patch("/equipamentos/{equipamento_id}/checkout-forcado", summary="Forçar término da sessão ativa")
def checkout_forcado(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    try:
        eq = session.get(Equipamento, equipamento_id)
        if not eq:
            raise HTTPException(status_code=404, detail="Equipamento não encontrado.")
        sessao_aberta = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()
        if sessao_aberta:
            if (sessao_aberta.utilizador_id and sessao_aberta.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN):
                raise HTTPException(status_code=403, detail="Apenas o operador da sessão (ou admin) pode forçar término.")
            sessao_aberta.fim = agora_utc()
            sessao_aberta.termino_forcado = True
            sessao_aberta.valida_para_stats = False
            session.add(sessao_aberta)
            if sessao_aberta.reserva_id:
                reserva = session.get(Reserva, sessao_aberta.reserva_id)
                if reserva:
                    reserva.concluido_com_sucesso = False
                    session.add(reserva)
        eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
        session.add(eq)
        persistir_sessao(session, "Falha ao forçar término da sessão")
        return {"status": "sucesso", "mensagem": "Equipamento libertado com sucesso.", "sessao_fechada": sessao_aberta is not None}
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.get("/equipamentos/{equipamento_id}/sessao-ativa", summary="Obter sessão ativa do utilizador atual")
def obter_sessao_ativa(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    garantir_colunas_sessaouso()
    try:
        sessao = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.utilizador_id == utilizador_atual.id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if not sessao:
            return {}
        reserva_resumo: dict[str, Any] = {
            "duracao_prevista_minutos": sessao.duracao_prevista_minutos,
            "fim_automatico": sessao.fim_automatico,
        }
        if sessao.reserva_id:
            reserva = session.get(Reserva, sessao.reserva_id)
            if reserva:
                reserva_resumo["id"] = reserva.id
                reserva_resumo["data_inicio"] = reserva.data_inicio
                if not reserva_resumo["duracao_prevista_minutos"]:
                    reserva_resumo["duracao_prevista_minutos"] = reserva.duracao_prevista_minutos
                if not reserva_resumo["fim_automatico"]:
                    reserva_resumo["fim_automatico"] = reserva.fim_automatico
        return {"sessao": sessao, "reserva": reserva_resumo if reserva_resumo.get("fim_automatico") else None}
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.get("/equipamentos/{equipamento_id}/sessao-em-curso", summary="Sessão em curso (pública)")
def obter_sessao_em_curso(equipamento_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        sessao = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()
        if not sessao:
            return {}
        return {
            "inicio": iso_z(sessao.inicio) if sessao.inicio else None,
            "utilizador": sessao.utilizador,
            "duracao_prevista_minutos": sessao.duracao_prevista_minutos,
            "fim_automatico": iso_z(sessao.fim_automatico) if sessao.fim_automatico else None,
        }
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@router.get("/equipamentos/{equipamento_id}/sessoes", summary="Histórico de sessões de um equipamento")
def listar_sessoes(equipamento_id: int, session: Session = Depends(get_session)):
    return session.exec(
        select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id).order_by(SessaoUso.inicio.desc())
    ).all()


@router.get("/equipamentos/{equipamento_id}/eficiencia", summary="Calcular OEE do equipamento")
def calcular_eficiencia(
    equipamento_id: int,
    dias: int = 30,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    _ = utilizador_atual
    from app.services.auth_service import validar_dias
    from app.services.oee_service import calcular_metricas_uso

    dias = validar_dias(dias)
    limite = agora_utc() - timedelta(days=dias)
    reservas = session.exec(select(Reserva).where(Reserva.equipamento_id == equipamento_id, Reserva.data_inicio >= limite)).all()
    sessoes = session.exec(select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.inicio >= limite, SessaoUso.fim.is_not(None))).all()
    metricas = calcular_metricas_uso(reservas, sessoes)
    return {"equipamento_id": equipamento_id, "periodo_dias": dias, "total_reservas": len(reservas), "total_sessoes": len(sessoes), **metricas}
