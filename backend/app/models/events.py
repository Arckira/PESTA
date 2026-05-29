"""Eventos ORM que cruzam dois modelos distintos.

Importado por último em __init__.py para garantir que ambos os modelos
já estão registados no metadata antes do evento ser activado.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy import inspect as sa_inspect

from app.models.base import EstadoEquipamento, normalizar_estado_equipamento, utc_now
from app.models.equipamento import Equipamento
from app.models.avaria import Avaria


@event.listens_for(Equipamento, "after_insert")
@event.listens_for(Equipamento, "after_update")
def criar_avaria_se_transitou_para_avariado(mapper, connection, target) -> None:
    """Cria automaticamente registo de Avaria quando o estado passa para 'Avariado'.

    Porquê: rastreabilidade industrial — qualquer transição para 'Avariado'
    é capturada sem depender apenas de acção manual do utilizador. Idempotente:
    verifica avaria aberta antes de inserir.
    """
    del mapper
    try:
        hist = sa_inspect(target).attrs.estado_atual.history
        antigo = hist.deleted[0] if hist.deleted else None
        novo = hist.added[0] if hist.added else getattr(target, "estado_atual", None)
    except Exception:
        antigo = None
        novo = getattr(target, "estado_atual", None)

    antigo_norm = normalizar_estado_equipamento(antigo)
    novo_norm = normalizar_estado_equipamento(novo)

    if novo_norm == EstadoEquipamento.AVARIADO.value and antigo_norm != EstadoEquipamento.AVARIADO.value:
        if getattr(target, "_avaria_manual_registada", False):
            return

        descricao = getattr(target, "_avaria_descricao", None) or "Avaria detetada via alteração de estado"

        try:
            consulta = Avaria.__table__.select().where(
                Avaria.__table__.c.equipamento_id == target.id,
                Avaria.__table__.c.resolvida == False,
            )
            existente = connection.execute(consulta).first()
        except Exception:
            existente = None

        if existente:
            return

        connection.execute(
            Avaria.__table__.insert().values(
                equipamento_id=target.id,
                descricao=descricao,
                data_registo=utc_now(),
                resolvida=False,
            )
        )
