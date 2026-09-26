from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Float, Index, String, event
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, EstadoEquipamento, normalizar_estado_equipamento, utc_now

if TYPE_CHECKING:
    from app.models.avaria import Avaria
    from app.models.manutencao import Manutencao
    from app.models.calibracao import Calibracao
    from app.models.reserva import Reserva, DocumentacaoEquipamento
    from app.models.sessao import SessaoUso


class Equipamento(UTCModel, table=True):
    __tablename__ = "Equipamentos"
    __table_args__ = (Index("ix_equipamento_nome_localizacao", "nome", "localizacao"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(sa_column=Column("nome", String(150), nullable=False, index=True))
    tipo: str = Field(sa_column=Column("tipo", String(120), nullable=False, index=True))
    localizacao: str = Field(
        sa_column=Column("localizacao", String(150), nullable=False, index=True)
    )
    codigo: str = Field(
        sa_column=Column("codigo", String(50), nullable=False, unique=True, index=True)
    )
    numero_serie: Optional[str] = Field(
        default=None, sa_column=Column("numero_serie", String(100), index=True)
    )
    temp_min: Optional[float] = Field(default=None, sa_column=Column("temp_min", Float))
    temp_max: Optional[float] = Field(default=None, sa_column=Column("temp_max", Float))
    humidade_max: Optional[float] = Field(default=None, sa_column=Column("humidade_max", Float))
    fabricante: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    modelo: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    ano_fabrico: Optional[int] = Field(default=None)
    largura_mm: Optional[float] = Field(default=None)
    altura_mm: Optional[float] = Field(default=None)
    profundidade_mm: Optional[float] = Field(default=None)
    volume_l: Optional[float] = Field(default=None)
    potencia_kw: Optional[float] = Field(default=None)
    ligacao_eletrica: Optional[str] = Field(default=None, sa_column=Column(String(80)))
    corrente_a: Optional[float] = Field(default=None)
    voltagem_v: Optional[float] = Field(default=None)
    peso_kg: Optional[float] = Field(default=None)
    peso_max_kg: Optional[float] = Field(default=None)
    notas_tecnicas: Optional[str] = Field(default=None)
    estado_atual: str = Field(
        default=EstadoEquipamento.DISPONIVEL.value,
        sa_column=Column(String(30), nullable=False, index=True),
    )
    seccao: str = Field(
        default="Environmental",
        sa_column=Column("seccao", String(50), nullable=False, index=True),
    )
    foto_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )
    atualizado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )

    sessoes: list["SessaoUso"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("SessaoUso", back_populates="equipamento"),
    )
    reservas: list["Reserva"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("Reserva", back_populates="equipamento"),
    )
    avarias: list["Avaria"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("Avaria", back_populates="equipamento"),
    )
    manutencoes: list["Manutencao"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("Manutencao", back_populates="equipamento"),
    )
    calibracoes: list["Calibracao"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("Calibracao", back_populates="equipamento"),
    )
    documentos: list["DocumentacaoEquipamento"] = Relationship(
        back_populates="equipamento",
        sa_relationship=relationship("DocumentacaoEquipamento", back_populates="equipamento"),
    )


@event.listens_for(Equipamento, "before_update")
def sincronizar_timestamp_equipamento(mapper, connection, target) -> None:
    del mapper, connection
    target.atualizado_em = utc_now()


@event.listens_for(Equipamento, "before_insert")
@event.listens_for(Equipamento, "before_update")
def normalizar_estado_equipamento_model(mapper, connection, target) -> None:
    del mapper, connection
    target.estado_atual = normalizar_estado_equipamento(target.estado_atual)
