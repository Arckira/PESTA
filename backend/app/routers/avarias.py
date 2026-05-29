from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.core.deps import exigir_admin, obter_utilizador_opcional
from app.db.database import get_session, garantir_colunas_avarias
from app.models.avaria import Avaria
from app.models.base import EstadoEquipamento, SeveridadeAvaria, normalizar_estado_equipamento
from app.models.equipamento import Equipamento
from app.models.utilizador import Utilizador
from app.schemas.avaria import AvariaCreate, AvariaResolve
from app.services.auth_service import agora_utc, obter_ou_404, persistir_sessao
from app.services.pdf_service import gerar_pdf_playwright, html_relatorio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["avarias"])


@router.get("/equipamentos/{equipamento_id}/avarias")
def listar_avarias(equipamento_id: int, session: Session = Depends(get_session)):
    obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(select(Avaria).where(Avaria.equipamento_id == equipamento_id)).all()


@router.post("/equipamentos/{equipamento_id}/avaria")
def registar_avaria(
    equipamento_id: int,
    dados: AvariaCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    garantir_colunas_avarias()
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    setattr(eq, "_avaria_manual_registada", True)
    avaria = Avaria(
        equipamento_id=equipamento_id,
        utilizador_id=utilizador.id if utilizador else dados.utilizador_id,
        descricao=dados.descricao,
        empresa_externa=dados.empresa_externa,
        custo_reparacao=dados.custo_reparacao,
        num_sc_po=dados.num_sc_po,
        severidade=dados.severidade,
    )
    session.add(avaria)
    persistir_sessao(session, "Falha ao registar avaria")
    session.refresh(avaria)
    session.refresh(eq)
    return {"mensagem": "Avaria registada com sucesso", "estado_atual": eq.estado_atual, "avaria": avaria}


def _resolver_avaria_logica(avaria_id: int, dados: AvariaResolve, session: Session) -> dict[str, Any]:
    avaria = session.get(Avaria, avaria_id)
    if not avaria:
        raise HTTPException(status_code=404, detail="Avaria não encontrada")
    if avaria.resolvida:
        raise HTTPException(status_code=400, detail="Avaria já estava resolvida")

    avaria.resolvida = True
    avaria.data_resolucao = agora_utc()
    if dados.relatorio_tecnico:
        avaria.notas_resolucao = dados.relatorio_tecnico
    if dados.custo is not None:
        avaria.custo_reparacao = dados.custo

    outras_bloqueantes = session.exec(
        select(Avaria).where(
            Avaria.equipamento_id == avaria.equipamento_id,
            Avaria.resolvida == False,
            Avaria.id != avaria_id,
            Avaria.severidade == SeveridadeAvaria.BLOQUEANTE.value,
        )
    ).first()
    outras_alerta = session.exec(
        select(Avaria).where(
            Avaria.equipamento_id == avaria.equipamento_id,
            Avaria.resolvida == False,
            Avaria.id != avaria_id,
            Avaria.severidade == SeveridadeAvaria.ALERTA.value,
        )
    ).first()

    eq = session.get(Equipamento, avaria.equipamento_id)
    if eq:
        estado_atual_norm = normalizar_estado_equipamento(eq.estado_atual)
        estados_de_falha = {EstadoEquipamento.AVARIADO.value, EstadoEquipamento.DEGRADADO.value}
        if estado_atual_norm in estados_de_falha:
            if outras_bloqueantes:
                novo_estado = EstadoEquipamento.AVARIADO.value
            elif outras_alerta:
                novo_estado = EstadoEquipamento.DEGRADADO.value
            else:
                novo_estado = EstadoEquipamento.DISPONIVEL.value
            eq.estado_atual = novo_estado
            session.add(eq)

    session.add(avaria)
    persistir_sessao(session, "Falha ao resolver avaria")
    session.refresh(avaria)
    return {"mensagem": "Avaria resolvida com sucesso", "avaria": avaria}


@router.patch("/avarias/{avaria_id}/resolver")
def resolver_avaria(
    avaria_id: int,
    dados: AvariaResolve,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    return _resolver_avaria_logica(avaria_id, dados, session)


@router.put("/avarias/{avaria_id}/resolver")
def resolver_avaria_put(
    avaria_id: int,
    dados: AvariaResolve,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    return _resolver_avaria_logica(avaria_id, dados, session)


@router.get("/avarias")
def listar_todas_avarias(resolvida: Optional[bool] = None, session: Session = Depends(get_session)):
    query = select(Avaria)
    if resolvida is not None:
        query = query.where(Avaria.resolvida == resolvida)
    return session.exec(query.order_by(Avaria.data_registo.desc())).all()


@router.get("/avarias/exportar/pdf", summary="Exportar avarias para PDF")
def exportar_avarias_pdf(
    resolvida: Optional[bool] = None,
    pesquisa: Optional[str] = None,
    session: Session = Depends(get_session),
):
    avarias = session.exec(select(Avaria).order_by(Avaria.data_registo.desc())).all()
    if resolvida is not None:
        avarias = [a for a in avarias if a.resolvida == resolvida]

    pesquisa_norm = (pesquisa or "").strip().lower()
    if pesquisa_norm:
        eq_ids = {a.equipamento_id for a in avarias}
        ut_ids = {a.utilizador_id for a in avarias if a.utilizador_id is not None}
        eq_map = {e.id: e for e in session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()} if eq_ids else {}
        ut_map = {u.id: u for u in session.exec(select(Utilizador).where(Utilizador.id.in_(ut_ids))).all()} if ut_ids else {}
        filtradas = []
        for a in avarias:
            eq = eq_map.get(a.equipamento_id)
            ut = ut_map.get(a.utilizador_id) if a.utilizador_id else None
            haystack = " ".join([str(a.id), eq.nome if eq else "", eq.codigo if eq else "", a.descricao or "", ut.nome if ut else "", "resolvida" if a.resolvida else "aberta"]).lower()
            if pesquisa_norm in haystack:
                filtradas.append(a)
        avarias = filtradas

    eq_ids = {a.equipamento_id for a in avarias}
    ut_ids = {a.utilizador_id for a in avarias if a.utilizador_id is not None}
    eq_map = {e.id: e for e in session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()} if eq_ids else {}
    ut_map = {u.id: u for u in session.exec(select(Utilizador).where(Utilizador.id.in_(ut_ids))).all()} if ut_ids else {}

    agora = agora_utc()
    n_abertas = sum(1 for a in avarias if not a.resolvida)
    n_resolvidas = len(avarias) - n_abertas

    kpis_html = f"""<div class="kpis">
      <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">{len(avarias)}</div><div class="kpi-sub">no filtro</div></div>
      <div class="kpi"><div class="kpi-label">Abertas</div><div class="kpi-value" style="color:#dc2626;">{n_abertas}</div><div class="kpi-sub">por resolver</div></div>
      <div class="kpi"><div class="kpi-label">Resolvidas</div><div class="kpi-value" style="color:#166534;">{n_resolvidas}</div><div class="kpi-sub">encerradas</div></div>
    </div>"""

    linhas_tabela = []
    for a in avarias:
        eq = eq_map.get(a.equipamento_id)
        ut = ut_map.get(a.utilizador_id) if a.utilizador_id else None
        data_registo = a.data_registo.strftime("%d/%m/%Y %H:%M") if a.data_registo else "—"
        data_resolucao = a.data_resolucao.strftime("%d/%m/%Y") if a.data_resolucao else "—"
        estado_badge = '<span class="badge badge-green">Resolvida</span>' if a.resolvida else '<span class="badge badge-red">Aberta</span>'
        descricao = (a.descricao or "")[:120]
        linhas_tabela.append(f"""<tr>
          <td class="mono" style="text-align:center;">AV-{a.id:03d}</td>
          <td><strong>{eq.nome if eq else f"EQ-{a.equipamento_id}"}</strong> <span class="dim">{eq.codigo if eq else ""}</span></td>
          <td>{descricao}</td>
          <td class="mono">{data_registo}<br/><span class="dim">{ut.nome if ut else "—"}</span></td>
          <td style="text-align:center;">{estado_badge}</td>
          <td class="mono">{data_resolucao}</td>
        </tr>""")

    filtros_desc = ""
    if pesquisa_norm:
        filtros_desc += f'Pesquisa: "{pesquisa}" · '
    if resolvida is not None:
        filtros_desc += "Resolvidas" if resolvida else "Abertas"

    html = html_relatorio(
        titulo_doc="Relatório de Avarias",
        subtitulo=filtros_desc.rstrip(" · "),
        timestamp_fmt=agora.strftime("%d/%m/%Y às %H:%M"),
        meta_extra=f"Total de registos: <strong>{len(avarias)}</strong>",
        kpis_html=kpis_html,
        section_label="Registo de Avarias",
        cabecalhos=[("ID", "8%"), ("Equipamento", "22%"), ("Descrição", "30%"), ("Registo / Reportado por", "20%"), ("Estado", "10%"), ("Resolução", "10%")],
        linhas_tabela=linhas_tabela,
        colspan=6,
    )

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF de avarias: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {exc}")

    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="avarias-{agora.strftime("%Y%m%d-%H%M%S")}.pdf"'},
    )
