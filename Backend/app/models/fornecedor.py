from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text
from sqlmodel import Field

from app.models.base import UTCDateTime, UTCModel, utc_now


class Fornecedor(UTCModel, table=True):
    __tablename__ = "Fornecedores"
    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(sa_column=Column("nome", String(150), nullable=False, unique=True, index=True))
    nif: Optional[str] = Field(default=None, sa_column=Column(String(20)))
    contacto: Optional[str] = Field(default=None, sa_column=Column(String(150)))
    email: Optional[str] = Field(default=None, sa_column=Column(String(150)))
    notas: Optional[str] = Field(default=None, sa_column=Column(Text))
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False))
