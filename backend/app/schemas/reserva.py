from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, model_validator

from app.models.base import TipoDocumento


class ReservaCreate(BaseModel):
    equipamento_id: int
    utilizador_id: int
    projeto: Optional[str] = None
    metodo: Optional[str] = None
    data_inicio: datetime
    data_fim: datetime
    notas: Optional[str] = None
    duracao_prevista_minutos: Optional[int] = None
    concluido_com_sucesso: Optional[bool] = None

    @model_validator(mode="after")
    def validar_intervalo(self) -> "ReservaCreate":
        if self.data_fim <= self.data_inicio:
            raise ValueError("data_fim tem de ser posterior a data_inicio")
        for campo, valor in (("data_inicio", self.data_inicio), ("data_fim", self.data_fim)):
            if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
                raise ValueError(f"{campo} deve estar alinhada à hora cheia (ex: 09:00)")
        duracao_segundos = (self.data_fim - self.data_inicio).total_seconds()
        if duracao_segundos < 3600:
            raise ValueError("A reserva mínima é de 1 hora")
        if duracao_segundos % 3600 != 0:
            raise ValueError("A duração da reserva deve ser em horas inteiras")
        return self


class ReservaUpdate(BaseModel):
    equipamento_id: Optional[int] = None
    utilizador_id: Optional[int] = None
    projeto: Optional[str] = None
    metodo: Optional[str] = None
    data_inicio: Optional[datetime] = None
    data_fim: Optional[datetime] = None
    notas: Optional[str] = None
    duracao_prevista_minutos: Optional[int] = None
    concluido_com_sucesso: Optional[bool] = None

    @model_validator(mode="after")
    def validar_intervalo_parcial(self) -> "ReservaUpdate":
        if (
            self.data_inicio is not None
            and self.data_fim is not None
            and self.data_fim <= self.data_inicio
        ):
            raise ValueError("data_fim tem de ser posterior a data_inicio")
        for campo, valor in (("data_inicio", self.data_inicio), ("data_fim", self.data_fim)):
            if valor is None:
                continue
            if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
                raise ValueError(f"{campo} deve estar alinhada à hora cheia (ex: 09:00)")
        return self


class DocumentoCreate(BaseModel):
    titulo: str
    tipo_documento: TipoDocumento = TipoDocumento.OUTRO
    caminho_ficheiro: str
    descricao: Optional[str] = None
    carregado_por_id: Optional[int] = None
