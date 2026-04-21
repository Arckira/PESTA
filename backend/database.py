from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import inspect
import os

# Define o caminho do ficheiro da base de dados
# O objetivo e que seja resiliente, mesmo que mudemos de servidor
sqlite_file_name = "testing_centre.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# O 'check_same_thread=False' e necessario para o FastAPI
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

_EQUIPAMENTO_COLUMN_MIGRATIONS = {
    "numero_serie": "ALTER TABLE equipamento ADD COLUMN numero_serie VARCHAR",
    "ligacao_eletrica": "ALTER TABLE equipamento ADD COLUMN ligacao_eletrica VARCHAR",
    "corrente_a": "ALTER TABLE equipamento ADD COLUMN corrente_a FLOAT",
    "voltagem_v": "ALTER TABLE equipamento ADD COLUMN voltagem_v FLOAT",
    "peso_kg": "ALTER TABLE equipamento ADD COLUMN peso_kg FLOAT",
    "peso_max_kg": "ALTER TABLE equipamento ADD COLUMN peso_max_kg FLOAT",
}


def _migrar_colunas_equipamento():
    inspector = inspect(engine)
    if "equipamento" not in inspector.get_table_names():
        return

    existentes = {col["name"] for col in inspector.get_columns("equipamento")}
    pendentes = [
        ddl for coluna, ddl in _EQUIPAMENTO_COLUMN_MIGRATIONS.items()
        if coluna not in existentes
    ]
    if not pendentes:
        return

    with engine.begin() as conn:
        for ddl in pendentes:
            conn.exec_driver_sql(ddl)


def criar_tabelas():
    """Cria as tabelas na base de dados se nao existirem."""
    SQLModel.metadata.create_all(engine)
    _migrar_colunas_equipamento()


def get_session():
    """Gera uma sessao para cada pedido a API (Dependency Injection)."""
    with Session(engine) as session:
        yield session
