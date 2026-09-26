"""Tarefas agendadas via APScheduler — executadas em background pelo lifespan do FastAPI."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, delete, select

from app.db.database import engine
from app.models.sessao import SessaoAuth
from app.models.calibracao import Calibracao
from app.models.equipamento import Equipamento

logger = logging.getLogger(__name__)


def _agora_utc() -> datetime:
    return datetime.now(timezone.utc)


def limpeza_sessoes_expiradas() -> None:
    """Remove em batch todas as SessaoAuth cuja expira_em já passou."""
    try:
        with Session(engine) as session:
            agora = _agora_utc()
            resultado = session.exec(
                delete(SessaoAuth).where(SessaoAuth.expira_em < agora)
            )
            removidas = resultado.rowcount if resultado.rowcount is not None else 0
            session.commit()
            logger.info("Limpeza de sessões: %d sessão(ões) expirada(s) removida(s).", removidas)
    except SQLAlchemyError:
        logger.exception("Erro ao limpar sessões expiradas — rollback efectuado.")


def alertar_calibracoes_proximas() -> None:
    """Emite avisos para calibrações cujo prazo ocorre nos próximos 30 dias."""
    try:
        with Session(engine) as session:
            agora = _agora_utc()
            limite = agora + timedelta(days=30)
            calibracoes = session.exec(
                select(Calibracao)
                .where(
                    Calibracao.proxima_data >= agora,
                    Calibracao.proxima_data <= limite,
                )
                .join(Equipamento, Calibracao.equipamento_id == Equipamento.id)
            ).all()

            for cal in calibracoes:
                equipamento = session.get(Equipamento, cal.equipamento_id)
                nome = equipamento.nome if equipamento else f"ID={cal.equipamento_id}"
                logger.warning(
                    "ALERTA CALIBRAÇÃO: equipamento '%s' (ID=%d) — próxima calibração em %s",
                    nome,
                    cal.equipamento_id,
                    cal.proxima_data.date() if cal.proxima_data else "N/D",
                )
            if not calibracoes:
                logger.info("Calibrações: nenhuma calibração pendente nos próximos 30 dias.")
    except SQLAlchemyError:
        logger.exception("Erro ao verificar calibrações próximas — rollback efectuado.")
