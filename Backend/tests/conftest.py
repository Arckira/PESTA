"""Configuração global dos testes — motor SQLite em memória, sessão isolada por teste."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture(name="engine", scope="session")
def engine_fixture():
    """Motor SQLite em memória partilhado por toda a sessão de testes.

    scope="session": tabelas criadas uma única vez; o StaticPool reutiliza sempre
    a mesma ligação, o que é obrigatório para que os dados flushed numa transação
    fiquem visíveis para a mesma ligação dentro do mesmo teste.
    """
    # Importar todos os modelos (incl. eventos cross-model) antes do create_all,
    # para que os seus metadados estejam registados no SQLModel.metadata.
    import app.models  # noqa: F401
    from app.models.fornecedor import Fornecedor  # noqa: F401 — não exportado por __init__

    _engine = create_engine(
        "sqlite://",  # :memory: implícito — sem ficheiro em disco
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(_engine)
    yield _engine


@pytest.fixture(name="session")
def session_fixture(engine):
    """Sessão de BD isolada por teste com rollback automático no teardown.

    O rollback garante que cada teste começa com o esquema limpo (sem dados
    deixados por testes anteriores), sem precisar de recriar as tabelas.
    """
    with Session(engine) as session:
        yield session
        session.rollback()


@pytest.fixture(name="utilizador_teste")
def utilizador_teste_fixture(session):
    """Utilizador ADMIN com PIN alterado — necessário para os testes de state machine.

    forcar_troca_pin=False: contorna a guarda exigir_pin_alterado sem precisar
    de replicar o fluxo de autenticação completo.
    """
    from app.core.security import _hash_pin
    from app.models.base import RoleUtilizador
    from app.models.utilizador import Utilizador

    user = Utilizador(
        nome="Utilizador Teste",
        numero_colaborador="TST001",
        departamento="QA",
        pin_hash=_hash_pin("1234"),
        role=RoleUtilizador.ADMIN,
        forcar_troca_pin=False,
    )
    session.add(user)
    session.flush()  # atribui o ID sem commitar — rollback no teardown limpa tudo
    return user


@pytest.fixture(name="client")
def client_fixture(session, utilizador_teste):
    """TestClient FastAPI com get_session e autenticação sobrescritos.

    Faz patch de todos os componentes do lifespan que dependem de infra externa
    (Alembic, APScheduler, migrações lazy) para que os testes corram sem BD de
    produção nem daemon de agendamento.
    """
    from fastapi.testclient import TestClient

    from app.core.deps import exigir_pin_alterado
    from app.db.database import get_session
    from app.main import app

    def override_get_session():
        yield session

    def override_exigir_pin_alterado():
        return utilizador_teste

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[exigir_pin_alterado] = override_exigir_pin_alterado

    mock_scheduler = MagicMock()

    _patches = [
        patch("app.main.AlembicConfig"),
        patch("app.main.alembic_command.upgrade"),
        patch("app.main.BackgroundScheduler", return_value=mock_scheduler),
        patch("app.main._configurar_logging"),
        patch("app.main.garantir_colunas_sessaouso"),
        patch("app.main.garantir_colunas_avarias"),
        patch("app.main.garantir_colunas_manutencoes"),
        patch("app.main.garantir_tabela_fornecedores"),
        patch("app.main.garantir_coluna_equipamentos_seccao"),
        # Também chamada dentro do router a cada pedido de check-in
        patch("app.routers.sessoes.garantir_colunas_sessaouso"),
    ]

    for p in _patches:
        p.start()

    with TestClient(app) as c:
        yield c

    for p in _patches:
        p.stop()

    app.dependency_overrides.clear()
