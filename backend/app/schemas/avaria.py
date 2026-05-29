from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, model_validator

from app.models.base import SeveridadeAvaria


class AvariaCreate(BaseModel):
    descricao: str
    utilizador_id: Optional[int] = None
    empresa_externa: Optional[str] = None
    custo_reparacao: Optional[float] = None
    num_sc_po: Optional[str] = None
    severidade: str = SeveridadeAvaria.BLOQUEANTE.value

    @model_validator(mode="after")
    def validar_severidade(self) -> "AvariaCreate":
        valores_validos = {s.value for s in SeveridadeAvaria}
        if self.severidade not in valores_validos:
            raise ValueError(
                f"Severidade inválida: '{self.severidade}'. "
                f"Valores aceites: {sorted(valores_validos)}"
            )
        return self


class AvariaResolve(BaseModel):
    relatorio_tecnico: Optional[str] = None
    custo: Optional[float] = None


class ManutencaoCreate(BaseModel):
    descricao: str
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    executado_por_id: Optional[int] = None
    tipo_intervencao: Optional[str] = None
    custo_eur: Optional[float] = None
    referencia_sc_po: Optional[str] = None
    observacoes_externas: Optional[str] = None


class CalibracaoCreate(BaseModel):
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    certificado_url: Optional[str] = None
    observacoes: Optional[str] = None
    executado_por_id: Optional[int] = None
