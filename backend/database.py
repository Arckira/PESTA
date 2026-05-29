"""Configuração da camada de acesso a dados — SQLite via SQLModel/SQLAlchemy.

Porquê SQLite: self-contained, sem drivers externos, sem privilégios de IT,
portável entre máquinas do laboratório com um único ficheiro .db.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, Session, create_engine

logger = logging.getLogger(__name__)


def _load_dotenv_from_project_root() -> None:
    """Carrega variáveis de ambiente de `.env` na raiz do projeto sem sobrescrever as existentes."""
    project_root = Path(__file__).resolve().parent
    env_path = project_root / ".env"
    if not env_path.exists():
        return
    try:
        with env_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key, val = key.strip(), val.strip()
                if (val.startswith('"') and val.endswith('"')) or \
                   (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass


_load_dotenv_from_project_root()


def _obter_database_url() -> str:
    """Resolve a URL da BD: usa DATABASE_URL do .env ou cria ficheiro local lab_assets.db."""
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    db_path = Path(__file__).resolve().parent / "lab_assets.db"
    return f"sqlite:///{db_path}"


DATABASE_URL = _obter_database_url()

# Flag mantida por compatibilidade com main.py (não remover)
IS_MSSQL = DATABASE_URL.lower().startswith("mssql")


def _criar_engine() -> Engine:
    """Cria engine SQLite com WAL mode para concorrência de leitura e chaves estrangeiras ativas.

    Porquê listener em vez de PRAGMA direto:
        No SQLite, os PRAGMAs são connection-scoped — aplicar uma vez na conexão
        de teste do arranque não garante que novas conexões do pool os herdem.
        O evento 'connect' do SQLAlchemy é disparado para CADA nova conexão
        criada pelo pool, garantindo que WAL, FKs e busy_timeout estão sempre ativos.

    busy_timeout=5000:
        Em ambiente de laboratório com múltiplos técnicos a fazer check-in via
        QR Code em simultâneo, o SQLite pode retornar 'database is locked'
        imediatamente quando existe um write lock ativo. Com 5000ms de timeout,
        o motor retenta automaticamente durante 5 segundos antes de falhar,
        eliminando virtualmente erros de lock transitórios para < 20 utilizadores.
    """
    try:
        eng = create_engine(
            DATABASE_URL,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
            echo=os.getenv("SQL_ECHO", "false").strip().lower() == "true",
        )

        # Aplicar apenas para SQLite — SQL Server gere concorrência de forma diferente
        if not DATABASE_URL.lower().startswith("mssql"):
            from sqlalchemy import event as sa_event

            @sa_event.listens_for(eng, "connect")
            def _configurar_sqlite(dbapi_conn, _connection_record) -> None:
                """Configura cada nova conexão SQLite com os PRAGMAs obrigatórios."""
                cursor = dbapi_conn.cursor()
                # WAL permite leituras concorrentes sem bloquear escritas
                cursor.execute("PRAGMA journal_mode=WAL")
                # Ativa integridade referencial (desativada por omissão no SQLite)
                cursor.execute("PRAGMA foreign_keys=ON")
                # Espera até 5s antes de lançar 'database is locked'
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.close()

        return eng
    except SQLAlchemyError as exc:
        logger.exception("Falha ao criar a engine da base de dados")
        raise RuntimeError("Não foi possível configurar a base de dados") from exc


engine = _criar_engine()


def _garantir_coluna_mssql(connection, tabela: str, coluna: str, definicao: str) -> None:
    """Garante coluna numa tabela para migrações incrementais simples.

    Compatível com SQLite e SQL Server. Se a coluna já existir, não faz nada.
    """

    dialect = connection.dialect.name

    if dialect == "sqlite":
        colunas = {
            row[1]
            for row in connection.exec_driver_sql(f'PRAGMA table_info("{tabela}")').fetchall()
        }
        if coluna in colunas:
            return
        connection.exec_driver_sql(
            f'ALTER TABLE "{tabela}" ADD COLUMN "{coluna}" {definicao}'
        )
        logger.info("Coluna %s.%s adicionada em SQLite", tabela, coluna)
        return

    if dialect == "mssql":
        resultado = connection.exec_driver_sql(
            """
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = :tabela AND COLUMN_NAME = :coluna
            """,
            {"tabela": tabela, "coluna": coluna},
        ).first()
        if resultado:
            return
        connection.exec_driver_sql(
            f"ALTER TABLE [{tabela}] ADD [{coluna}] {definicao}"
        )
        logger.info("Coluna %s.%s adicionada em SQL Server", tabela, coluna)
        return

    logger.debug(
        "Dialeto %s sem suporte para _garantir_coluna_mssql (%s.%s)",
        dialect,
        tabela,
        coluna,
    )


def _garantir_indices_filtrados_mssql() -> None:
    """Stub de compatibilidade com main.py — no-op em SQLite."""
    pass


def validar_ligacao() -> None:
    """Valida a ligação à BD com uma query simples."""
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except SQLAlchemyError as exc:
        logger.exception("Falha na validação da ligação à base de dados")
        raise RuntimeError("Falha de ligação à base de dados") from exc


def criar_tabelas() -> None:
    """Cria todas as tabelas definidas nos modelos SQLModel (idempotente)."""
    try:
        validar_ligacao()
        SQLModel.metadata.create_all(engine)
        logger.info("Esquema da base de dados inicializado: %s", DATABASE_URL)
    except SQLAlchemyError as exc:
        logger.exception("Falha ao inicializar o esquema relacional")
        raise RuntimeError("Não foi possível inicializar a base de dados") from exc


def get_session() -> Generator[Session, Any, None]:
    """Disponibiliza uma sessão transacional por pedido FastAPI."""
    with Session(engine) as session:
        yield session
