"""Configuracao da camada de acesso a dados.

O objetivo deste modulo e centralizar a criacao da engine SQLModel/SQLAlchemy
e encapsular detalhes de ligacao ao SQL Server 2022 Express via ``pyodbc``.
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

DEFAULT_SQLITE_FILE = "testing_centre.db"
DEFAULT_SQLITE_URL = f"sqlite:///{DEFAULT_SQLITE_FILE}"
DEFAULT_MSSQL_DRIVER = "ODBC Driver 18 for SQL Server"


def _load_dotenv_from_project_root() -> None:
    """Carrega variaveis de ambiente definidas em `.env` na raiz do projecto.

    Não sobrescreve variáveis já presentes em `os.environ`.
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
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        # Não falhar a importação do módulo se o .env tiver problemas;
        # deixamos o resto do código tratar da ausência de configuração.
        pass


# Carrega variáveis do .env da raiz do repositório (se existir)
_load_dotenv_from_project_root()


def _obter_database_url() -> str:
    """Resolve a URL da base de dados a partir do ambiente.

    Returns:
        str: URL final para a engine SQLAlchemy.

    Notes:
        ``DATABASE_URL`` continua a ter prioridade total. Se nao existir,
        tentamos construir uma ligacao MSSQL a partir de variaveis dedicadas.
        Caso tambem nao estejam definidas, recuamos para SQLite local para
        desenvolvimento rapido.
    """

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return database_url

    mssql_server = os.getenv("MSSQL_SERVER", "").strip()
    mssql_database = os.getenv("MSSQL_DATABASE", "").strip()
    if not mssql_server or not mssql_database:
        return DEFAULT_SQLITE_URL

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
IS_SQLITE = DATABASE_URL.startswith("sqlite")
IS_MSSQL = DATABASE_URL.startswith("mssql+pyodbc")


def _criar_engine() -> Engine:
    """Cria uma engine resiliente para o SGBD configurado.

    Returns:
        Engine: Engine pronta para uso pela aplicacao.

    Raises:
        RuntimeError: Se a engine nao puder ser criada.
    """

    connect_args: dict[str, Any] = {}
    if IS_SQLITE:
        connect_args["check_same_thread"] = False

    try:
        engine_kwargs = {
            "connect_args": connect_args,
            "pool_pre_ping": True,
            "echo": os.getenv("SQL_ECHO", "false").strip().lower() == "true",
        }
        if IS_MSSQL:
            engine_kwargs["pool_recycle"] = 1800

        return create_engine(
            DATABASE_URL,
            **engine_kwargs,
        )
    except SQLAlchemyError as exc:
        logger.exception("Falha ao criar a engine da base de dados")
        raise RuntimeError("Nao foi possivel configurar a base de dados") from exc


engine = _criar_engine()


def _colunas_tabela_sqlite(connection, tabela: str) -> set[str]:
    """Obtém as colunas atuais de uma tabela SQLite.

    Porque: o projeto já tinha uma base SQLite local com esquema antigo.
    Esta introspeção permite migrar incrementalmente sem perder dados.
    """

    resultado = connection.exec_driver_sql(f"PRAGMA table_info({tabela})")
    return {str(linha[1]) for linha in resultado}


def _garantir_coluna_sqlite(connection, tabela: str, coluna: str, definicao: str) -> None:
    """Adiciona uma coluna em SQLite apenas se ainda não existir."""

    colunas = _colunas_tabela_sqlite(connection, tabela)
    if coluna not in colunas:
        connection.exec_driver_sql(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}")


def _executar_migracoes_sqlite() -> None:
    """Aplica migrações leves de compatibilidade na base SQLite local."""

    if not IS_SQLITE:
        return

    with engine.begin() as connection:
        tabelas = {
            str(row[0])
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }

        if "equipamento" in tabelas:
            _garantir_coluna_sqlite(connection, "equipamento", "numero_serie", "VARCHAR")
            _garantir_coluna_sqlite(connection, "equipamento", "range_temp", "VARCHAR")
            # Novos campos numéricos adicionados ao modelo: garantir existência
            _garantir_coluna_sqlite(connection, "equipamento", "temp_min", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "temp_max", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "humidade_max", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "fabricante", "VARCHAR")
            _garantir_coluna_sqlite(connection, "equipamento", "modelo", "VARCHAR")
            _garantir_coluna_sqlite(connection, "equipamento", "ano_fabrico", "INTEGER")
            _garantir_coluna_sqlite(connection, "equipamento", "potencia_kw", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "ligacao_eletrica", "VARCHAR")
            _garantir_coluna_sqlite(connection, "equipamento", "corrente_a", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "voltagem_v", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "peso_kg", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "peso_max_kg", "FLOAT")
            _garantir_coluna_sqlite(connection, "equipamento", "notas_tecnicas", "TEXT")
            _garantir_coluna_sqlite(connection, "equipamento", "foto_url", "VARCHAR")
            _garantir_coluna_sqlite(
                connection,
                "equipamento",
                "atualizado_em",
                "DATETIME NOT NULL DEFAULT '2000-01-01 00:00:00'",
            )

        if "utilizador" in tabelas:
            _garantir_coluna_sqlite(connection, "utilizador", "email", "VARCHAR")
            _garantir_coluna_sqlite(connection, "utilizador", "cargo", "VARCHAR")
            _garantir_coluna_sqlite(connection, "utilizador", "criado_em", "DATETIME")

        if "avaria" in tabelas:
            _garantir_coluna_sqlite(connection, "avaria", "reportado_por_id", "INTEGER")
            _garantir_coluna_sqlite(connection, "avaria", "prioridade", "VARCHAR NOT NULL DEFAULT 'Media'")

        if "manutencao" in tabelas:
            _garantir_coluna_sqlite(connection, "manutencao", "executado_por_id", "INTEGER")
            _garantir_coluna_sqlite(connection, "manutencao", "periodicidade_dias", "INTEGER")
            _garantir_coluna_sqlite(connection, "manutencao", "criado_em", "DATETIME")

        if "calibracao" in tabelas:
            _garantir_coluna_sqlite(connection, "calibracao", "executado_por_id", "INTEGER")
            _garantir_coluna_sqlite(connection, "calibracao", "periodicidade_dias", "INTEGER")
            _garantir_coluna_sqlite(connection, "calibracao", "observacoes", "TEXT")
            _garantir_coluna_sqlite(connection, "calibracao", "criado_em", "DATETIME")

        if "documentacaoequipamento" not in tabelas:
            connection.exec_driver_sql(
                """
                CREATE TABLE documentacaoequipamento (
                    id INTEGER PRIMARY KEY,
                    equipamento_id INTEGER NOT NULL,
                    carregado_por_id INTEGER,
                    titulo VARCHAR NOT NULL,
                    tipo_documento VARCHAR NOT NULL DEFAULT 'outro',
                    caminho_ficheiro VARCHAR NOT NULL,
                    descricao TEXT,
                    criado_em DATETIME NOT NULL
                )
                """
            )


def _garantir_indices_filtrados_mssql() -> None:
    """Cria indices unicos filtrados para colunas opcionais em MSSQL.

    Porque: em SQL Server, ``UNIQUE`` sobre colunas anulaveis pode introduzir
    restricoes indesejadas para multiplos registos com ``NULL``. O indice
    filtrado preserva unicidade apenas quando existe valor real.
    """

    if not IS_MSSQL:
        return

    instrucoes = (
        """
        IF OBJECT_ID('equipamento') IS NOT NULL
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes WHERE name = 'ux_equipamento_numero_serie_not_null'
            )
            CREATE UNIQUE INDEX ux_equipamento_numero_serie_not_null
            ON equipamento (numero_serie)
            WHERE numero_serie IS NOT NULL
        END
        """,
        """
        IF OBJECT_ID('utilizador') IS NOT NULL
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes WHERE name = 'ux_utilizador_email_not_null'
            )
            CREATE UNIQUE INDEX ux_utilizador_email_not_null
            ON utilizador (email)
            WHERE email IS NOT NULL
        END
        """,
    )

    with engine.begin() as connection:
        for instrucao in instrucoes:
            connection.exec_driver_sql(instrucao)


def validar_ligacao() -> None:
    """Valida a ligacao a base de dados com uma consulta simples.

    Raises:
        RuntimeError: Se a base de dados nao responder.
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
            # Se ocorrer um ProgrammingError durante a criação do esquema,
            # verificamos se as tabelas críticas foram criadas; caso contrário
            # abortamos para não prosseguir com um estado inconsistente.
            logger.warning("ProgrammingError ao criar esquema: %s", exc)
            try:
                with engine.connect() as connection:
                    rows = connection.exec_driver_sql("SELECT name FROM sys.tables")
                    existentes = {str(r[0]).lower() for r in rows}
            except Exception:
                # Não conseguimos introspectar o esquema — re-levanta o erro
                raise

            obrigatorias = {"equipamento", "manutencao", "avaria"}
            faltam = obrigatorias - existentes
            if faltam:
                logger.error("Tabelas obrigatórias ausentes após erro de criação: %s", faltam)
                raise
            else:
                logger.warning("Tabelas obrigatórias existem; prosseguindo apesar do erro de criação")

        _executar_migracoes_sqlite()
        _garantir_indices_filtrados_mssql()
    except SQLAlchemyError as exc:
        logger.exception("Falha ao inicializar o esquema relacional")
        raise RuntimeError("Nao foi possivel inicializar a base de dados") from exc


def get_session() -> Generator[Session, Any, None]:
    """Disponibiliza uma sessao transacional por pedido FastAPI.

    Yields:
        Session: Sessao SQLModel ativa.

    Raises:
        RuntimeError: Se ocorrer falha de ligacao durante o pedido.
    """

    try:
        with Session(engine) as session:
            yield session
    except SQLAlchemyError as exc:
        logger.exception("Falha de ligacao a base de dados durante o pedido")
        raise RuntimeError("Falha de ligacao a base de dados") from exc
