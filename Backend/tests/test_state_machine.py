"""Testes de integração à state machine de check-in via TestClient."""

from __future__ import annotations

from datetime import timezone
from datetime import datetime

from sqlalchemy import update

from app.models.base import EstadoEquipamento
from app.models.equipamento import Equipamento
from app.models.sessao import SessaoUso


def _agora_utc() -> datetime:
    return datetime.now(timezone.utc)


def _criar_equipamento(session, *, codigo: str, estado: str) -> Equipamento:
    """Cria e persiste um equipamento mínimo com o estado indicado.

    Usa Core UPDATE para definir o estado final, contornando o evento ORM
    after_insert/after_update que criaria automaticamente registos de Avaria
    (e falharia sem os campos obrigatórios que esse código não fornece).
    """
    eq = Equipamento(
        nome=f"Equipamento {codigo}",
        tipo="Tester",
        localizacao="Lab A",
        codigo=codigo,
        estado_atual=EstadoEquipamento.DISPONIVEL.value,  # estado neutro para o insert
    )
    session.add(eq)
    session.flush()  # obtém o ID sem commit

    if estado != EstadoEquipamento.DISPONIVEL.value:
        # Actualizar via Core DML — não dispara eventos ORM (before_update / after_update)
        session.execute(
            update(Equipamento)
            .where(Equipamento.id == eq.id)
            .values(estado_atual=estado)
        )
        session.flush()

    return eq


def test_checkin_em_equipamento_avariado(client, session):
    """Garante que check-in num equipamento Avariado devolve HTTP 400.

    Edge case: state machine — um equipamento em estado bloqueante (Avariado,
    Em manutenção, Em calibração) não pode receber novos ensaios; tentar
    fazer check-in deve ser rejeitado imediatamente com 400, sem criar sessão.
    """
    eq = _criar_equipamento(
        session,
        codigo="EQ-AVARIAD-001",
        estado=EstadoEquipamento.AVARIADO.value,
    )

    resposta = client.post(f"/equipamentos/{eq.id}/checkin", json={})

    assert resposta.status_code == 400
    assert "estado" in resposta.json()["detail"].lower()


def test_checkin_duplo_mesmo_utilizador(client, session, utilizador_teste):
    """Garante que um segundo check-in do mesmo utilizador devolve HTTP 409.

    Edge case: idempotência do check-in — o mesmo utilizador não pode ter dois
    check-ins activos em simultâneo no mesmo equipamento; a segunda tentativa
    deve ser rejeitada com 409 Conflict para evitar sessões duplicadas e dados
    de OEE corrompidos.
    """
    eq = _criar_equipamento(
        session,
        codigo="EQ-DUPLO-001",
        estado=EstadoEquipamento.DISPONIVEL.value,
    )

    # Simular sessão já aberta pelo mesmo utilizador
    sessao_existente = SessaoUso(
        equipamento_id=eq.id,
        utilizador_id=utilizador_teste.id,
        utilizador=utilizador_teste.nome,
        inicio=_agora_utc(),
    )
    session.add(sessao_existente)
    session.flush()  # after_insert event atualiza o estado do equipamento para Ocupado

    # Segundo check-in pelo mesmo utilizador — deve falhar com 409
    resposta = client.post(f"/equipamentos/{eq.id}/checkin", json={})

    assert resposta.status_code == 409
    assert "check-in" in resposta.json()["detail"].lower()
