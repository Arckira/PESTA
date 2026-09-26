"""Testes unitários à validação do schema ReservaCreate."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.reserva import ReservaCreate

# Campos obrigatórios de contexto que não são o foco da validação
_BASE = {
    "equipamento_id": 1,
    "utilizador_id": 1,
}


def _dt(ano: int, mes: int, dia: int, hora: int, minuto: int = 0) -> datetime:
    """Helper: constrói datetime UTC para os testes de validação."""
    return datetime(ano, mes, dia, hora, minuto, tzinfo=timezone.utc)


def test_fim_antes_inicio():
    """Garante que data_fim anterior a data_inicio lança ValidationError.

    Edge case: inversão temporal — uma reserva com fim no passado relativamente
    ao início é logicamente impossível e deve ser rejeitada na camada de schema,
    antes de qualquer acesso à base de dados.
    """
    with pytest.raises(ValidationError, match="posterior"):
        ReservaCreate(
            **_BASE,
            data_inicio=_dt(2025, 6, 10, 10),
            data_fim=_dt(2025, 6, 10, 9),  # 1 hora ANTES do início
        )


def test_duracao_menos_1h():
    """Garante que uma reserva de menos de 1 hora lança ValidationError.

    Edge case: duração mínima não respeitada — reservas muito curtas (e.g., 30 min)
    são rejeitadas para garantir que o equipamento não fique bloqueado por períodos
    triviais que perturbam o planeamento da equipa.
    """
    with pytest.raises(ValidationError):
        ReservaCreate(
            **_BASE,
            data_inicio=_dt(2025, 6, 10, 9),
            data_fim=_dt(2025, 6, 10, 9, 30),  # apenas 30 minutos
        )


def test_hora_nao_alinhada():
    """Garante que data_inicio com minutos != 0 lança ValidationError.

    Edge case: alinhamento à hora cheia — as reservas devem começar e terminar
    em horas exactas (09:00, 10:00, …) para simplificar o planeamento visual no
    calendário e evitar sobreposições parciais difíceis de detectar.
    """
    with pytest.raises(ValidationError, match="alinhada"):
        ReservaCreate(
            **_BASE,
            data_inicio=_dt(2025, 6, 10, 9, 15),  # 09:15 — não alinhado
            data_fim=_dt(2025, 6, 10, 11, 15),
        )


def test_reserva_valida():
    """Garante que uma reserva válida de 2 horas não lança exceção.

    Edge case: caminho feliz — verifica que os validadores não bloqueiam uma
    reserva correctamente formada, para garantir que não há falsos positivos.
    """
    reserva = ReservaCreate(
        **_BASE,
        data_inicio=_dt(2025, 6, 10, 9),
        data_fim=_dt(2025, 6, 10, 11),  # exactamente 2 horas, alinhada
    )
    assert reserva.data_inicio < reserva.data_fim
