from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CheckinCreate(BaseModel):
    reserva_id: Optional[int] = None
    duracao_prevista_minutos: Optional[int] = None
    projeto: Optional[str] = None
    metodo: Optional[str] = None


class CheckoutCreate(BaseModel):
    concluido_com_sucesso: bool = True


class AtualizarDuracaoCreate(BaseModel):
    duracao_prevista_minutos: int
