from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Index, Integer, String, Text, event
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, calcular_proxima_data, utc_now

if TYPE_CHECKING:
    from app.models.equipamento import Equipamento
    from app.models.utilizador import Utilizador


class Manutencao(UTCModel, table=True):
    __tablename__ = "Manutencoes"
    __table_args__ = (
        Index("ix_manutencao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(
        default=None, foreign_key="Utilizadores.id", index=True
    )
    descricao: str = Field(sa_column=Column("descricao", Text, nullable=False))
    data_realizada: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(
        default=None, sa_column=Column(UTCDateTime(), index=True)
    )
    criado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )
    tipo_intervencao: Optional[str] = Field(default=None, sa_column=Column(String(60)))
    custo_eur: Optional[float] = Field(default=None)
    referencia_sc_po: Optional[str] = Field(default=None, sa_column=Column(String(100)))
    observacoes_externas: Optional[str] = Field(default=None)
    caminho_anexo: Optional[str] = Field(default=None, sa_column=Column(String(500), nullable=True))
    fornecedor: Optional[str] = Field(default=None, sa_column=Column(String(150), nullable=True))
    fornecedor_id: Optional[int] = Field(default=None, sa_column=Column("fornecedor_id", Integer, nullable=True))
    origem_avaria_id: Optional[int] = Field(default=None, sa_column=Column("origem_avaria_id", Integer, nullable=True, index=True))

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="manutencoes",
        sa_relationship=relationship("Equipamento", back_populates="manutencoes"),
    )
    executado_por: Optional["Utilizador"] = Relationship(
        back_populates="manutencoes_executadas",
        sa_relationship=relationship("Utilizador", back_populates="manutencoes_executadas"),
    )


@event.listens_for(Manutencao, "before_insert")
@event.listens_for(Manutencao, "before_update")
def calcular_proxima_data_manutencao(mapper, connection, target) -> None:
    del mapper, connection
    if target.proxima_data is None:
        target.proxima_data = calcular_proxima_data(
            data_realizada=target.data_realizada,
            periodicidade_dias=target.periodicidade_dias,
        )
