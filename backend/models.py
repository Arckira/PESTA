from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime
from enum import Enum

# ─────────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────────

class EstadoEquipamento(str, Enum):
    DISPONIVEL       = "Disponível"
    EM_FUNCIONAMENTO = "Em funcionamento"
    NOK              = "NOK"
    OCUPADO          = "Ocupado"
    EM_CALIBRACAO    = "Em calibração"
    EM_MANUTENCAO    = "Em manutenção"

# ─────────────────────────────────────────────
# EQUIPAMENTO
# ─────────────────────────────────────────────

class Equipamento(SQLModel, table=True):
    id:           Optional[int] = Field(default=None, primary_key=True)
    nome:         str
    tipo:         str
    localizacao:  str
    codigo:       str = Field(index=True, unique=True)
    numero_serie: Optional[str] = Field(default=None, index=True)
    range_temp:   Optional[str] = None
    # Campos para o "manual" do equipamento (ficha técnica)
    fabricante:   Optional[str] = None
    modelo:       Optional[str] = None
    ano_fabrico:  Optional[int] = None
    potencia_kw:  Optional[float] = None
    ligacao_eletrica: Optional[str] = None
    corrente_a:   Optional[float] = None
    voltagem_v:   Optional[float] = None
    peso_kg:      Optional[float] = None
    peso_max_kg:  Optional[float] = None
    notas_tecnicas: Optional[str] = None
    estado_atual: EstadoEquipamento = EstadoEquipamento.DISPONIVEL
    foto_url:     Optional[str] = None
    criado_em:    datetime = Field(default_factory=datetime.utcnow)

    # Relações — Porquê: permite lazy-loading eficiente em queries complexas
    sessoes:  List["SessaoUso"] = Relationship(back_populates="equipamento")
    reservas: List["Reserva"]   = Relationship(back_populates="equipamento")

# ─────────────────────────────────────────────
# AVARIA
# ─────────────────────────────────────────────

class Avaria(SQLModel, table=True):
    id:              Optional[int] = Field(default=None, primary_key=True)
    equipamento_id:  int = Field(foreign_key="equipamento.id")
    descricao:       str
    data_registo:    datetime = Field(default_factory=datetime.utcnow)
    resolvida:       bool = False
    data_resolucao:  Optional[datetime] = None
    notas_resolucao: Optional[str] = None

# ─────────────────────────────────────────────
# MANUTENÇÃO
# ─────────────────────────────────────────────

class Manutencao(SQLModel, table=True):
    id:             Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="equipamento.id")
    descricao:      str
    data_realizada: datetime
    proxima_data:   Optional[datetime] = None

# ─────────────────────────────────────────────
# CALIBRAÇÃO
# ─────────────────────────────────────────────

class Calibracao(SQLModel, table=True):
    id:              Optional[int] = Field(default=None, primary_key=True)
    equipamento_id:  int = Field(foreign_key="equipamento.id")
    data_realizada:  datetime
    proxima_data:    Optional[datetime] = None
    certificado_url: Optional[str] = None

# ─────────────────────────────────────────────
# UTILIZADOR
# ─────────────────────────────────────────────

class Utilizador(SQLModel, table=True):
    id:                  Optional[int] = Field(default=None, primary_key=True)
    nome:                str = Field(index=True)
    numero_colaborador:  str = Field(unique=True)
    departamento:        str

# ─────────────────────────────────────────────
# RESERVA
# Porquê desta separação data_inicio/data_fim vs inicio/fim:
#   data_inicio / data_fim → datas planeadas da reserva (o que o utilizador agendou)
#   SessaoUso.inicio / fim → timestamps reais de check-in/out (o que realmente aconteceu)
# ─────────────────────────────────────────────

class Reserva(SQLModel, table=True):
    id:             Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="equipamento.id", index=True)
    utilizador_id:  int = Field(foreign_key="utilizador.id", index=True)
    projeto:        Optional[str] = None
    data_inicio:    datetime
    data_fim:       datetime
    notas:          Optional[str] = None
    criado_em:      datetime = Field(default_factory=datetime.utcnow)

    equipamento: Optional[Equipamento] = Relationship(back_populates="reservas")

# ─────────────────────────────────────────────
# SESSÃO DE USO REAL (Check-in / Check-out)
# Porquê: regista o tempo REAL de utilização para calcular a eficiência OEE
#   Eficiência = (fim - inicio) / (reserva.data_fim - reserva.data_inicio) × 100%
# ─────────────────────────────────────────────

class SessaoUso(SQLModel, table=True):
    id:             Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="equipamento.id", index=True)
    # reserva_id pode ser None se o utilizador fizer check-in sem reserva prévia
    reserva_id:     Optional[int] = Field(default=None, foreign_key="reserva.id")
    utilizador:     str
    inicio:         datetime = Field(default_factory=datetime.utcnow)
    fim:            Optional[datetime] = None

    equipamento: Optional[Equipamento] = Relationship(back_populates="sessoes")
