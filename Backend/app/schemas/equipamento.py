from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.models.base import EstadoEquipamento


class EstadoUpdate(BaseModel):
    novo_estado: str


class EquipamentoCreate(BaseModel):
    nome: str
    tipo: str
    localizacao: str
    codigo: str
    numero_serie: Optional[str] = None
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidade_max: Optional[float] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    ano_fabrico: Optional[int] = None
    largura_mm: Optional[float] = None
    altura_mm: Optional[float] = None
    profundidade_mm: Optional[float] = None
    volume_l: Optional[float] = None
    potencia_kw: Optional[float] = None
    ligacao_eletrica: Optional[str] = None
    corrente_a: Optional[float] = None
    voltagem_v: Optional[float] = None
    peso_kg: Optional[float] = None
    peso_max_kg: Optional[float] = None
    notas_tecnicas: Optional[str] = None
    seccao: str = "Environmental"
    estado_atual: str = EstadoEquipamento.DISPONIVEL.value
    foto_url: Optional[str] = None


class EquipamentoUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    localizacao: Optional[str] = None
    numero_serie: Optional[str] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    ano_fabrico: Optional[int] = None
    largura_mm: Optional[float] = None
    altura_mm: Optional[float] = None
    profundidade_mm: Optional[float] = None
    volume_l: Optional[float] = None
    potencia_kw: Optional[float] = None
    ligacao_eletrica: Optional[str] = None
    corrente_a: Optional[float] = None
    voltagem_v: Optional[float] = None
    peso_kg: Optional[float] = None
    peso_max_kg: Optional[float] = None
    notas_tecnicas: Optional[str] = None
    foto_url: Optional[str] = None
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidade_max: Optional[float] = None
    seccao: Optional[str] = None
    estado_atual: Optional[str] = None
    descricao_avaria: Optional[str] = None
