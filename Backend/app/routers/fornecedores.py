from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.db.database import get_session, garantir_tabela_fornecedores
from app.models.fornecedor import Fornecedor
from app.models.manutencao import Manutencao
from app.schemas.fornecedor import FornecedorCreate
from app.services.auth_service import obter_ou_404, persistir_sessao

logger = logging.getLogger(__name__)
router = APIRouter(tags=["fornecedores"])


@router.get("/fornecedores")
def listar_fornecedores(session: Session = Depends(get_session)) -> list[Fornecedor]:
    garantir_tabela_fornecedores()
    return session.exec(select(Fornecedor).order_by(Fornecedor.nome)).all()


@router.post("/fornecedores", status_code=status.HTTP_201_CREATED)
def criar_fornecedor(
    payload: FornecedorCreate,
    session: Session = Depends(get_session),
) -> Fornecedor:
    garantir_tabela_fornecedores()
    nome = payload.nome.strip()
    if session.exec(select(Fornecedor).where(Fornecedor.nome == nome)).first():
        raise HTTPException(status_code=409, detail=f"Já existe um fornecedor com o nome '{nome}'.")
    forn = Fornecedor(**{**payload.model_dump(), "nome": nome})
    session.add(forn)
    persistir_sessao(session, "Falha ao criar fornecedor")
    session.refresh(forn)
    return forn


@router.put("/fornecedores/{fornecedor_id}")
def actualizar_fornecedor(
    fornecedor_id: int,
    payload: FornecedorCreate,
    session: Session = Depends(get_session),
) -> Fornecedor:
    garantir_tabela_fornecedores()
    forn = obter_ou_404(session, Fornecedor, fornecedor_id, "Fornecedor não encontrado")
    dados = payload.model_dump(exclude_unset=True)
    if "nome" in dados:
        dados["nome"] = dados["nome"].strip()
        conflito = session.exec(
            select(Fornecedor).where(Fornecedor.nome == dados["nome"], Fornecedor.id != fornecedor_id)
        ).first()
        if conflito:
            raise HTTPException(status_code=409, detail=f"Já existe um fornecedor com o nome '{dados['nome']}'.")
    for k, v in dados.items():
        setattr(forn, k, v)
    session.add(forn)
    persistir_sessao(session, "Falha ao actualizar fornecedor")
    session.refresh(forn)
    return forn


@router.delete("/fornecedores/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_fornecedor(
    fornecedor_id: int,
    session: Session = Depends(get_session),
) -> None:
    garantir_tabela_fornecedores()
    forn = obter_ou_404(session, Fornecedor, fornecedor_id, "Fornecedor não encontrado")
    if session.exec(select(Manutencao).where(Manutencao.fornecedor_id == fornecedor_id)).first():
        raise HTTPException(
            status_code=409,
            detail="Não é possível eliminar o fornecedor porque tem manutenções associadas.",
        )
    session.delete(forn)
    persistir_sessao(session, "Falha ao eliminar fornecedor")
