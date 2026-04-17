from sqlmodel import SQLModel, create_engine, Session
import os

# Define o caminho do ficheiro da base de dados
# O objetivo é que seja resiliente, mesmo que mudemos de servidor 
sqlite_file_name = "testing_centre.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# O 'check_same_thread=False' é necessário para o FastAPI 
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

def criar_tabelas():
    """Cria as tabelas na base de dados se não existirem."""
    SQLModel.metadata.create_all(engine)

def get_session():
    """Gera uma sessão para cada pedido à API (Dependency Injection)."""
    with Session(engine) as session:
        yield session