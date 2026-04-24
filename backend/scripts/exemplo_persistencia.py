"""Exemplo de escrita transacional na base de dados.

O script cria um equipamento e regista de seguida uma avaria associada.
O estado do equipamento passa automaticamente para Avariado devido ao evento ORM
definido em ``models.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import criar_tabelas, engine
from models import Avaria, Equipamento, EstadoEquipamento, PrioridadeAvaria


def inserir_equipamento_com_avaria() -> None:
    """Cria um equipamento e uma avaria na mesma sessao transacional."""

    criar_tabelas()

    with Session(engine) as session:
        equipamento = Equipamento(
            nome="Camara Climática Weiss",
            tipo="Camara climatica",
            localizacao="Laboratorio de Ensaios A",
            codigo="EQ-CL-001",
            numero_serie="SN-WEISS-2026-001",
            fabricante="Weiss Technik",
            modelo="ClimeEvent C/340/70a",
        )
        session.add(equipamento)
        session.commit()
        session.refresh(equipamento)

        avaria = Avaria(
            equipamento_id=equipamento.id,
            descricao="Falha intermitente no controlo de temperatura.",
            prioridade=PrioridadeAvaria.ALTA,
        )
        session.add(avaria)
        session.commit()
        session.refresh(avaria)
        session.refresh(equipamento)

        print(
            {
                "equipamento_id": equipamento.id,
                "avaria_id": avaria.id,
                "estado_atual": equipamento.estado_atual,
                "estado_esperado": EstadoEquipamento.AVARIADO,
            }
        )


if __name__ == "__main__":
    inserir_equipamento_com_avaria()
