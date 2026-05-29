from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.core.deps import exigir_admin, exigir_pin_alterado
from app.core.security import _hash_pin
from app.db.database import get_session
from app.models.utilizador import Utilizador
from app.schemas.auth import AdminAlterarPinRequest, AlterarRoleRequest, UtilizadorCreate, UtilizadorUpdate
from app.services.auth_service import (
    PIN_INICIAL,
    normalizar_pin,
    obter_ou_404,
    registar_log,
    validar_formato_pin,
)

router = APIRouter(tags=["utilizadores"])


@router.get("/utilizadores")
def listar_utilizadores(
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
):
    _ = admin
    try:
        return session.exec(
            select(Utilizador).where(Utilizador.ativo == True).order_by(Utilizador.nome)
        ).all()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Falha ao listar utilizadores") from exc


@router.post("/utilizadores")
def criar_utilizador(
    dados: UtilizadorCreate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    _ = admin
    if dados.pin:
        pin_novo = normalizar_pin(dados.pin)
        validar_formato_pin(pin_novo)
        pin_hash_calculado = _hash_pin(pin_novo)
        forcar_troca = False
    else:
        pin_hash_calculado = _hash_pin(PIN_INICIAL)
        forcar_troca = True
    ut = Utilizador(
        nome=dados.nome,
        numero_colaborador=dados.numero_colaborador,
        departamento=dados.departamento,
        email=dados.email,
        cargo=dados.cargo,
        role=dados.role,
        pin_hash=pin_hash_calculado,
        forcar_troca_pin=forcar_troca,
        ativo=True,
    )
    session.add(ut)
    try:
        session.commit()
        session.refresh(ut)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao criar utilizador") from exc
    return ut


@router.delete("/utilizadores/{utilizador_id}")
def eliminar_utilizador(
    utilizador_id: int,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    ut = obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.ativo = False
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao desativar utilizador") from exc
    return {"mensagem": "Utilizador desativado"}


@router.patch("/utilizadores/{utilizador_id}")
def atualizar_utilizador(
    utilizador_id: int,
    dados: UtilizadorUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    _ = admin
    ut = obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    dados_dict = dados.model_dump(exclude_unset=True)
    pin_novo = dados_dict.pop("pin", None)
    for campo, valor in dados_dict.items():
        setattr(ut, campo, valor)
    if pin_novo:
        pin_normalizado = normalizar_pin(pin_novo)
        validar_formato_pin(pin_normalizado)
        ut.pin_hash = _hash_pin(pin_normalizado)
        ut.forcar_troca_pin = False
    session.add(ut)
    try:
        session.commit()
        session.refresh(ut)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar utilizador") from exc
    return ut


@router.patch("/utilizadores/{utilizador_id}/pin")
def admin_alterar_pin_utilizador(
    utilizador_id: int,
    dados: AdminAlterarPinRequest,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    novo_pin = normalizar_pin(dados.novo_pin)
    validar_formato_pin(novo_pin)
    ut = obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.pin_hash = _hash_pin(novo_pin)
    ut.forcar_troca_pin = True
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar PIN do utilizador") from exc
    registar_log("admin_alterar_pin", True, "PIN alterado por admin", utilizador_id)
    return {"mensagem": "PIN atualizado e troca obrigatória ativada"}


@router.patch("/utilizadores/{utilizador_id}/role")
def admin_alterar_role_utilizador(
    utilizador_id: int,
    dados: AlterarRoleRequest,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    ut = obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.role = dados.role
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar perfil do utilizador") from exc
    return {"mensagem": "Role atualizada com sucesso"}
