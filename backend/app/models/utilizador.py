from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Index, String, event
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, RoleUtilizador, utc_now

if TYPE_CHECKING:
    from app.models.reserva import Reserva, DocumentacaoEquipamento
    from app.models.sessao import SessaoUso, SessaoAuth
    from app.models.avaria import Avaria
    from app.models.manutencao import Manutencao
    from app.models.calibracao import Calibracao


class Utilizador(UTCModel, table=True):
    __tablename__ = "Utilizadores"
    __table_args__ = (Index("ix_utilizador_nome_role", "nome", "role"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(sa_column=Column("nome", String(150), nullable=False, index=True))
    iniciais: Optional[str] = Field(default=None, sa_column=Column(String(10)))
    numero_colaborador: str = Field(
        sa_column=Column("numero_colaborador", String(50), nullable=False, unique=True, index=True)
    )
    email: Optional[str] = Field(default=None, sa_column=Column(String(180), index=True))
    cargo: Optional[str] = Field(default=None, sa_column=Column(String(100), index=True))
    departamento: str = Field(sa_column=Column("departamento", String(120), nullable=False))
    pin_hash: str = Field(default="", sa_column=Column(String(255), nullable=False))
    role: RoleUtilizador = Field(
        default=RoleUtilizador.USER,
        sa_column=Column(String(20), nullable=False, index=True),
    )
    ativo: bool = Field(default=True, index=True)
    forcar_troca_pin: bool = Field(default=True)
    criado_em: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False)
    )

    reservas: list["Reserva"] = Relationship(
        back_populates="utilizador_rel",
        sa_relationship=relationship("Reserva", back_populates="utilizador_rel"),
    )
    sessoes: list["SessaoUso"] = Relationship(
        back_populates="utilizador_rel",
        sa_relationship=relationship("SessaoUso", back_populates="utilizador_rel"),
    )
    sessoes_auth: list["SessaoAuth"] = Relationship(
        back_populates="utilizador",
        sa_relationship=relationship("SessaoAuth", back_populates="utilizador"),
    )
    avarias_reportadas: list["Avaria"] = Relationship(
        back_populates="reportado_por",
        sa_relationship=relationship("Avaria", back_populates="reportado_por"),
    )
    manutencoes_executadas: list["Manutencao"] = Relationship(
        back_populates="executado_por",
        sa_relationship=relationship("Manutencao", back_populates="executado_por"),
    )
    calibracoes_executadas: list["Calibracao"] = Relationship(
        back_populates="executado_por",
        sa_relationship=relationship("Calibracao", back_populates="executado_por"),
    )
    documentos_carregados: list["DocumentacaoEquipamento"] = Relationship(
        back_populates="carregado_por",
        sa_relationship=relationship("DocumentacaoEquipamento", back_populates="carregado_por"),
    )


@event.listens_for(Utilizador, "load")
def _coerce_role_utilizador(target, context) -> None:
    if isinstance(target.role, str):
        target.role = RoleUtilizador(target.role)
