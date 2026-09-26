"""Camada de acesso a dados — SQLite/MSSQL via SQLModel/SQLAlchemy."""

from __future__ import annotations

import logging
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, Session, create_engine

from app.core.config import settings

logger = logging.getLogger(__name__)


def _resolver_database_url() -> str:
    url = settings.DATABASE_URL.strip()
    if url:
        return url
    db_path = Path(__file__).resolve().parents[2] / "lab_assets.db"
    return f"sqlite:///{db_path}"


DATABASE_URL: str = _resolver_database_url()
IS_MSSQL: bool = DATABASE_URL.lower().startswith("mssql")


def _criar_engine() -> Engine:
    """Cria engine com WAL mode e busy_timeout via listener por-conexão.

    Porquê listener em vez de PRAGMA direto: os PRAGMAs são connection-scoped
    no SQLite. O evento 'connect' é disparado para CADA nova conexão do pool,
    garantindo que WAL, FKs e busy_timeout estão sempre activos.
    """
    try:
        eng = create_engine(
            DATABASE_URL,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
            echo=settings.SQL_ECHO,
        )

        if not IS_MSSQL:
            from sqlalchemy import event as sa_event

            @sa_event.listens_for(eng, "connect")
            def _configurar_sqlite(dbapi_conn, _connection_record) -> None:
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.close()

        return eng
    except SQLAlchemyError as exc:
        logger.exception("Falha ao criar a engine da base de dados")
        raise RuntimeError("Não foi possível configurar a base de dados") from exc


engine = _criar_engine()


def _garantir_coluna_mssql(connection, tabela: str, coluna: str, definicao: str) -> None:
    """Garante coluna numa tabela para migrações incrementais simples.

    Compatível com SQLite e SQL Server. Idempotente — não faz nada se a coluna já existir.
    """
    dialect = connection.dialect.name

    if dialect == "sqlite":
        colunas = {
            row[1]
            for row in connection.exec_driver_sql(f'PRAGMA table_info("{tabela}")').fetchall()
        }
        if coluna in colunas:
            return
        connection.exec_driver_sql(f'ALTER TABLE "{tabela}" ADD COLUMN "{coluna}" {definicao}')
        logger.info("Coluna %s.%s adicionada em SQLite", tabela, coluna)
        return

    if dialect == "mssql":
        resultado = connection.exec_driver_sql(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME = :tabela AND COLUMN_NAME = :coluna",
            {"tabela": tabela, "coluna": coluna},
        ).first()
        if resultado:
            return
        connection.exec_driver_sql(f"ALTER TABLE [{tabela}] ADD [{coluna}] {definicao}")
        logger.info("Coluna %s.%s adicionada em SQL Server", tabela, coluna)
        return

    logger.debug("Dialeto %s sem suporte para _garantir_coluna_mssql (%s.%s)", dialect, tabela, coluna)


# ─── Migrações lazy (executadas na primeira chamada ao endpoint relevante) ───

_sessaouso_migrada = False
_avarias_migrada = False
_manutencoes_migrada = False
_fornecedores_migrada = False
_equipamentos_seccao_migrada = False


def garantir_colunas_sessaouso() -> None:
    global _sessaouso_migrada
    if _sessaouso_migrada:
        return
    try:
        tipo_int = "INT" if IS_MSSQL else "INTEGER"
        tipo_datetime = "DATETIME" if IS_MSSQL else "TIMESTAMP"
        tipo_bool = "BIT" if IS_MSSQL else "INTEGER"
        tipo_texto_150 = "NVARCHAR(150)" if IS_MSSQL else "VARCHAR(150)"
        tipo_texto_180 = "NVARCHAR(180)" if IS_MSSQL else "VARCHAR(180)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "SessoesUso", "duracao_prevista_minutos", f"{tipo_int} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "fim_automatico", f"{tipo_datetime} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "termino_forcado", f"{tipo_bool} NOT NULL DEFAULT 0")
            _garantir_coluna_mssql(conn, "SessoesUso", "valida_para_stats", f"{tipo_bool} NOT NULL DEFAULT 1")
            _garantir_coluna_mssql(conn, "SessoesUso", "projeto", f"{tipo_texto_150} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "metodo", f"{tipo_texto_180} NULL")
        _sessaouso_migrada = True
        logger.info("Colunas SessoesUso garantidas.")
    except Exception:
        logger.warning("Não foi possível garantir colunas SessoesUso — re-tentada na próxima chamada.")


def garantir_colunas_avarias() -> None:
    global _avarias_migrada
    if _avarias_migrada:
        return
    try:
        from app.models.avaria import SeveridadeAvaria  # evitar importação circular no topo

        tipo_float = "FLOAT" if IS_MSSQL else "REAL"
        tipo_texto_150 = "NVARCHAR(150)" if IS_MSSQL else "VARCHAR(150)"
        tipo_texto_100 = "NVARCHAR(100)" if IS_MSSQL else "VARCHAR(100)"
        tipo_texto_20 = "NVARCHAR(20)" if IS_MSSQL else "VARCHAR(20)"
        tipo_texto_500 = "NVARCHAR(500)" if IS_MSSQL else "VARCHAR(500)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "Avarias", "custo_reparacao", f"{tipo_float} NULL")
            _garantir_coluna_mssql(conn, "Avarias", "empresa_externa", f"{tipo_texto_150} NULL")
            _garantir_coluna_mssql(conn, "Avarias", "num_sc_po", f"{tipo_texto_100} NULL")
            _garantir_coluna_mssql(
                conn,
                "Avarias",
                "severidade",
                f"{tipo_texto_20} NOT NULL DEFAULT '{SeveridadeAvaria.BLOQUEANTE.value}'",
            )
            _garantir_coluna_mssql(conn, "Avarias", "caminho_anexo", f"{tipo_texto_500} NULL")
        _avarias_migrada = True
        logger.info("Colunas Avarias garantidas.")
    except Exception:
        logger.warning("Não foi possível garantir colunas Avarias — re-tentada na próxima chamada.")


def garantir_colunas_manutencoes() -> None:
    global _manutencoes_migrada
    if _manutencoes_migrada:
        return
    try:
        tipo_int = "INT" if IS_MSSQL else "INTEGER"
        tipo_texto_60 = "NVARCHAR(60)" if IS_MSSQL else "VARCHAR(60)"
        tipo_texto_150 = "NVARCHAR(150)" if IS_MSSQL else "VARCHAR(150)"
        tipo_float = "FLOAT" if IS_MSSQL else "REAL"
        tipo_texto_100 = "NVARCHAR(100)" if IS_MSSQL else "VARCHAR(100)"
        tipo_texto_longo = "NVARCHAR(MAX)" if IS_MSSQL else "TEXT"
        tipo_texto_500 = "NVARCHAR(500)" if IS_MSSQL else "VARCHAR(500)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "Manutencoes", "tipo_intervencao", f"{tipo_texto_60} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "custo_eur", f"{tipo_float} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "referencia_sc_po", f"{tipo_texto_100} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "observacoes_externas", f"{tipo_texto_longo} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "caminho_anexo", f"{tipo_texto_500} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "fornecedor", f"{tipo_texto_150} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "fornecedor_id", f"{tipo_int} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "origem_avaria_id", f"{tipo_int} NULL")
        _manutencoes_migrada = True
        logger.info("Colunas Manutencoes garantidas.")
    except Exception:
        logger.warning("Não foi possível garantir colunas Manutencoes — re-tentada na próxima chamada.")


def garantir_coluna_equipamentos_seccao() -> None:
    global _equipamentos_seccao_migrada
    if _equipamentos_seccao_migrada:
        return
    try:
        tipo_texto_50 = "NVARCHAR(50)" if IS_MSSQL else "VARCHAR(50)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(
                conn,
                "Equipamentos",
                "seccao",
                f"{tipo_texto_50} NOT NULL DEFAULT 'Environmental'",
            )
        _equipamentos_seccao_migrada = True
        logger.info("Coluna Equipamentos.seccao garantida.")
    except Exception:
        logger.warning("Não foi possível garantir coluna Equipamentos.seccao — re-tentada na próxima chamada.")


def garantir_tabela_fornecedores() -> None:
    global _fornecedores_migrada
    if _fornecedores_migrada:
        return
    try:
        from app.models.fornecedor import Fornecedor  # evitar importação circular no topo
        tipo_int = "INT" if IS_MSSQL else "INTEGER"
        SQLModel.metadata.create_all(engine, tables=[Fornecedor.__table__])
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "Manutencoes", "fornecedor_id", f"{tipo_int} NULL")
        _fornecedores_migrada = True
        logger.info("Tabela Fornecedores e coluna Manutencoes.fornecedor_id garantidas.")
    except Exception:
        logger.warning("Não foi possível garantir tabela Fornecedores — re-tentada na próxima chamada.")


def validar_ligacao() -> None:
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
