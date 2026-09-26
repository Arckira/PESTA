from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.core.deps import exigir_admin, obter_utilizador_atual
from app.core.security import _hash_pin, _verificar_pin
from app.db.database import get_session
from app.models.base import RoleUtilizador
from app.models.sessao import SessaoAuth
from app.models.utilizador import Utilizador
from app.schemas.auth import (
    AdminAlterarPinRequest,
    AlterarPinRequest,
    AutoRegistoRequest,
    BootstrapAdminRequest,
    LoginRequest,
)
from app.services.auth_service import (
    PIN_INICIAL,
    TOKEN_TTL_MINUTOS,
    agora_utc,
    criar_sessao_auth,
    iniciais_utilizador,
    iso_z,
    limpar_sessoes_expiradas,
    normalizar_pin,
    obter_logs_auth,
    persistir_sessao,
    registar_log,
    registar_log_bd,
    validar_formato_pin,
)

router = APIRouter(tags=["auth"])


@router.get("/auth/utilizadores", summary="Lista de utilizadores ativos para login")
def listar_utilizadores_login(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    utilizadores = session.exec(
        select(Utilizador).where(Utilizador.ativo == True).order_by(Utilizador.nome)
    ).all()
    return [{"id": u.id, "nome": u.nome, "iniciais": iniciais_utilizador(u)} for u in utilizadores]


@router.post("/auth/login", summary="Login por utilizador + PIN")
def auth_login(dados: LoginRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    pin = normalizar_pin(dados.pin)
    validar_formato_pin(pin)

    utilizador = session.get(Utilizador, dados.user_id)
    if not utilizador or not utilizador.ativo:
        registar_log("login", False, "Utilizador não encontrado ou inativo", dados.user_id)
        raise HTTPException(status_code=404, detail="Utilizador não encontrado")

    if not utilizador.pin_hash or "$" not in utilizador.pin_hash:
        utilizador.pin_hash = _hash_pin(PIN_INICIAL)
        utilizador.forcar_troca_pin = True
        session.add(utilizador)
        persistir_sessao(session, "Falha ao inicializar credenciais do utilizador")
        session.refresh(utilizador)

    if not _verificar_pin(pin, utilizador.pin_hash):
        registar_log("login", False, "PIN inválido", utilizador.id)
        raise HTTPException(status_code=401, detail="PIN inválido")

    agora = agora_utc()
    inicio_do_dia = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    sessao_ativa = session.exec(
        select(SessaoAuth).where(
            SessaoAuth.utilizador_id == utilizador.id,
            SessaoAuth.criado_em >= inicio_do_dia,
            SessaoAuth.expira_em > agora,
        )
    ).first()

    if sessao_ativa:
        sessao_ativa.expira_em = agora + timedelta(minutes=TOKEN_TTL_MINUTOS)
        session.add(sessao_ativa)
        registar_log_bd(session, "login_renovacao", True, "Token renovado (mesmo turno)", utilizador.id, utilizador.nome, str(utilizador.role))
        try:
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            raise HTTPException(status_code=503, detail="Falha ao renovar sessão") from exc
        sessao = {
            "token": sessao_ativa.token,
            "expira_em": iso_z(sessao_ativa.expira_em),
            "expira_em_epoch_ms": int(sessao_ativa.expira_em.timestamp() * 1000),
        }
    else:
        registar_log_bd(session, "login", True, "Login com sucesso", utilizador.id, utilizador.nome, str(utilizador.role))
        sessao = criar_sessao_auth(utilizador, session)

    registar_log("login", True, "Login com sucesso", utilizador.id)
    return {
        "token": sessao["token"],
        "expira_em": sessao["expira_em"],
        "expira_em_epoch_ms": sessao["expira_em_epoch_ms"],
        "utilizador": {
            "id": utilizador.id,
            "nome": utilizador.nome,
            "iniciais": iniciais_utilizador(utilizador),
            "role": utilizador.role.value if isinstance(utilizador.role, RoleUtilizador) else str(utilizador.role),
            "forcar_troca_pin": utilizador.forcar_troca_pin,
        },
    }


@router.get("/auth/bootstrap-status", summary="Estado da configuração inicial")
def auth_bootstrap_status(session: Session = Depends(get_session)):
    existe_admin = session.exec(
        select(Utilizador).where(Utilizador.ativo == True, Utilizador.role == RoleUtilizador.ADMIN)
    ).first()
    return {"has_admin": bool(existe_admin), "can_bootstrap": not bool(existe_admin)}


@router.post("/auth/bootstrap-admin", summary="Criar primeiro admin (uso único)")
def auth_bootstrap_admin(
    dados: BootstrapAdminRequest, session: Session = Depends(get_session)
) -> dict[str, Any]:
    existe_admin = session.exec(
        select(Utilizador).where(Utilizador.ativo == True, Utilizador.role == RoleUtilizador.ADMIN)
    ).first()
    if existe_admin:
        raise HTTPException(status_code=403, detail="Bootstrap indisponível: já existe um administrador ativo")

    pin = normalizar_pin(dados.pin)
    validar_formato_pin(pin)

    utilizador_existente = session.exec(
        select(Utilizador).where(Utilizador.numero_colaborador == dados.numero_colaborador)
    ).first()

    if utilizador_existente:
        utilizador_existente.nome = dados.nome
        utilizador_existente.departamento = dados.departamento
        utilizador_existente.pin_hash = _hash_pin(pin)
        utilizador_existente.role = RoleUtilizador.ADMIN
        utilizador_existente.ativo = True
        utilizador_existente.forcar_troca_pin = False
        admin = utilizador_existente
    else:
        admin = Utilizador(
            nome=dados.nome,
            numero_colaborador=dados.numero_colaborador,
            departamento=dados.departamento,
            pin_hash=_hash_pin(pin),
            role=RoleUtilizador.ADMIN,
            ativo=True,
            forcar_troca_pin=False,
        )
    session.add(admin)
    persistir_sessao(session, "Falha ao criar administrador inicial")
    session.refresh(admin)
    registar_log("bootstrap_admin", True, "Primeiro admin criado", admin.id)
    return {"mensagem": "Admin inicial criado com sucesso", "utilizador_id": admin.id}


@router.post("/auth/auto-registo", summary="Auto-registo de novo utilizador")
def auth_auto_registo(dados: AutoRegistoRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    pin = normalizar_pin(dados.pin)
    utilizador_existente = session.exec(
        select(Utilizador).where(Utilizador.numero_colaborador == dados.numero_colaborador.strip())
    ).first()
    if utilizador_existente:
        registar_log("auto_registo", False, f"Número duplicado: {dados.numero_colaborador}", None)
        raise HTTPException(status_code=409, detail="Número de colaborador já está registado no sistema")

    try:
        novo = Utilizador(
            nome=dados.nome.strip(),
            numero_colaborador=dados.numero_colaborador.strip(),
            departamento=dados.departamento.strip() if dados.departamento else None,
            email=dados.email.strip() if dados.email else None,
            pin_hash=_hash_pin(pin),
            role=RoleUtilizador.USER,
            ativo=True,
            forcar_troca_pin=False,
        )
        session.add(novo)
        persistir_sessao(session, "Falha ao registar novo utilizador")
        session.refresh(novo)
        registar_log("auto_registo", True, f"Auto-registo: {novo.nome} ({novo.numero_colaborador})", novo.id)
        registar_log_bd(session, "auto_registo", True, f"Novo utilizador: {novo.nome}", novo.id, novo.nome, str(novo.role), "Utilizador", novo.id)
        return {"mensagem": "Auto-registo bem-sucedido", "utilizador_id": novo.id, "utilizador_nome": novo.nome}
    except SQLAlchemyError as exc:
        session.rollback()
        registar_log("auto_registo", False, "Erro de base de dados", None)
        raise HTTPException(status_code=503, detail="Falha ao registar utilizador na base de dados") from exc


@router.get("/auth/me", summary="Utilizador atual")
def auth_me(utilizador: Utilizador = Depends(obter_utilizador_atual)) -> dict[str, Any]:
    return {
        "id": utilizador.id,
        "nome": utilizador.nome,
        "iniciais": iniciais_utilizador(utilizador),
        "role": utilizador.role,
        "forcar_troca_pin": utilizador.forcar_troca_pin,
    }


@router.post("/auth/logout", summary="Terminar sessão")
def auth_logout(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    from app.core.security import _extrair_token

    try:
        token = _extrair_token(authorization)
        sessao_auth = session.get(SessaoAuth, token)
        if sessao_auth:
            uid = sessao_auth.utilizador_id
            registar_log_bd(session, "logout", True, "Sessão terminada", uid)
            session.delete(sessao_auth)
            session.commit()
            registar_log("logout", True, "Sessão terminada", uid)
        else:
            registar_log("logout", False, "Sessão não encontrada", None)
        return {"mensagem": "Sessão terminada"}
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Erro ao terminar sessão") from exc


@router.patch("/auth/pin", summary="Alterar o próprio PIN")
def auth_alterar_pin(
    dados: AlterarPinRequest,
    utilizador: Utilizador = Depends(obter_utilizador_atual),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    pin_atual = normalizar_pin(dados.pin_atual)
    novo_pin = normalizar_pin(dados.novo_pin)
    validar_formato_pin(pin_atual)
    validar_formato_pin(novo_pin)
    if not _verificar_pin(pin_atual, utilizador.pin_hash):
        raise HTTPException(status_code=401, detail="PIN atual inválido")
    utilizador.pin_hash = _hash_pin(novo_pin)
    utilizador.forcar_troca_pin = False
    session.add(utilizador)
    registar_log_bd(session, "alterar_pin", True, "PIN alterado", utilizador.id, utilizador.nome, str(utilizador.role))
    persistir_sessao(session, "Falha ao atualizar PIN")
    registar_log("alterar_pin", True, "PIN alterado pelo utilizador", utilizador.id)
    return {"mensagem": "PIN atualizado com sucesso"}


@router.get("/auth/logs", summary="Logs de autenticação em memória (sessão atual)")
def auth_logs(admin: Utilizador = Depends(exigir_admin)):
    _ = admin
    return obter_logs_auth()


@router.get("/admin/logs", summary="Logs de auditoria persistentes na BD")
def listar_logs_bd(
    limite: int = 200,
    admin: Utilizador = Depends(exigir_admin),
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    _ = admin
    from app.models.log import Log

    try:
        entradas = session.exec(
            select(Log).order_by(Log.criado_em.desc()).limit(min(limite, 1000))
        ).all()
        return [
            {
                "id": e.id,
                "utilizador_id": e.utilizador_id,
                "utilizador_nome": e.utilizador_nome,
                "role": e.role,
                "acao": e.acao,
                "entidade": e.entidade,
                "entidade_id": e.entidade_id,
                "detalhe": e.detalhe,
                "sucesso": e.sucesso,
                "criado_em": iso_z(e.criado_em),
            }
            for e in entradas
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Falha ao obter logs de auditoria") from exc


@router.post("/auth/manutenacao/limpar-sessoes", summary="Limpar sessões expiradas (Admin)")
def admin_limpar_sessoes(
    admin: Utilizador = Depends(exigir_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    quantidade = limpar_sessoes_expiradas(session)
    return {"mensagem": f"Removidas {quantidade} sessões expiradas", "quantidade": quantidade, "executado_por": admin.nome}
