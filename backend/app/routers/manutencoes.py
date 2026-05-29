from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.core.deps import obter_utilizador_opcional
from app.db.database import get_session, garantir_colunas_manutencoes
from app.models.avaria import Avaria
from app.models.base import EstadoEquipamento
from app.models.equipamento import Equipamento
from app.models.manutencao import Manutencao
from app.models.utilizador import Utilizador
from app.schemas.avaria import ManutencaoCreate
from app.services.auth_service import agora_utc, obter_ou_404, persistir_sessao
from app.services.pdf_service import gerar_pdf_playwright, html_relatorio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["manutencoes"])


@router.get("/equipamentos/{equipamento_id}/manutencoes")
def listar_manutencoes(equipamento_id: int, session: Session = Depends(get_session)):
    obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(Manutencao).where(Manutencao.equipamento_id == equipamento_id)
        .order_by(Manutencao.data_realizada.desc())
    ).all()


@router.post("/equipamentos/{equipamento_id}/manutencao")
def registar_manutencao(
    equipamento_id: int,
    dados: ManutencaoCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    garantir_colunas_manutencoes()
    _ = utilizador
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    manutencao = Manutencao(
        equipamento_id=equipamento_id,
        descricao=dados.descricao,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        executado_por_id=dados.executado_por_id,
        tipo_intervencao=dados.tipo_intervencao,
        custo_eur=dados.custo_eur,
        referencia_sc_po=dados.referencia_sc_po,
        observacoes_externas=dados.observacoes_externas,
    )
    eq.estado_atual = EstadoEquipamento.MANUTENCAO.value
    session.add(manutencao)
    session.add(eq)
    persistir_sessao(session, "Falha ao registar manutenção")
    session.refresh(manutencao)
    return {"mensagem": "Manutenção registada com sucesso", "manutencao": manutencao}


@router.get("/manutencoes")
def listar_todas_manutencoes(session: Session = Depends(get_session)):
    return session.exec(select(Manutencao).order_by(Manutencao.data_realizada.desc())).all()


@router.get("/manutencoes/exportar/pdf", summary="Exportar registo de manutenções em PDF")
def exportar_manutencoes_pdf(
    filtro: Optional[str] = None,
    tipo: Optional[str] = None,
    session: Session = Depends(get_session),
):
    manutencoes = session.exec(select(Manutencao).order_by(Manutencao.data_realizada.desc())).all()

    filtro_norm = (filtro or "").strip().lower()
    tipo_norm = (tipo or "").strip()

    eq_ids = {m.equipamento_id for m in manutencoes}
    ut_ids = {m.executado_por_id for m in manutencoes if m.executado_por_id is not None}
    eq_map = {e.id: e for e in session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()} if eq_ids else {}
    ut_map = {u.id: u for u in session.exec(select(Utilizador).where(Utilizador.id.in_(ut_ids))).all()} if ut_ids else {}

    if filtro_norm:
        manutencoes = [
            m for m in manutencoes
            if filtro_norm in (eq_map.get(m.equipamento_id, None) and eq_map[m.equipamento_id].nome or "").lower()
            or filtro_norm in (m.descricao or "").lower()
            or filtro_norm in (m.tipo_intervencao or "").lower()
        ]
    if tipo_norm:
        manutencoes = [m for m in manutencoes if (m.tipo_intervencao or "") == tipo_norm]

    agora = agora_utc()
    timestamp_fmt = agora.strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro = agora.strftime("%Y%m%d-%H%M%S")

    _CORES_TIPO = {
        "Preventiva": "badge-blue", "Corretiva": "badge-red",
        "Diagnóstico": "badge-yellow", "Reparação Externa": "badge-purple",
    }

    linhas_tabela = []
    for idx, m in enumerate(manutencoes, start=1):
        eq = eq_map.get(m.equipamento_id)
        ut = ut_map.get(m.executado_por_id) if m.executado_por_id else None
        data_str = m.data_realizada.strftime("%d/%m/%Y") if m.data_realizada else "—"
        prox_str = m.proxima_data.strftime("%d/%m/%Y") if m.proxima_data else "—"
        tipo_label = m.tipo_intervencao or "—"
        tipo_cls = _CORES_TIPO.get(tipo_label, "badge-gray")
        badge_tipo = f'<span class="badge {tipo_cls}">{tipo_label}</span>' if m.tipo_intervencao else "—"
        custo = f"{m.custo_eur:.2f} €" if m.custo_eur is not None else "—"
        descricao = (m.descricao or "")[:90]
        linhas_tabela.append(f"""
        <tr>
          <td class="mono" style="text-align:center;">{idx}</td>
          <td><strong>{eq.nome if eq else f"EQ-{m.equipamento_id}"}</strong>
              <span class="dim">{eq.codigo if eq else ""}</span></td>
          <td>{badge_tipo}</td>
          <td>{descricao}</td>
          <td class="mono">{data_str}</td>
          <td class="mono">{prox_str}</td>
          <td>{ut.nome if ut else "—"}</td>
          <td class="mono" style="text-align:right;">{custo}</td>
        </tr>""")

    filtros_desc = ""
    if filtro_norm:
        filtros_desc += f'Pesquisa: "{filtro}" · '
    if tipo_norm:
        filtros_desc += f"Tipo: {tipo}"

    html = html_relatorio(
        titulo_doc="Registo de Manutenções",
        subtitulo=filtros_desc.rstrip(" · "),
        timestamp_fmt=timestamp_fmt,
        meta_extra=f"Total de registos: <strong>{len(manutencoes)}</strong>",
        kpis_html="",
        section_label="Histórico de Manutenções",
        cabecalhos=[
            ("#", "4%"), ("Equipamento", "20%"), ("Tipo", "11%"), ("Descrição", "25%"),
            ("Data", "9%"), ("Próxima", "9%"), ("Executado por", "14%"), ("Custo", "8%"),
        ],
        linhas_tabela=linhas_tabela,
        colspan=8,
    )

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF de manutenções: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="manutencoes-{timestamp_ficheiro}.pdf"'},
    )
