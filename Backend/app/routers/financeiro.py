from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from app.db.database import get_session
from app.models.avaria import Avaria
from app.models.calibracao import Calibracao
from app.models.equipamento import Equipamento
from app.models.manutencao import Manutencao
from app.services.auth_service import agora_utc
from app.services.pdf_service import gerar_pdf_playwright, html_relatorio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/financeiro", tags=["financeiro"])


def _resumo_financeiro(
    ano: int,
    mes: Optional[int],
    equipamento_id: Optional[int],
    session: Session,
) -> dict[str, Any]:
    """Agrega custos de avarias e manutenções para um dado ano/mês/equipamento."""

    def _no_periodo(dt) -> bool:
        if dt is None:
            return False
        if dt.year != ano:
            return False
        if mes and dt.month != mes:
            return False
        return True

    # ── Avarias ──────────────────────────────────────────────────────────────
    q_av = select(Avaria)
    if equipamento_id:
        q_av = q_av.where(Avaria.equipamento_id == equipamento_id)
    avarias = session.exec(q_av).all()

    avarias_eur = sum(
        (a.custo_reparacao or 0.0)
        for a in avarias
        if _no_periodo(a.data_resolucao or a.data_registo)
    )

    # ── Manutenções ───────────────────────────────────────────────────────────
    q_man = select(Manutencao)
    if equipamento_id:
        q_man = q_man.where(Manutencao.equipamento_id == equipamento_id)
    manutencoes = session.exec(q_man).all()

    manutencoes_eur = sum(
        (m.custo_eur or 0.0)
        for m in manutencoes
        if _no_periodo(m.data_realizada)
    )

    # ── Calibrações (sem campo de custo — reservado para versão futura) ───────
    calibracoes_eur = 0.0

    total_eur = avarias_eur + manutencoes_eur + calibracoes_eur

    # ── Top equipamentos ─────────────────────────────────────────────────────
    custos_por_eq: dict[int, float] = defaultdict(float)
    for a in avarias:
        if _no_periodo(a.data_resolucao or a.data_registo):
            custos_por_eq[a.equipamento_id] += a.custo_reparacao or 0.0
    for m in manutencoes:
        if _no_periodo(m.data_realizada):
            custos_por_eq[m.equipamento_id] += m.custo_eur or 0.0

    eq_ids = list(custos_por_eq.keys())
    eq_map: dict[int, Equipamento] = {}
    if eq_ids:
        eq_map = {
            e.id: e
            for e in session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()
        }

    top_equipamentos = [
        {"id": eid, "nome": eq_map[eid].nome if eid in eq_map else f"EQ-{eid}", "total_eur": round(custo, 2)}
        for eid, custo in sorted(custos_por_eq.items(), key=lambda x: -x[1])
    ]

    # ── Por fornecedor ────────────────────────────────────────────────────────
    forn_custos: dict[str, float] = defaultdict(float)
    forn_count: dict[str, int] = defaultdict(int)
    for m in manutencoes:
        if not _no_periodo(m.data_realizada):
            continue
        nome_forn = (m.fornecedor or "").strip() or "Interno"
        forn_custos[nome_forn] += m.custo_eur or 0.0
        forn_count[nome_forn] += 1

    por_fornecedor = [
        {"fornecedor": nome, "total_eur": round(custo, 2), "n_intervencoes": forn_count[nome]}
        for nome, custo in sorted(forn_custos.items(), key=lambda x: -x[1])
        if custo > 0
    ]

    # ── Por mês (sempre 12 entradas, mesmo com mês filtrado) ─────────────────
    mes_custos: dict[int, float] = defaultdict(float)
    for a in avarias:
        dt = a.data_resolucao or a.data_registo
        if dt and dt.year == ano:
            mes_custos[dt.month] += a.custo_reparacao or 0.0
    for m in manutencoes:
        if m.data_realizada and m.data_realizada.year == ano:
            mes_custos[m.data_realizada.month] += m.custo_eur or 0.0

    por_mes = [
        {"mes": m, "total_eur": round(mes_custos.get(m, 0.0), 2)}
        for m in range(1, 13)
    ]

    return {
        "ano": ano,
        "mes": mes,
        "total_eur": round(total_eur, 2),
        "avarias_eur": round(avarias_eur, 2),
        "manutencoes_eur": round(manutencoes_eur, 2),
        "calibracoes_eur": round(calibracoes_eur, 2),
        "top_equipamentos": top_equipamentos,
        "por_fornecedor": por_fornecedor,
        "por_mes": por_mes,
    }


@router.get("/resumo")
def resumo_financeiro(
    ano: int = 0,
    mes: Optional[int] = None,
    equipamento_id: Optional[int] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if ano == 0:
        ano = agora_utc().year
    if mes is not None and not (1 <= mes <= 12):
        raise HTTPException(status_code=422, detail="'mes' deve estar entre 1 e 12")
    return _resumo_financeiro(ano, mes, equipamento_id, session)


@router.get("/resumo/exportar/pdf")
def exportar_financeiro_pdf(
    ano: int = 0,
    mes: Optional[int] = None,
    equipamento_id: Optional[int] = None,
    session: Session = Depends(get_session),
) -> Response:
    if ano == 0:
        ano = agora_utc().year

    dados = _resumo_financeiro(ano, mes, equipamento_id, session)
    agora = agora_utc()

    def _eur(v: float) -> str:
        return f"€ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    subtitulo = f"Ano {ano}" + (f" · Mês {mes}" if mes else "")
    if equipamento_id:
        eq = session.get(Equipamento, equipamento_id)
        subtitulo += f" · {eq.nome}" if eq else f" · EQ-{equipamento_id}"

    kpis_html = f"""<div class="kpis">
      <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">{_eur(dados['total_eur'])}</div><div class="kpi-sub">acumulado no período</div></div>
      <div class="kpi"><div class="kpi-label">Avarias</div><div class="kpi-value" style="color:#dc2626;">{_eur(dados['avarias_eur'])}</div><div class="kpi-sub">custo de reparação</div></div>
      <div class="kpi"><div class="kpi-label">Manutenções</div><div class="kpi-value" style="color:#d97706;">{_eur(dados['manutencoes_eur'])}</div><div class="kpi-sub">custo de intervenção</div></div>
    </div>"""

    linhas_tabela = []
    for eq in dados["top_equipamentos"][:10]:
        pct_av = 0.0
        pct_man = 0.0
        if eq["total_eur"] > 0:
            av_eq = sum(
                (a.custo_reparacao or 0.0)
                for a in session.exec(select(Avaria).where(Avaria.equipamento_id == eq["id"])).all()
            )
            man_eq = eq["total_eur"] - av_eq
            pct_av = round((av_eq / eq["total_eur"]) * 100, 1)
            pct_man = round((man_eq / eq["total_eur"]) * 100, 1)
        linhas_tabela.append(f"""<tr>
          <td><strong>{eq['nome']}</strong></td>
          <td style="text-align:right;">{_eur(eq['total_eur'])}</td>
          <td style="text-align:right;">{pct_av}%</td>
          <td style="text-align:right;">{pct_man}%</td>
        </tr>""")

    html = html_relatorio(
        titulo_doc="Relatório Financeiro",
        subtitulo=subtitulo,
        timestamp_fmt=agora.strftime("%d/%m/%Y às %H:%M"),
        meta_extra=f"Total acumulado: <strong>{_eur(dados['total_eur'])}</strong>",
        kpis_html=kpis_html,
        section_label="Custos por Equipamento",
        cabecalhos=[("Equipamento", "40%"), ("Total (€)", "20%"), ("% Avarias", "20%"), ("% Manutenções", "20%")],
        linhas_tabela=linhas_tabela,
        colspan=4,
    )

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF financeiro: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {exc}")

    nome_ficheiro = f"financeiro-{ano}{f'-m{mes:02d}' if mes else ''}-{agora.strftime('%Y%m%d-%H%M%S')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nome_ficheiro}"'},
    )
