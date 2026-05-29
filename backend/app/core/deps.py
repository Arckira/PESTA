"""Dependências FastAPI partilhadas por todos os routers."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.security import _extrair_token
from app.db.database import get_session
from app.models.sessao import SessaoAuth
from app.models.utilizador import Utilizador
from app.models.base import RoleUtilizador
from app.services.auth_service import agora_utc

logger = logging.getLogger(__name__)


def obter_utilizador_atual(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> Utilizador:
    """Valida o token e devolve o utilizador autenticado."""
    try:
        token = _extrair_token(authorization)
        sessao_auth = session.get(SessaoAuth, token)
        if not sessao_auth:
            raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")

        agora = agora_utc()
        if sessao_auth.expira_em <= agora:
            # Flush (não commit) — a limpeza não é crítica; o lifespan já o faz no arranque
            session.delete(sessao_auth)
            session.flush()
            raise HTTPException(status_code=401, detail="Sessão expirada")

        utilizador = session.get(Utilizador, sessao_auth.utilizador_id)
        if not utilizador or not utilizador.ativo:
            session.delete(sessao_auth)
            session.flush()
            raise HTTPException(status_code=401, detail="Utilizador inválido ou inativo")

        return utilizador

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao validar sessão")
        raise HTTPException(status_code=503, detail="Erro ao validar sessão") from exc


def obter_utilizador_opcional(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> Optional[Utilizador]:
    """Devolve o utilizador autenticado ou None (endpoints semi-públicos)."""
    if not authorization:
        return None
    try:
        return obter_utilizador_atual(authorization=authorization, session=session)
    except HTTPException:
        return None


def exigir_admin(
    utilizador: Utilizador = Depends(obter_utilizador_atual),
) -> Utilizador:
    if utilizador.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Acesso reservado a administradores")
    return utilizador


def exigir_pin_alterado(
    utilizador: Utilizador = Depends(obter_utilizador_atual),
) -> Utilizador:
    if utilizador.forcar_troca_pin:
        raise HTTPException(
            status_code=403, detail="PIN inicial deve ser alterado antes de continuar"
        )
    return utilizador
