from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import settings
from app.db.database import engine
from app.services.scheduler_service import (
    alertar_calibracoes_proximas,
    limpeza_sessoes_expiradas,
)

from app.routers import (
    auth,
    avarias,
    calibracoes,
    equipamentos,
    manutencoes,
    reservas,
    sessoes,
    stats,
    utilizadores,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Aplicar migrações Alembic
    alembic_cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(alembic_cfg, "head")
    logger.info("Migrações Alembic aplicadas.")

    # Limpar sessões expiradas no arranque
    try:
        from sqlmodel import delete
        from app.models.sessao import SessaoAuth
        from app.services.auth_service import agora_utc
        with Session(engine) as s:
            s.exec(delete(SessaoAuth).where(SessaoAuth.expira_em < agora_utc()))
            s.commit()
    except Exception:
        logger.exception("Falha ao limpar sessões expiradas durante o arranque")

    # Garantir índice único para sessões ativas
    try:
        with Session(engine) as s:
            s.exec(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_sessao_ativa_unica "
                "ON SessoesUso (equipamento_id) WHERE fim IS NULL"
            ))
            s.commit()
        logger.info("Índice de sessão ativa única garantido em SessoesUso.")
    except Exception:
        logger.warning("Não foi possível criar índice ix_sessao_ativa_unica — check-in duplo não está protegido ao nível da BD.")

    # Inicializar APScheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(limpeza_sessoes_expiradas, trigger="interval", hours=1, id="limpeza_sessoes")
    scheduler.add_job(alertar_calibracoes_proximas, trigger="interval", hours=12, id="alertas_calibracoes")
    scheduler.start()
    logger.info("APScheduler iniciado com %d tarefa(s) agendada(s).", len(scheduler.get_jobs()))

    yield

    scheduler.shutdown(wait=False)
    logger.info("APScheduler terminado.")


app = FastAPI(
    title="Industrial Testing Lab",
    description="Gestão de equipamentos de laboratório",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(SQLAlchemyError)
async def _tratar_erro_base_dados(request, exc):
    logger.exception("Erro de base de dados não tratado em %s %s", request.method, request.url)
    return JSONResponse(
        status_code=503,
        content={"detail": "Falha temporária na base de dados. Tente novamente."},
    )


app.include_router(auth.router)
app.include_router(equipamentos.router)
app.include_router(sessoes.router)
app.include_router(avarias.router)
app.include_router(manutencoes.router)
app.include_router(calibracoes.router)
app.include_router(utilizadores.router)
app.include_router(reservas.router)
app.include_router(stats.router)
