"""Cálculos OEE — Overall Equipment Effectiveness."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from app.models.reserva import Reserva
from app.models.sessao import SessaoUso

logger = logging.getLogger(__name__)


def calcular_oee_temporal(tempo_real_s: float, tempo_planeado_s: float) -> Optional[float]:
    """OEE = min(Tempo_Real / Tempo_Planeado, 1) × 100.

    Limita a 100% para que overruns não distorçam a métrica de eficiência.
    Devolve None se não houver tempo planeado (sem reservas no período).
    """
    if tempo_planeado_s <= 0:
        return None
    return round(min(tempo_real_s / tempo_planeado_s, 1.0) * 100, 1)


def calcular_metricas_uso(
    reservas: list[Reserva],
    sessoes: list[SessaoUso],
) -> dict[str, float]:
    tempo_reservado = sum((r.data_fim - r.data_inicio).total_seconds() for r in reservas)
    tempo_real = sum((s.fim - s.inicio).total_seconds() for s in sessoes if s.fim is not None)
    eficiencia = round((tempo_real / tempo_reservado * 100), 1) if tempo_reservado > 0 else 0
    return {
        "tempo_reservado_horas": round(tempo_reservado / 3600, 2),
        "tempo_real_horas": round(tempo_real / 3600, 2),
        "eficiencia_pct": eficiencia,
    }


def calcular_mtbf_mttr(session, dias: int = 30) -> dict:
    """
    MTBF = Tempo total operacional (horas) / nº de avarias no período.
    MTTR = Σ(data_resolucao - data_registo) / nº de avarias resolvidas no período.
    Ambos em horas, arredondados a 1 casa decimal. None se não houver dados.

    MTBF mede fiabilidade — quanto tempo em média o equipamento opera sem falhar.
    MTTR mede capacidade de resposta — quanto tempo em média demora a reparação.
    Fonte: IEC 60050-192 (terminologia de manutenção industrial).
    """
    from datetime import timedelta, datetime, timezone
    from sqlmodel import select
    from app.models.avaria import Avaria

    agora = datetime.now(timezone.utc)
    limite = agora - timedelta(days=dias)

    avarias = session.exec(
        select(Avaria).where(Avaria.data_registo >= limite)
    ).all()

    n_avarias = len(avarias)
    logger.info("MTBF/MTTR diagnóstico: %d avarias no período, limite=%s", n_avarias, limite)

    sessoes = session.exec(
        select(SessaoUso).where(
            SessaoUso.inicio >= limite,
            SessaoUso.fim.is_not(None),
        )
    ).all()
    tempo_operacional_h = sum(
        (s.fim - s.inicio).total_seconds() / 3600
        for s in sessoes
        if s.inicio is not None and s.fim is not None
    )
    mtbf_h = round(tempo_operacional_h / n_avarias, 1) if n_avarias > 0 else None

    avarias_resolvidas = [
        a for a in avarias
        if a.resolvida and a.data_resolucao is not None and a.data_registo is not None
    ]
    for a in avarias_resolvidas:
        logger.info(
            "Avaria resolvida ID=%d | data_registo=%s | data_resolucao=%s | tzinfo_registo=%s | tzinfo_resolucao=%s",
            a.id, a.data_registo, a.data_resolucao,
            getattr(a.data_registo, 'tzinfo', 'N/A'),
            getattr(a.data_resolucao, 'tzinfo', 'N/A'),
        )

    if avarias_resolvidas:
        total_resolucao_h = sum(
            (a.data_resolucao - a.data_registo).total_seconds() / 3600
            for a in avarias_resolvidas
        )
        logger.info("MTTR total_resolucao_h=%.2f, n=%d", total_resolucao_h, len(avarias_resolvidas))
        mttr_h = round(total_resolucao_h / len(avarias_resolvidas), 1)
    else:
        mttr_h = None

    return {
        "mtbf_h": mtbf_h,
        "mttr_h": mttr_h,
        "n_avarias_periodo": n_avarias,
        "n_avarias_resolvidas": len(avarias_resolvidas),
    }


def calcular_oee_equipamento(
    reservas: list[Reserva],
    sessoes: list[SessaoUso],
    agora: datetime,
) -> dict[str, Any]:
    """OEE com janelamento temporal dinâmico para um equipamento individual."""
    tempo_planeado_s = 0.0
    for r in reservas:
        if agora <= r.data_inicio:
            continue
        planeado = (min(agora, r.data_fim) - r.data_inicio).total_seconds()
        tempo_planeado_s += max(0.0, planeado)

    tempo_real_s = 0.0
    for s in sessoes:
        try:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())
        except (TypeError, ValueError):
            continue

    oee_pct = calcular_oee_temporal(tempo_real_s, tempo_planeado_s)

    if oee_pct is not None:
        ratio = tempo_real_s / tempo_planeado_s
        desvio_pct: Optional[float] = round(max(0.0, ratio - 1.0) * 100, 1)
    else:
        desvio_pct = None

    return {
        "oee_pct": oee_pct,
        "desvio_planeamento_pct": desvio_pct,
        "tempo_planeado_h": round(tempo_planeado_s / 3600, 2),
        "tempo_real_h": round(tempo_real_s / 3600, 2),
        "tem_sessao_ativa": any(s.fim is None for s in sessoes),
    }
