"""Testes unitários ao serviço de cálculo OEE/MTBF/MTTR."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services.oee_service import calcular_mtbf_mttr, calcular_oee_temporal, calcular_tempo_disponivel_s

_JAN1 = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
_JAN2 = datetime(2024, 1, 2, 0, 0, 0, tzinfo=timezone.utc)  # janela: [JAN1, JAN2) = 86400 s


def _avaria(equipamento_id, data_registo, data_resolucao=None):
    return SimpleNamespace(
        equipamento_id=equipamento_id,
        data_registo=data_registo,
        data_resolucao=data_resolucao,
    )


def test_oee_denominador_zero():
    """Garante que OEE devolve None quando não há tempo disponível.

    Edge case: divisão por zero — janela totalmente coberta por avarias, o denominador
    é 0 e o OEE não é calculável. Devolver None evita que a média global seja distorcida.
    """
    resultado = calcular_oee_temporal(10, 0)
    assert resultado is None


def test_oee_normal():
    """Garante que o OEE é calculado correctamente para o caso típico.

    Edge case: utilização parcial — 3600 s reais / 7200 s disponíveis = 50 %.
    Verifica a fórmula base antes de qualquer truncagem.
    """
    resultado = calcular_oee_temporal(3600, 7200)
    assert resultado == 50.0


def test_oee_overrun_limitado_a_100():
    """Garante que o OEE é limitado a 100 % quando o tempo real excede o disponível.

    Edge case: overrun — se o ensaio demorar mais do que o disponível, o OEE não
    deve ultrapassar 100 %, caso contrário a métrica de eficiência perde sentido
    (valores acima de 100 % sugerem erroneamente "super-eficiência").
    """
    resultado = calcular_oee_temporal(7200, 3600)
    assert resultado == 100.0


def test_mtbf_sem_avarias(session):
    """Garante que MTBF é None quando não existem avarias no período.

    Edge case: ausência de dados — com uma BD vazia (zero avarias), o denominador
    da fórmula MTBF seria zero; devolver None sinaliza "sem dados suficientes"
    em vez de lançar ZeroDivisionError.
    """
    resultado = calcular_mtbf_mttr(session, dias=30)
    assert resultado["mtbf_h"] is None


# ── Testes de calcular_tempo_disponivel_s ─────────────────────────────────────

def test_tempo_disponivel_sem_avarias():
    """Janela de 24 h sem avarias → tempo disponível == 86400 s."""
    resultado = calcular_tempo_disponivel_s(1, [], _JAN1, _JAN2, _JAN2)
    assert resultado == 86400.0


def test_tempo_disponivel_avaria_cobre_janela_total():
    """Avaria que cobre toda a janela → tempo disponível == 0."""
    avaria = _avaria(1, _JAN1, _JAN2)
    resultado = calcular_tempo_disponivel_s(1, [avaria], _JAN1, _JAN2, _JAN2)
    assert resultado == 0.0


def test_tempo_disponivel_avaria_parcial_6h():
    """Avaria de 6 h em janela de 24 h → tempo disponível == 64800 s (18 h)."""
    avaria = _avaria(1, _JAN1, _JAN1 + timedelta(hours=6))
    resultado = calcular_tempo_disponivel_s(1, [avaria], _JAN1, _JAN2, _JAN2)
    assert resultado == 64800.0


def test_tempo_disponivel_avaria_ainda_aberta():
    """Avaria sem data_resolucao iniciada 2 h antes do fim da janela → downtime == 2 h → disponível == 22 h."""
    inicio_avaria = _JAN2 - timedelta(hours=2)
    avaria = _avaria(1, inicio_avaria, None)  # data_resolucao=None → usa agora=_JAN2
    resultado = calcular_tempo_disponivel_s(1, [avaria], _JAN1, _JAN2, _JAN2)
    assert resultado == pytest.approx(79200.0)  # 86400 - 7200


def test_tempo_disponivel_avaria_fora_da_janela():
    """Avaria que terminou antes de janela_inicio → não conta → disponível == 86400 s."""
    avaria = _avaria(1, _JAN1 - timedelta(hours=2), _JAN1 - timedelta(hours=1))
    resultado = calcular_tempo_disponivel_s(1, [avaria], _JAN1, _JAN2, _JAN2)
    assert resultado == 86400.0
