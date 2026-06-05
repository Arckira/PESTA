from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class FornecedorCreate(BaseModel):
    nome: str
    nif: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    notas: Optional[str] = None
