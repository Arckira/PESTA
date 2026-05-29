from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.core.deps import exigir_pin_alterado
from app.db.database import get_session
from app.models.base import RoleUtilizador
from app.models.equipamento import Equipamento
from app.models.reserva import Reserva
from app.models.sessao import SessaoUso
from app.models.utilizador import Utilizador
from app.schemas.reserva import ReservaCreate
from app.services.auth_service import (
    agora_utc,
    iniciais_utilizador,
    iso_z,
    listar_reservas_enriquecidas,
    obter_ou_404,
    persistir_sessao,
    validar_colisao_reserva,
    validar_intervalo_reserva,
)
from app.services.pdf_service import gerar_pdf_playwright, html_relatorio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reservas"])


@router.get("/reservas")
def listar_reservas(session: Session = Depends(get_session)):
    reservas = listar_reservas_enriquecidas(session)
    return [
        {
            **r,
            "data_inicio": iso_z(r["data_inicio"]),
            "data_fim": iso_z(r["data_fim"]),
        }
        for r in reservas
    ]


@router.get("/reservas/por-dia", summary="Reservas de um dia específico com utilizadores")
def reservas_por_dia(data: str, session: Session = Depends(get_session)):
    try:
        dia = datetime.strptime(data, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use YYYY-MM-DD")

    reservas = session.exec(select(Reserva)).all()
    equipamento_ids = {r.equipamento_id for r in reservas}
    utilizador_ids = {r.utilizador_id for r in reservas}

    equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all() if equipamento_ids else []
    utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all() if utilizador_ids else []

    equipamentos_por_id = {e.id: e for e in equipamentos}
    utilizadores_por_id = {u.id: u for u in utilizadores}

    resultado: list[dict[str, Any]] = []
    for r in reservas:
        r_inicio = r.data_inicio.date()
        r_fim = r.data_fim.date()
        if r_inicio <= dia <= r_fim:
            eq = equipamentos_por_id.get(r.equipamento_id)
            ut = utilizadores_por_id.get(r.utilizador_id)
            resultado.append({
                "reserva_id": r.id,
                "equipamento_id": r.equipamento_id,
                "equipamento_nome": eq.nome if eq else "—",
                "utilizador_id": r.utilizador_id,
                "utilizador_nome": ut.nome if ut else "—",
                "utilizador_iniciais": iniciais_utilizador(ut),
                "projeto": r.projeto,
            })
    return resultado


@router.post("/reservas", summary="Criar nova reserva")
def criar_reserva(
    dados: ReservaCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> Reserva:
    if dados.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Só pode criar reservas para o próprio utilizador")
    obter_ou_404(session, Equipamento, dados.equipamento_id, "Equipamento não encontrado")
    obter_ou_404(session, Utilizador, dados.utilizador_id, "Utilizador não encontrado")

    validar_intervalo_reserva(dados.data_inicio, dados.data_fim)
    validar_colisao_reserva(session, dados.equipamento_id, dados.data_inicio, dados.data_fim)

    reserva = Reserva(
        equipamento_id=dados.equipamento_id,
        utilizador_id=dados.utilizador_id,
        projeto=dados.projeto,
        metodo=dados.metodo,
        data_inicio=dados.data_inicio,
        data_fim=dados.data_fim,
        notas=dados.notas,
    )
    session.add(reserva)
    persistir_sessao(session, "Falha ao criar reserva")
    session.refresh(reserva)
    return reserva


@router.get("/reservas/exportar/pdf", summary="Exportar todas as reservas em PDF")
def exportar_reservas_pdf(session: Session = Depends(get_session)):
    reservas_raw = listar_reservas_enriquecidas(session)
    agora = agora_utc()

    reservas_ordenadas = sorted(reservas_raw, key=lambda r: r["data_inicio"])

    n_ativas = sum(1 for r in reservas_raw if r.get("esta_ativa"))
    n_futuras = sum(1 for r in reservas_raw if r["data_inicio"] > agora)

    kpis_html = f"""
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Total de Reservas</div>
        <div class="kpi-value">{len(reservas_raw)}</div><div class="kpi-sub">no sistema</div></div>
      <div class="kpi"><div class="kpi-label">Activas</div>
        <div class="kpi-value" style="color:#166534;">{n_ativas}</div><div class="kpi-sub">em curso agora</div></div>
      <div class="kpi"><div class="kpi-label">Futuras</div>
        <div class="kpi-value" style="color:#1e40af;">{n_futuras}</div><div class="kpi-sub">agendadas</div></div>
    </div>"""

    timestamp_fmt = agora.strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro = agora.strftime("%Y%m%d-%H%M%S")

    linhas_tabela = []
    for idx, r in enumerate(reservas_ordenadas, start=1):
        inicio = r["data_inicio"]
        fim = r["data_fim"]
        inicio_str = inicio.strftime("%d/%m/%Y %H:%M") if isinstance(inicio, datetime) else str(inicio)[:16].replace("T", " ")
        fim_str = fim.strftime("%d/%m/%Y %H:%M") if isinstance(fim, datetime) else str(fim)[:16].replace("T", " ")
        projeto = r.get("projeto") or "—"
        metodo = r.get("metodo") or "—"
        if r.get("esta_ativa"):
            estado_badge = '<span class="badge badge-green">● Em curso</span>'
        elif isinstance(fim, datetime) and fim < agora:
            estado_badge = '<span class="badge badge-gray">Concluída</span>'
        else:
            estado_badge = '<span class="badge badge-blue">Agendada</span>'
        linhas_tabela.append(f"""
        <tr>
          <td class="mono" style="text-align:center;">{idx}</td>
          <td><strong>{r["equipamento_nome"]}</strong>
              <span class="dim">{r["equipamento_codigo"]}</span></td>
          <td class="mono">{inicio_str}<br/><span class="dim">{fim_str}</span></td>
          <td>{r["utilizador_nome"]}</td>
          <td>{projeto}</td>
          <td>{metodo}</td>
          <td style="text-align:center;">{estado_badge}</td>
        </tr>""")

    html = html_relatorio(
        titulo_doc="Relatório de Reservas",
        subtitulo="",
        timestamp_fmt=timestamp_fmt,
        meta_extra=f"Total de blocos: <strong>{len(reservas_raw)}</strong>",
        kpis_html=kpis_html,
        section_label="Todas as Reservas",
        cabecalhos=[
            ("#", "3%"), ("Equipamento", "22%"), ("Janela de Alocação", "18%"),
            ("Utilizador", "17%"), ("Projeto", "12%"), ("Método", "12%"), ("Estado", "16%"),
        ],
        linhas_tabela=linhas_tabela,
        colspan=7,
    )

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF de reservas: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="reservas-{timestamp_ficheiro}.pdf"'},
    )


@router.get("/planeamento/exportar/pdf", summary="Exportar relatório executivo do laboratório em PDF formatado")
def exportar_planeamento_pdf(session: Session = Depends(get_session)):
    from collections import defaultdict
    from app.models.reserva import Reserva as ReservaModel
    from app.services.oee_service import calcular_oee_temporal
    from app.services.pdf_service import LOGO_HTML
    from playwright.sync_api import sync_playwright

    agora = agora_utc()
    janela_oee = agora - __import__("datetime").timedelta(days=30)

    todos_equipamentos = session.exec(select(Equipamento)).all()
    total_equipamentos = len(todos_equipamentos)

    todas_reservas_raw = session.exec(select(ReservaModel)).all()
    reservas_ativas = sum(1 for r in todas_reservas_raw if r.data_fim >= agora)

    reservas_periodo = session.exec(
        select(ReservaModel).where(ReservaModel.data_inicio >= janela_oee)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(SessaoUso.inicio >= janela_oee)
    ).all()
    sessoes_ativas_pre = session.exec(
        select(SessaoUso).where(SessaoUso.fim.is_(None), SessaoUso.inicio < janela_oee)
    ).all()

    reservas_por_eq: dict = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_eq[r.equipamento_id].append(r)

    sessoes_por_eq: dict = defaultdict(list)
    for s in sessoes_periodo + list(sessoes_ativas_pre):
        sessoes_por_eq[s.equipamento_id].append(s)

    oees_validos: list[float] = []
    for eq in todos_equipamentos:
        res_eq = reservas_por_eq.get(eq.id, [])
        ses_eq = sessoes_por_eq.get(eq.id, [])
        planeado_s = sum((r.data_fim - r.data_inicio).total_seconds() for r in res_eq)
        real_s = 0.0
        for s in ses_eq:
            fim_ef = s.fim or agora
            real_s += max(0, (fim_ef - max(s.inicio, janela_oee)).total_seconds())
        oee = calcular_oee_temporal(real_s, planeado_s)
        if oee is not None:
            oees_validos.append(oee)

    oee_global_str = (
        f"{round(sum(oees_validos) / len(oees_validos), 1):.1f}%"
        if oees_validos else "—"
    )

    reservas_enriquecidas = listar_reservas_enriquecidas(session)
    reservas_ordenadas = sorted(reservas_enriquecidas, key=lambda r: r["data_inicio"])

    linhas_tabela = []
    for idx, r in enumerate(reservas_ordenadas):
        inicio_str = r["data_inicio"].strftime("%d/%m/%Y %H:%M")
        fim_str = r["data_fim"].strftime("%d/%m/%Y %H:%M")
        projeto = r.get("projeto") or "—"
        metodo = r.get("metodo") or ""
        ativo_badge = '<span class="badge-ativo">● Em curso</span>' if r.get("esta_ativa") else "—"
        linhas_tabela.append(f"""
        <tr>
            <td class="mono" style="text-align:center;">{idx + 1}</td>
            <td><strong>{r['equipamento_nome']}</strong> <span class="dim">{r['equipamento_codigo']}</span></td>
            <td class="mono">{inicio_str}<br/><span class="dim">{fim_str}</span></td>
            <td>{r['utilizador_nome']}</td>
            <td>{projeto}</td>
            <td>{metodo}</td>
            <td style="text-align:center;">{ativo_badge}</td>
        </tr>""")

    timestamp_fmt = agora.strftime("%d/%m/%Y às %H:%M")
    timestamp_file = agora.strftime("%Y%m%d-%H%M%S")

    html = f"""<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8" />
    <style>
        *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
        @page {{ size: A4 landscape; margin: 15mm 12mm 18mm 12mm; }}
        body {{
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9pt;
            color: #1e293b;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-bottom: 3px solid #dc2626;
            padding-bottom: 10px;
            margin-bottom: 14px;
        }}
        .logo-img {{ height: 38px; display: block; }}
        .logo-fallback {{ font-size: 24pt; font-weight: 900; color: #dc2626; line-height: 1; }}
        .subtitle {{ font-size: 8pt; color: #64748b; text-transform: uppercase; margin-top: 2px; }}
        .doc-title {{ font-size: 14pt; font-weight: 700; margin-top: 4px; }}
        .meta {{ font-size: 8pt; color: #64748b; text-align: right; line-height: 1.8; }}
        .kpis {{ display: flex; gap: 12px; margin-bottom: 16px; }}
        .kpi {{
            flex: 1;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 10px 14px;
        }}
        .kpi-label {{ font-size: 7.5pt; color: #64748b; text-transform: uppercase; font-weight: 600; }}
        .kpi-value {{ font-size: 22pt; font-weight: 700; color: #0f172a; line-height: 1.2; margin: 4px 0; }}
        .kpi-sub {{ font-size: 7.5pt; color: #94a3b8; }}
        .section-label {{
            font-size: 8pt;
            font-weight: 700;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }}
        table.plan {{ width: 100%; border-collapse: collapse; }}
        table.plan thead tr {{ background-color: #1e293b; color: #ffffff; }}
        table.plan thead th {{
            padding: 9px 8px;
            font-size: 8.5pt;
            font-weight: 600;
            text-align: left;
            white-space: nowrap;
        }}
        table.plan tbody tr:nth-child(even) {{ background-color: #f8fafc; }}
        table.plan tbody td {{
            padding: 8px;
            font-size: 8.5pt;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
        }}
        .mono {{ font-family: "Courier New", monospace; font-size: 8pt; }}
        .dim {{ color: #94a3b8; font-size: 7.5pt; }}
        .badge-ativo {{
            display: inline-block;
            background: #dcfce7;
            color: #166534;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 600;
        }}
        .footer {{
            margin-top: 14px;
            font-size: 7pt;
            color: #94a3b8;
            text-align: center;
            border-top: 1px solid #e2e8f0;
            padding-top: 6px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div>
            {LOGO_HTML}
            <div class="subtitle">Testing Centre</div>
            <div class="doc-title">Executive Lab Status</div>
        </div>
        <div class="meta">
            Gerado em: {timestamp_fmt} (UTC)<br/>
            Período de análise OEE: últimos 30 dias<br/>
            Blocos de planeamento: <strong>{len(reservas_ordenadas)}</strong>
        </div>
    </div>
    <div class="kpis">
        <div class="kpi">
            <div class="kpi-label">Total de Equipamentos</div>
            <div class="kpi-value">{total_equipamentos}</div>
            <div class="kpi-sub">ativos no inventário</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">Reservas Ativas</div>
            <div class="kpi-value">{reservas_ativas}</div>
            <div class="kpi-sub">com data de fim no futuro</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">OEE Global (30 dias)</div>
            <div class="kpi-value">{oee_global_str}</div>
            <div class="kpi-sub">eficiência operacional média</div>
        </div>
    </div>
    <div class="section-label">Planeamento Global — Todos os Blocos de Alocação</div>
    <table class="plan">
        <thead>
            <tr>
                <th style="width:3%">#</th>
                <th style="width:26%">Equipamento (Cód. Interno)</th>
                <th style="width:20%">Janela de Alocação</th>
                <th style="width:17%">Utilizador</th>
                <th style="width:9%">Projeto</th>
                <th style="width:9%">Método</th>
                <th style="width:16%">Estado</th>
            </tr>
        </thead>
        <tbody>
            {''.join(linhas_tabela) if linhas_tabela else
             '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">'
             'Nenhum bloco de planeamento registado.</td></tr>'}
        </tbody>
    </table>
    <div class="footer">
        Industrial Testing Lab — Documento de Circulação Interna — Confidencial
    </div>
</body>
</html>"""

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="networkidle")
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    margin={"top": "15mm", "right": "12mm", "bottom": "18mm", "left": "12mm"},
                    print_background=True,
                )
            finally:
                browser.close()
    except Exception as exc:
        logger.error("Falha ao gerar PDF do planeamento global: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Lab_Status_Global_{timestamp_file}.pdf"'},
    )
