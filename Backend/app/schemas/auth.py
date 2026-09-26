from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, model_validator

from app.models.base import RoleUtilizador


class LoginRequest(BaseModel):
    user_id: int
    pin: str


class AlterarPinRequest(BaseModel):
    pin_atual: str
    novo_pin: str


class AdminAlterarPinRequest(BaseModel):
    novo_pin: str


class AlterarRoleRequest(BaseModel):
    role: RoleUtilizador
    pin_atual: Optional[str] = None


class BootstrapAdminRequest(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    pin: str


class AutoRegistoRequest(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: Optional[str] = None
    email: Optional[str] = None
    pin: str

    @model_validator(mode="after")
    def validar_pin_registo(self) -> "AutoRegistoRequest":
        pin_normalizado = self.pin.strip()
        if len(pin_normalizado) != 4 or not pin_normalizado.isdigit():
            raise ValueError("PIN deve ter exatamente 4 dígitos")
        return self


class UtilizadorCreate(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: RoleUtilizador = RoleUtilizador.USER
    pin: Optional[str] = None


class UtilizadorUpdate(BaseModel):
    nome: Optional[str] = None
    numero_colaborador: Optional[str] = None
    departamento: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: Optional[RoleUtilizador] = None
    pin: Optional[str] = None
