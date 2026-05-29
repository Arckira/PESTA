from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Index, String
from sqlmodel import Field

from app.models.base import UTCDateTime, UTCModel, utc_now


class Log(UTCModel, table=True):
    __tablename__ = "Logs"
    __table_args__ = (
        Index("ix_log_utilizador_criado", "utilizador_id", "criado_em"),
        Index("ix_log_acao_criado", "acao", "criado_em"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    utilizador_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    utilizador_nome: Optional[str] = Field(default=None, sa_column=Column(String(150)))
    role: Optional[str] = Field(default=None, sa_column=Column(String(20)))
    acao: str = Field(sa_column=Column("acao", String(100), nullable=False, index=True))
    entidade: Optional[str] = Field(default=None, sa_column=Column(String(100)))
    entidade_id: Optional[int] = Field(default=None)
    detalhe: Optional[str] = Field(default=None)
    sucesso: bool = Field(default=True, index=True)
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )
