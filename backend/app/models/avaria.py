from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, Float, ForeignKey, Index, Integer, String, Text, event, update
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship

from app.models.base import UTCDateTime, UTCModel, SeveridadeAvaria, EstadoEquipamento, utc_now

if TYPE_CHECKING:
    from app.models.equipamento import Equipamento
    from app.models.utilizador import Utilizador


class Avaria(UTCModel, table=True):
    __tablename__ = "Avarias"
    __table_args__ = (Index("ix_avaria_equipamento_resolvida", "equipamento_id", "resolvida"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    utilizador_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            "utilizador_id", Integer, ForeignKey("Utilizadores.id"), nullable=True, index=True
        ),
    )
    descricao: str = Field(sa_column=Column("descricao", Text, nullable=False))
    data_registo: datetime = Field(
        default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False, index=True)
    )
    resolvida: bool = Field(default=False, index=True)
    data_resolucao: Optional[datetime] = Field(
        default=None, sa_column=Column(UTCDateTime(), index=True)
    )
    notas_resolucao: Optional[str] = Field(default=None, sa_column=Column(Text))
    custo_reparacao: Optional[float] = Field(
        default=None, sa_column=Column("custo_reparacao", Float, nullable=True)
    )
    empresa_externa: Optional[str] = Field(
        default=None, sa_column=Column(String(150), nullable=True)
    )
    num_sc_po: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    severidade: str = Field(
        default=SeveridadeAvaria.BLOQUEANTE.value,
        sa_column=Column("severidade", String(20), nullable=False),
    )
    caminho_anexo: Optional[str] = Field(
        default=None, sa_column=Column(String(500), nullable=True)
    )

    equipamento: Optional["Equipamento"] = Relationship(
        back_populates="avarias",
        sa_relationship=relationship("Equipamento", back_populates="avarias"),
    )
    reportado_por: Optional["Utilizador"] = Relationship(
        back_populates="avarias_reportadas",
        sa_relationship=relationship("Utilizador", back_populates="avarias_reportadas"),
    )


@event.listens_for(Avaria, "after_insert")
def marcar_estado_equipamento_por_severidade(mapper, connection, target) -> None:
    """Transita o estado do equipamento consoante a severidade da avaria.

    BLOQUEANTE → 'Avariado' | ALERTA → 'Limitado' (modo limitado).
    Falha segura: qualquer severidade desconhecida é tratada como BLOQUEANTE.
    """
    del mapper

    from app.models.equipamento import Equipamento  # importação local — evita circular no topo

    if target.severidade == SeveridadeAvaria.ALERTA.value:
        estado_destino = EstadoEquipamento.DEGRADADO.value
    else:
        estado_destino = EstadoEquipamento.AVARIADO.value

    connection.execute(
        update(Equipamento)
        .where(Equipamento.id == target.equipamento_id)
        .values(estado_atual=estado_destino, atualizado_em=utc_now())
    )
