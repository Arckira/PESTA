from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Index, String, event
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, calcular_proxima_data, utc_now

if TYPE_CHECKING:
    from app.models.equipamento import Equipamento
    from app.models.utilizador import Utilizador


class Calibracao(UTCModel, table=True):
    __tablename__ = "Calibracoes"
    __table_args__ = (
        Index("ix_calibracao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(
        default=None, foreign_key="Utilizadores.id", index=True
    )
    data_realizada: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(
        default=None, sa_column=Column(UTCDateTime(), index=True)
    )
    certificado_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    observacoes: Optional[str] = Field(default=None)
    criado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="calibracoes",
        sa_relationship=relationship("Equipamento", back_populates="calibracoes"),
    )
    executado_por: Optional["Utilizador"] = Relationship(
        back_populates="calibracoes_executadas",
        sa_relationship=relationship("Utilizador", back_populates="calibracoes_executadas"),
    )


@event.listens_for(Calibracao, "before_insert")
@event.listens_for(Calibracao, "before_update")
def calcular_proxima_data_calibracao(mapper, connection, target) -> None:
    del mapper, connection
    if target.proxima_data is None:
        target.proxima_data = calcular_proxima_data(
            data_realizada=target.data_realizada,
            periodicidade_dias=target.periodicidade_dias,
        )
