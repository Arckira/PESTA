from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlmodel import Session, select

from database import get_session
from models import Equipamento, Reserva, RoleUtilizador, SessaoUso, Utilizador
from main import (
    _agora_utc,
    _obter_ou_404,
    _persistir_sessao,
    _validar_colisao_reserva,
    _validar_intervalo_reserva,
    exigir_pin_alterado,
)


router = APIRouter()


class ReservaUpdate(BaseModel):
    equipamento_id: Optional[int] = None
    utilizador_id: Optional[int] = None
    projeto: Optional[str] = None
    metodo: Optional[str] = None
    data_inicio: Optional[datetime] = None
    data_fim: Optional[datetime] = None
    notas: Optional[str] = None

    @model_validator(mode="after")
    def validar_intervalo_parcial(self) -> "ReservaUpdate":
        if self.data_inicio is not None and self.data_fim is not None and self.data_fim <= self.data_inicio:
            raise ValueError("data_fim tem de ser posterior a data_inicio")
        for campo, valor in (("data_inicio", self.data_inicio), ("data_fim", self.data_fim)):
            if valor is None:
                continue
            if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
                raise ValueError(f"{campo} deve estar alinhada à hora cheia (ex: 09:00)")
        return self


def _obter_sessao_ativa_reserva(session: Session, reserva_id: int) -> SessaoUso | None:
    return session.exec(
        select(SessaoUso).where(
            SessaoUso.reserva_id == reserva_id,
            SessaoUso.fim.is_(None),
        )
    ).first()


@router.put("/reservas/{reserva_id}", summary="Actualizar reserva")
def atualizar_reserva(
    reserva_id: int,
    dados: ReservaUpdate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> Reserva:
    reserva = _obter_ou_404(session, Reserva, reserva_id, "Reserva não encontrada")
    if reserva.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Só o dono da reserva (ou admin) pode editar")

    atualizacao = dados.model_dump(exclude_unset=True)
    if not atualizacao:
        raise HTTPException(status_code=400, detail="Nenhum campo para actualizar foi enviado")

    sessao_ativa = _obter_sessao_ativa_reserva(session, reserva.id)
    if sessao_ativa and any(campo in atualizacao for campo in ("equipamento_id", "data_inicio", "data_fim")):
        raise HTTPException(status_code=400, detail="Não é possível alterar datas ou equipamento de uma reserva em curso")

    equipamento_id = int(atualizacao.get("equipamento_id", reserva.equipamento_id))
    utilizador_id = int(atualizacao.get("utilizador_id", reserva.utilizador_id))
    data_inicio = atualizacao.get("data_inicio", reserva.data_inicio)
    data_fim = atualizacao.get("data_fim", reserva.data_fim)

    if data_inicio is None or data_fim is None:
        raise HTTPException(status_code=400, detail="As datas de início e fim são obrigatórias para actualizar a reserva")

    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")

    if utilizador_atual.role != RoleUtilizador.ADMIN and utilizador_id != reserva.utilizador_id:
        raise HTTPException(status_code=403, detail="Só um administrador pode alterar o utilizador da reserva")

    _validar_intervalo_reserva(data_inicio, data_fim)
    _validar_colisao_reserva(session, equipamento_id, data_inicio, data_fim, reserva_id=reserva.id)

    reserva.equipamento_id = equipamento_id
    reserva.utilizador_id = utilizador_id
    if "projeto" in atualizacao:
        reserva.projeto = atualizacao.get("projeto")
    if "metodo" in atualizacao:
        reserva.metodo = atualizacao.get("metodo")
    if "data_inicio" in atualizacao:
        reserva.data_inicio = data_inicio
    if "data_fim" in atualizacao:
        reserva.data_fim = data_fim
    if "notas" in atualizacao:
        reserva.notas = atualizacao.get("notas")

    session.add(reserva)
    _persistir_sessao(session, "Falha ao actualizar reserva")
    session.refresh(reserva)
    return reserva


@router.delete("/reservas/{reserva_id}", summary="Eliminar ou terminar reserva")
def eliminar_reserva(
    reserva_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, object]:
    reserva = _obter_ou_404(session, Reserva, reserva_id, "Reserva não encontrada")
    if reserva.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Só o dono da reserva (ou admin) pode cancelar")

    sessao_ativa = _obter_sessao_ativa_reserva(session, reserva.id)
    if sessao_ativa is None:
        session.delete(reserva)
        _persistir_sessao(session, "Falha ao cancelar reserva")
        return {"mensagem": "Reserva cancelada com sucesso", "estado": "eliminada"}

    agora = _agora_utc()
    sessao_ativa.fim = agora
    sessao_ativa.termino_forcado = True
    sessao_ativa.valida_para_stats = False
    session.add(sessao_ativa)

    reserva.data_fim = agora
    reserva.concluido_com_sucesso = False
    session.add(reserva)

    _persistir_sessao(session, "Falha ao terminar reserva em curso")
    session.refresh(reserva)
    return {"mensagem": "Reserva terminada com sucesso", "estado": "concluida", "reserva": reserva}