"""Exporta todos os modelos do domínio — manter compatibilidade de imports."""

# Importar em ordem topológica: base → sem deps → com deps → cross-model events
from app.models.base import (
    EstadoEquipamento,
    SeveridadeAvaria,
    RoleUtilizador,
    TipoDocumento,
    UTCDateTime,
    UTCModel,
    calcular_proxima_data,
    normalizar_estado_equipamento,
    utc_now,
)
from app.models.utilizador import Utilizador
from app.models.equipamento import Equipamento
from app.models.avaria import Avaria
from app.models.manutencao import Manutencao
from app.models.calibracao import Calibracao
from app.models.reserva import Reserva, DocumentacaoEquipamento
from app.models.sessao import SessaoUso, SessaoAuth
from app.models.log import Log

# Eventos cross-model — importar depois de todos os modelos estarem definidos
import app.models.events  # noqa: F401  (registra os eventos como side-effect)

__all__ = [
    "EstadoEquipamento",
    "SeveridadeAvaria",
    "RoleUtilizador",
    "TipoDocumento",
    "UTCDateTime",
    "UTCModel",
    "calcular_proxima_data",
    "normalizar_estado_equipamento",
    "utc_now",
    "Utilizador",
    "Equipamento",
    "Avaria",
    "Manutencao",
    "Calibracao",
    "Reserva",
    "DocumentacaoEquipamento",
    "SessaoUso",
    "SessaoAuth",
    "Log",
]
