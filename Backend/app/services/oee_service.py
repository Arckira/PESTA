"""Cálculos OEE — Overall Equipment Effectiveness."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.models.reserva import Reserva
from app.models.sessao import SessaoUso

logger = logging.getLogger(__name__)


def calcular_oee_temporal(tempo_real_s: float, tempo_disponivel_s: float) -> Optional[float]:
    """OEE = min(Tempo_Real / Tempo_Disponivel, 1) × 100.

    Tempo_Disponivel = janela_total − downtime_avarias.
    Limita a 100% para que overruns não distorçam a métrica de eficiência.
    Devolve None se tempo_disponivel_s == 0 (janela totalmente coberta por avarias).
    """
    if tempo_disponivel_s <= 0:
        return None
    return round(min(tempo_real_s / tempo_disponivel_s, 1.0) * 100, 1)


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


def calcular_tempo_disponivel_s(
    equipamento_id: Optional[int],
    avarias: list,
    janela_inicio: datetime,
    janela_fim: datetime,
    agora: datetime,
) -> float:
    """Tempo disponível = janela total − downtime por avarias com intersecção.

    Porquê intersecção: uma avaria que começou antes de janela_inicio
    só conta a partir de janela_inicio, não desde o início da avaria.
    Avarias sem data_resolucao (ainda abertas) usam agora como fim efectivo,
    clippado ao máximo em janela_fim.
    equipamento_id=None agrega downtime de todos os equipamentos (histórico global).
    """
    janela_total_s = (janela_fim - janela_inicio).total_seconds()
    downtime_s = 0.0
    for a in avarias:
        if equipamento_id is not None and a.equipamento_id != equipamento_id:
            continue
        # Normaliza datetimes naive para UTC, por segurança
        dr = a.data_registo
        if dr.tzinfo is None:
            dr = dr.replace(tzinfo=timezone.utc)
        fim_avaria = a.data_resolucao if a.data_resolucao is not None else agora
        if fim_avaria.tzinfo is None:
            fim_avaria = fim_avaria.replace(tzinfo=timezone.utc)
        ev_inicio = max(dr, janela_inicio)
        ev_fim = min(fim_avaria, janela_fim)
        if ev_fim > ev_inicio:
            downtime_s += (ev_fim - ev_inicio).total_seconds()
    return max(janela_total_s - downtime_s, 0.0)
