from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlmodel import SQLModel

from alembic import context

from app.core.config import settings
import app.models  # noqa: F401 — importar todos os modelos para o autogenerate os detetar

# Alembic Config object — acesso aos valores do alembic.ini
config = context.config

# Configurar logging a partir do ficheiro ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _resolver_url() -> str:
    url = settings.DATABASE_URL.strip() if settings.DATABASE_URL else ""
    if url:
        return url
    db_path = Path(__file__).resolve().parents[3] / "lab_assets.db"
    return f"sqlite:///{db_path}"


# Injetar a URL da base de dados a partir das settings da aplicação
config.set_main_option("sqlalchemy.url", _resolver_url())

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Executa migrações em modo 'offline' (sem conexão DBAPI activa)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Executa migrações em modo 'online' (com conexão activa)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
