from sqlmodel import SQLModel, create_engine, Session
import os

# Define o caminho do ficheiro da base de dados
# O objetivo e que seja resiliente, mesmo que mudemos de servidor
sqlite_file_name = "testing_centre.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# O 'check_same_thread=False' e necessario para o FastAPI
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

def _colunas_tabela(conn, tabela: str) -> set[str]:
    resultado = conn.exec_driver_sql(f"PRAGMA table_info({tabela})")
    return {linha[1] for linha in resultado}


def _garantir_coluna(conn, tabela: str, coluna: str, definicao: str):
    colunas = _colunas_tabela(conn, tabela)
    if coluna not in colunas:
        conn.exec_driver_sql(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}")


def _executar_migracoes_sqlite():
    with engine.begin() as conn:
        tabelas = {
            row[0]
            for row in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
        }

        # Auth em utilizador
        if "utilizador" in tabelas:
            _garantir_coluna(conn, "utilizador", "pin_hash", "TEXT NOT NULL DEFAULT ''")
            _garantir_coluna(conn, "utilizador", "role", "TEXT NOT NULL DEFAULT 'user'")
            _garantir_coluna(conn, "utilizador", "ativo", "INTEGER NOT NULL DEFAULT 1")
            _garantir_coluna(conn, "utilizador", "forcar_troca_pin", "INTEGER NOT NULL DEFAULT 1")

        # Sessão autenticada vinculada ao utilizador
        if "sessaouso" in tabelas:
            _garantir_coluna(conn, "sessaouso", "utilizador_id", "INTEGER")

        # Campos técnicos de equipamento
        if "equipamento" in tabelas:
            _garantir_coluna(conn, "equipamento", "numero_serie", "VARCHAR")
            _garantir_coluna(conn, "equipamento", "ligacao_eletrica", "VARCHAR")
            _garantir_coluna(conn, "equipamento", "corrente_a", "FLOAT")
            _garantir_coluna(conn, "equipamento", "voltagem_v", "FLOAT")
            _garantir_coluna(conn, "equipamento", "peso_kg", "FLOAT")
            _garantir_coluna(conn, "equipamento", "peso_max_kg", "FLOAT")

def criar_tabelas():
    """Cria as tabelas na base de dados se nao existirem."""
    SQLModel.metadata.create_all(engine)
    _executar_migracoes_sqlite()

def get_session():
    """Gera uma sessao para cada pedido a API (Dependency Injection)."""
    with Session(engine) as session:
        yield session
