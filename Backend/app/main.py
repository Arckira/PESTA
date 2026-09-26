from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import settings
from app.db.database import (
    engine,
    garantir_colunas_sessaouso,
    garantir_colunas_avarias,
    garantir_colunas_manutencoes,
    garantir_tabela_fornecedores,
    garantir_coluna_equipamentos_seccao,
)
from app.services.scheduler_service import (
    alertar_calibracoes_proximas,
    limpeza_sessoes_expiradas,
)

from app.routers import (
    auth,
    avarias,
    calibracoes,
    equipamentos,
    financeiro,
    fornecedores,
    manutencoes,
    reservas,
    sessoes,
    stats,
    utilizadores,
)

def _configurar_logging() -> None:
    """Logging rotativo para produção 24/7.

    RotatingFileHandler: sem rotação, o ficheiro cresce sem limite em servidores
    que correm semanas sem reinício. 5 MB × 5 ficheiros = máx ~25 MB histórico.
    _root.handlers.clear() evita duplicação de handlers em hot-reload uvicorn.
    """
    logging.getLogger("alembic").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    _logs_dir = Path(__file__).resolve().parents[1] / "logs"
    _logs_dir.mkdir(exist_ok=True)

    _fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    _file_handler = logging.handlers.RotatingFileHandler(
        _logs_dir / "testing_centre.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    _file_handler.setFormatter(_fmt)

    _console_handler = logging.StreamHandler()
    _console_handler.setFormatter(_fmt)

    _root = logging.getLogger()
    _root.setLevel(logging.INFO)
    _root.handlers.clear()
    _root.addHandler(_file_handler)
    _root.addHandler(_console_handler)


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("alembic").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    # Aplicar migrações Alembic PRIMEIRO — alembic_command.upgrade() chama internamente
    # logging.config.fileConfig() que reseta todos os handlers. Só depois reconfiguramos.
    alembic_cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(alembic_cfg, "head")

    # Reconfigura logging depois do Alembic (e do uvicorn dictConfig) terem corrido.
    _configurar_logging()
    logger.info("Migrações Alembic aplicadas.")

    # Garantir colunas adicionadas após criação inicial da BD (migrações lazy)
    garantir_colunas_sessaouso()
    garantir_colunas_avarias()
    garantir_colunas_manutencoes()
    garantir_tabela_fornecedores()
    garantir_coluna_equipamentos_seccao()

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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)

@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


_UPLOADS_DIR = Path(__file__).resolve().parents[1] / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")


@app.exception_handler(RequestValidationError)
async def _tratar_erro_validacao(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Dados de entrada inválidos.", "erros": exc.errors()},
    )


@app.get("/health", tags=["Sistema"])
async def health_check():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.exception_handler(SQLAlchemyError)
async def _tratar_erro_base_dados(request, exc):
    logger.exception("Erro de base de dados não tratado em %s %s", request.method, request.url)
    return JSONResponse(
        status_code=503,
        content={"detail": "Falha temporária na base de dados. Tente novamente."},
    )


@app.exception_handler(Exception)
async def _tratar_erro_generico(request, exc):
    """Captura qualquer excepção não tratada — devolve 500 sem expor stack trace ao cliente."""
    logger.exception("Excepção não tratada em %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno do servidor. Consulte os logs para detalhes."},
    )


app.include_router(auth.router,         prefix="/api")
app.include_router(equipamentos.router,  prefix="/api")
app.include_router(sessoes.router,       prefix="/api")
app.include_router(avarias.router,       prefix="/api")
app.include_router(manutencoes.router,   prefix="/api")
app.include_router(fornecedores.router,  prefix="/api")
app.include_router(calibracoes.router,   prefix="/api")
app.include_router(utilizadores.router,  prefix="/api")
app.include_router(reservas.router,      prefix="/api")
app.include_router(stats.router,         prefix="/api")
app.include_router(financeiro.router,    prefix="/api")


# Diretoria do frontend compilado (Backend/dist). Opcional em desenvolvimento:
# no fluxo de dev documentado (Vite dev server + backend em processos separados),
# esta pasta não existe — só é produzida ao empacotar a app num único servidor.
_DIST_DIR = Path(__file__).resolve().parents[1] / "dist"

if _DIST_DIR.is_dir():
    # Assets compilados (JS/CSS) — caminho físico real
    app.mount("/assets", StaticFiles(directory=_DIST_DIR / "assets"), name="assets")

    # SPA fallback: qualquer rota não-API e não-asset devolve o index.html.
    # O React Router trata o encaminhamento no cliente. DEVE ser a última rota.
    @app.get("/{caminho_spa:path}")
    async def servir_spa(caminho_spa: str):
        ficheiro = _DIST_DIR / caminho_spa
        if ficheiro.is_file():
            return FileResponse(ficheiro)        # favicon, manifest, etc.
        return FileResponse(_DIST_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
