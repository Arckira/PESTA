"""Tipos base, enums e utilitários partilhados por todos os modelos."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator
from sqlmodel import SQLModel


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _datetime_to_iso_z(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return _to_utc(dt).isoformat().replace("+00:00", "Z")


class UTCDateTime(TypeDecorator):
    """Persistência UTC sem conversões implícitas."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _to_utc(value).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return _to_utc(value)


class UTCModel(SQLModel):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def calcular_proxima_data(
    data_realizada: Optional[datetime],
    periodicidade_dias: Optional[int],
) -> Optional[datetime]:
    if not data_realizada or not periodicidade_dias or periodicidade_dias <= 0:
        return None
    return data_realizada + timedelta(days=periodicidade_dias)


class EstadoEquipamento(str, Enum):
    DISPONIVEL = "Disponível"
    OCUPADO = "Ocupado"
    AVARIADO = "Avariado"
    DEGRADADO = "Degradado"
    MANUTENCAO = "Em manutenção"
    CALIBRACAO = "Em calibração"


class SeveridadeAvaria(str, Enum):
    BLOQUEANTE = "BLOQUEANTE"
    ALERTA = "ALERTA"


class RoleUtilizador(str, Enum):
    USER = "user"
    ADMIN = "admin"


class TipoDocumento(str, Enum):
    MANUAL = "manual"
    DATASHEET = "datasheet"
    CERTIFICADO = "certificado"
    OUTRO = "outro"


def normalizar_estado_equipamento(estado: Optional[str]) -> str:
    if estado is None:
        return EstadoEquipamento.DISPONIVEL.value
    texto = str(estado).strip()
    legado = {
        "nok": EstadoEquipamento.AVARIADO.value,
        "em funcionamento": EstadoEquipamento.DISPONIVEL.value,
    }
    return legado.get(texto.lower(), texto)
