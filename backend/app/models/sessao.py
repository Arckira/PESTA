from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Index, String, event, update
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, RoleUtilizador, EstadoEquipamento, utc_now

if TYPE_CHECKING:
    from app.models.equipamento import Equipamento
    from app.models.utilizador import Utilizador
    from app.models.reserva import Reserva


class SessaoUso(UTCModel, table=True):
    __tablename__ = "SessoesUso"
    __table_args__ = (
        Index("ix_sessaouso_equipamento_inicio", "equipamento_id", "inicio"),
        Index("ix_sessaouso_utilizador_inicio", "utilizador_id", "inicio"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    reserva_id: Optional[int] = Field(default=None, foreign_key="Reservas.id", index=True)
    utilizador_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    utilizador: str = Field(sa_column=Column("utilizador", String(150), nullable=False))
    inicio: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False, index=True)
    )
    fim: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    duracao_prevista_minutos: Optional[int] = Field(default=None)
    fim_automatico: Optional[datetime] = Field(
        default=None, sa_column=Column(UTCDateTime(), index=True)
    )
    termino_forcado: bool = Field(default=False, index=True)
    valida_para_stats: bool = Field(default=True, index=True)
    projeto: Optional[str] = Field(default=None, sa_column=Column(String(150), nullable=True))
    metodo: Optional[str] = Field(default=None, sa_column=Column(String(180), nullable=True))

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="sessoes",
        sa_relationship=relationship("Equipamento", back_populates="sessoes"),
    )
    reserva: Optional["Reserva"] = Relationship(
        back_populates="sessoes",
        sa_relationship=relationship("Reserva", back_populates="sessoes"),
    )
    utilizador_rel: Optional["Utilizador"] = Relationship(
        back_populates="sessoes",
        sa_relationship=relationship("Utilizador", back_populates="sessoes"),
    )


class SessaoAuth(UTCModel, table=True):
    __tablename__ = "SessoesAuth"
    __table_args__ = (
        Index("ix_sessaoauth_utilizador_expira", "utilizador_id", "expira_em"),
    )

    token: str = Field(primary_key=True, max_length=255)
    utilizador_id: int = Field(foreign_key="Utilizadores.id", index=True)
    role: RoleUtilizador = Field(sa_column=Column(String(20), nullable=False))
    expira_em: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    criado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )

    utilizador: Optional["Utilizador"] = Relationship(
        back_populates="sessoes_auth",
        sa_relationship=relationship("Utilizador", back_populates="sessoes_auth"),
    )


@event.listens_for(SessaoAuth, "load")
def _coerce_role_sessao_auth(target, context) -> None:
    if isinstance(target.role, str):
        target.role = RoleUtilizador(target.role)


@event.listens_for(SessaoUso, "after_insert")
def marcar_equipamento_como_ocupado_por_ensaio(mapper, connection, target) -> None:
    """Força o estado do equipamento para Ocupado quando o ensaio começa."""
    del mapper

    from app.models.equipamento import Equipamento  # importação local — evita circular no topo

    connection.execute(
        update(Equipamento)
        .where(Equipamento.id == target.equipamento_id)
        .values(estado_atual=EstadoEquipamento.OCUPADO.value, atualizado_em=utc_now())
    )
