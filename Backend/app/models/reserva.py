from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, Column, Index, Integer, String
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, TipoDocumento, utc_now

if TYPE_CHECKING:
    from app.models.equipamento import Equipamento
    from app.models.utilizador import Utilizador
    from app.models.sessao import SessaoUso


class Reserva(UTCModel, table=True):
    __tablename__ = "Reservas"
    __table_args__ = (
        Index("ix_reserva_equipamento_periodo", "equipamento_id", "data_inicio", "data_fim"),
        Index("ix_reserva_utilizador_periodo", "utilizador_id", "data_inicio", "data_fim"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    utilizador_id: int = Field(foreign_key="Utilizadores.id", index=True)
    projeto: Optional[str] = Field(default=None, sa_column=Column(String(150), index=True))
    metodo: Optional[str] = Field(default=None, sa_column=Column(String(180), index=True))
    data_inicio: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    data_fim: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    duracao_prevista_minutos: Optional[int] = Field(
        default=None,
        sa_column=Column("duracao_prevista_minutos", Integer, nullable=True, index=True),
    )
    concluido_com_sucesso: Optional[bool] = Field(
        default=None,
        sa_column=Column("concluido_com_sucesso", Boolean, nullable=True, index=True),
    )
    fim_automatico: Optional[datetime] = Field(
        default=None, sa_column=Column(UTCDateTime(), nullable=True, index=True)
    )
    notas: Optional[str] = Field(default=None)
    criado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="reservas",
        sa_relationship=relationship("Equipamento", back_populates="reservas"),
    )
    utilizador_rel: Optional["Utilizador"] = Relationship(
        back_populates="reservas",
        sa_relationship=relationship("Utilizador", back_populates="reservas"),
    )
    sessoes: list["SessaoUso"] = Relationship(
        back_populates="reserva",
        sa_relationship=relationship("SessaoUso", back_populates="reserva"),
    )


class DocumentacaoEquipamento(UTCModel, table=True):
    __tablename__ = "DocumentacaoEquipamento"
    __table_args__ = (
        Index("ix_documentacao_equipamento_tipo", "equipamento_id", "tipo_documento"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    carregado_por_id: Optional[int] = Field(
        default=None, foreign_key="Utilizadores.id", index=True
    )
    titulo: str = Field(sa_column=Column("titulo", String(180), nullable=False))
    tipo_documento: TipoDocumento = Field(
        default=TipoDocumento.OUTRO,
        sa_column=Column(String(30), nullable=False, index=True),
    )
    caminho_ficheiro: str = Field(
        sa_column=Column("caminho_ficheiro", String(1000), nullable=False)
    )
    descricao: Optional[str] = Field(default=None)
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="documentos",
        sa_relationship=relationship("Equipamento", back_populates="documentos"),
    )
    carregado_por: Optional["Utilizador"] = Relationship(
        back_populates="documentos_carregados",
        sa_relationship=relationship("Utilizador", back_populates="documentos_carregados"),
    )
