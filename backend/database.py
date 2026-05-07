"""Configuracao da camada de acesso a dados — exclusiva SQL Server 2022 Express.

O objetivo deste modulo e centralizar a criacao da engine SQLModel/SQLAlchemy
e encapsular detalhes de ligacao ao SQL Server via pyodbc.
Migrações SQLite foram removidas: o projeto é exclusivo MSSQL.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from sqlalchemy.exc import SQLAlchemyError, ProgrammingError
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, Session, create_engine

logger = logging.getLogger(__name__)

DEFAULT_MSSQL_DRIVER = "ODBC Driver 18 for SQL Server"


def _load_dotenv_from_project_root() -> None:
    """Carrega variaveis de ambiente definidas em `.env` na raiz do projecto.

    Nao sobrescreve variaveis ja presentes em `os.environ`.
    """

    project_root = Path(__file__).resolve().parents[1]
    env_path = project_root / ".env"
    if not env_path.exists():
        return

    try:
        with env_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip()
                if (val.startswith('"') and val.endswith('"')) or (
                    val.startswith("'") and val.endswith("'")
                ):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass


_load_dotenv_from_project_root()


def _obter_database_url() -> str:
    """Resolve a URL da base de dados a partir do ambiente.

    Returns:
        str: URL final para a engine SQLAlchemy.

    Raises:
        ValueError: Se nenhuma configuracao MSSQL for encontrada.
            Porque: arranques silenciosos com BD errada causam erros difíceis
            de diagnosticar; falhar explicitamente é mais seguro.
    """

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return database_url

    mssql_server = os.getenv("MSSQL_SERVER", "").strip()
    mssql_database = os.getenv("MSSQL_DATABASE", "").strip()
    if not mssql_server or not mssql_database:
        raise ValueError(
            "Configuracao MSSQL em falta. "
            "Defina DATABASE_URL ou MSSQL_SERVER + MSSQL_DATABASE no ambiente (.env ou variavel de sistema)."
        )

    mssql_user = os.getenv("MSSQL_USER", "").strip()
    mssql_password = os.getenv("MSSQL_PASSWORD", "").strip()
    mssql_driver = os.getenv("MSSQL_DRIVER", DEFAULT_MSSQL_DRIVER).strip()
    mssql_encrypt = os.getenv("MSSQL_ENCRYPT", "yes").strip()
    mssql_trust_cert = os.getenv("MSSQL_TRUST_SERVER_CERTIFICATE", "yes").strip()

    if mssql_user and mssql_password:
        connection_string = (
            f"DRIVER={{{mssql_driver}}};"
            f"SERVER={mssql_server};"
            f"DATABASE={mssql_database};"
            f"UID={mssql_user};"
            f"PWD={mssql_password};"
            f"Encrypt={mssql_encrypt};"
            f"TrustServerCertificate={mssql_trust_cert};"
        )
    else:
        connection_string = (
            f"DRIVER={{{mssql_driver}}};"
            f"SERVER={mssql_server};"
            f"DATABASE={mssql_database};"
            f"Trusted_Connection=yes;"
            f"Encrypt={mssql_encrypt};"
            f"TrustServerCertificate={mssql_trust_cert};"
        )

    return f"mssql+pyodbc:///?odbc_connect={quote_plus(connection_string)}"


DATABASE_URL = _obter_database_url()
IS_MSSQL = DATABASE_URL.startswith("mssql+pyodbc")


def _criar_engine() -> Engine:
    """Cria uma engine para SQL Server.

    Returns:
        Engine: Engine pronta para uso pela aplicacao.

    Raises:
        RuntimeError: Se a engine nao puder ser criada (falha de arranque irrecuperável).
    """

    try:
        return create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            pool_recycle=1800,
            echo=os.getenv("SQL_ECHO", "false").strip().lower() == "true",
        )
    except SQLAlchemyError as exc:
        logger.exception("Falha ao criar a engine da base de dados")
        raise RuntimeError("Nao foi possivel configurar a base de dados") from exc


engine = _criar_engine()


def _garantir_coluna_mssql(connection, tabela: str, coluna: str, definicao: str) -> None:
    """Adiciona uma coluna em SQL Server apenas se ainda nao existir."""

    resultado = connection.exec_driver_sql(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE TABLE_NAME = '{tabela}' AND COLUMN_NAME = '{coluna}'"
    ).first()
    if not resultado:
        connection.exec_driver_sql(f"ALTER TABLE [{tabela}] ADD [{coluna}] {definicao}")


def _garantir_indices_filtrados_mssql() -> None:
    """Cria indices unicos filtrados e adiciona colunas em falta no SQL Server.

    Porque: em SQL Server, UNIQUE sobre colunas anulaveis pode introduzir
    restricoes indesejadas para multiplos registos com NULL. O indice filtrado
    preserva unicidade apenas quando existe valor real.
    Esta funcao e idempotente — pode ser chamada multiplas vezes em seguranca.
    """

    if not IS_MSSQL:
        return

    with engine.begin() as connection:
        # ─── Indices unicos filtrados (NULL-safe) ───
        for instrucao in (
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_equipamentos_numero_serie_not_null')
                CREATE UNIQUE INDEX ux_equipamentos_numero_serie_not_null
                ON Equipamentos (numero_serie) WHERE numero_serie IS NOT NULL
            """,
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_utilizadores_email_not_null')
                CREATE UNIQUE INDEX ux_utilizadores_email_not_null
                ON Utilizadores (email) WHERE email IS NOT NULL
            """,
        ):
            try:
                connection.exec_driver_sql(instrucao)
            except Exception:
                logger.warning(
                    "Nao foi possivel garantir indice filtrado: %.80s", instrucao.strip()
                )

        # ─── Colunas em falta: Equipamentos ───
        for coluna, definicao in (
            ("numero_serie",      "NVARCHAR(100)  NULL"),
            ("temp_min",          "FLOAT          NULL"),
            ("temp_max",          "FLOAT          NULL"),
            ("humidade_max",      "FLOAT          NULL"),
            ("fabricante",        "NVARCHAR(120)  NULL"),
            ("modelo",            "NVARCHAR(120)  NULL"),
            ("ano_fabrico",       "INT            NULL"),
            ("largura_mm",        "FLOAT          NULL"),
            ("altura_mm",         "FLOAT          NULL"),
            ("profundidade_mm",   "FLOAT          NULL"),
            ("volume_l",          "FLOAT          NULL"),
            ("potencia_kw",       "FLOAT          NULL"),
            ("ligacao_eletrica",  "NVARCHAR(80)   NULL"),
            ("corrente_a",        "FLOAT          NULL"),
            ("voltagem_v",        "FLOAT          NULL"),
            ("peso_kg",           "FLOAT          NULL"),
            ("peso_max_kg",       "FLOAT          NULL"),
            ("notas_tecnicas",    "NVARCHAR(MAX)  NULL"),
            ("foto_url",          "NVARCHAR(500)  NULL"),
            ("atualizado_em",     "DATETIME NOT NULL DEFAULT GETUTCDATE()"),
        ):
            _garantir_coluna_mssql(connection, "Equipamentos", coluna, definicao)

        # ─── Colunas em falta: Utilizadores ───
        for coluna, definicao in (
            ("iniciais",          "NVARCHAR(10)   NULL"),
            ("email",             "NVARCHAR(180)  NULL"),
            ("cargo",             "NVARCHAR(100)  NULL"),
            ("forcar_troca_pin",  "BIT NOT NULL DEFAULT 1"),
        ):
            _garantir_coluna_mssql(connection, "Utilizadores", coluna, definicao)

        # ─── Colunas em falta: Reservas (necessárias para OEE) ───
        for coluna, definicao in (
            ("metodo",                   "NVARCHAR(180) NULL"),
            ("duracao_prevista_minutos", "INT           NULL"),
            ("concluido_com_sucesso",    "BIT           NULL"),
            ("fim_automatico",           "DATETIME      NULL"),
        ):
            _garantir_coluna_mssql(connection, "Reservas", coluna, definicao)

        # ─── Colunas em falta: SessoesUso (duração e fim automático por sessão) ───
        for coluna, definicao in (
            ("duracao_prevista_minutos", "INT      NULL"),
            ("fim_automatico",           "DATETIME NULL"),
        ):
            _garantir_coluna_mssql(connection, "SessoesUso", coluna, definicao)

        # ─── Colunas em falta: Avarias (utilizador que registou a avaria) ───
        for coluna, definicao in (
            ("utilizador_id", "INT NULL FOREIGN KEY REFERENCES Utilizadores(id)"),
        ):
            _garantir_coluna_mssql(connection, "Avarias", coluna, definicao)


def validar_ligacao() -> None:
    """Valida a ligacao a base de dados com uma consulta simples.

    Raises:
        RuntimeError: Se a base de dados nao responder (falha de arranque).
    """

    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except SQLAlchemyError as exc:
        logger.exception("Falha na validacao da ligacao a base de dados")
        raise RuntimeError("Falha de ligacao a base de dados") from exc


def criar_tabelas() -> None:
    """Cria as tabelas definidas nos modelos carregados.

    Raises:
        RuntimeError: Se ocorrer erro de ligacao ou escrita no SGBD.
    """

    try:
        validar_ligacao()
        try:
            SQLModel.metadata.create_all(engine)
        except ProgrammingError as exc:
            # ProgrammingError pode surgir em BDs existentes com esquema parcial;
            # verificamos se as tabelas críticas existem antes de abortar.
            logger.warning("ProgrammingError ao criar esquema: %s", exc)
            try:
                with engine.connect() as connection:
                    rows = connection.exec_driver_sql("SELECT name FROM sys.tables")
                    existentes = {str(r[0]).lower() for r in rows}
            except Exception:
                raise

            obrigatorias = {"equipamentos", "manutencoes", "avarias"}
            faltam = obrigatorias - existentes
            if faltam:
                logger.error("Tabelas obrigatorias ausentes apos erro de criacao: %s", faltam)
                raise
            logger.warning("Tabelas obrigatorias existem; prosseguindo apesar do erro de criacao")

        _garantir_indices_filtrados_mssql()
    except SQLAlchemyError as exc:
        logger.exception("Falha ao inicializar o esquema relacional")
        raise RuntimeError("Nao foi possivel inicializar a base de dados") from exc


def get_session() -> Generator[Session, Any, None]:
    """Disponibiliza uma sessao transacional por pedido FastAPI.

    Yields:
        Session: Sessao SQLModel ativa.

    Porque: ao nao encapsular em RuntimeError, os handlers dos endpoints
    conseguem apanhar SQLAlchemyError diretamente e devolver respostas 503
    com contexto adequado. O handler global em main.py cobre os casos nao tratados.
    """

    with Session(engine) as session:
        yield session
