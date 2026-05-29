from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.core.deps import obter_utilizador_opcional
from app.db.database import get_session
from app.models.base import EstadoEquipamento
from app.models.calibracao import Calibracao
from app.models.equipamento import Equipamento
from app.models.utilizador import Utilizador
from app.schemas.avaria import CalibracaoCreate
from app.services.auth_service import agora_utc, obter_ou_404, persistir_sessao, validar_dias
from app.services.pdf_service import gerar_pdf_playwright, html_relatorio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["calibracoes"])


@router.get("/equipamentos/{equipamento_id}/calibracoes")
def listar_calibracoes(equipamento_id: int, session: Session = Depends(get_session)):
    obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(Calibracao).where(Calibracao.equipamento_id == equipamento_id)
        .order_by(Calibracao.data_realizada.desc())
    ).all()


@router.post("/equipamentos/{equipamento_id}/calibracao")
def registar_calibracao(
    equipamento_id: int,
    dados: CalibracaoCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    _ = utilizador
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    calibracao = Calibracao(
        equipamento_id=equipamento_id,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        certificado_url=dados.certificado_url,
        observacoes=dados.observacoes,
        executado_por_id=dados.executado_por_id,
    )
    eq.estado_atual = EstadoEquipamento.CALIBRACAO.value
    session.add(calibracao)
    session.add(eq)
    persistir_sessao(session, "Falha ao registar calibração")
    session.refresh(calibracao)
    return {"mensagem": "Calibração registada com sucesso", "calibracao": calibracao}


@router.get("/calibracoes")
def listar_todas_calibracoes(session: Session = Depends(get_session)):
    return session.exec(select(Calibracao).order_by(Calibracao.data_realizada.desc())).all()


@router.get("/calibracoes/proximas")
def calibracoes_proximas(dias: int = 30, session: Session = Depends(get_session)):
    dias = validar_dias(dias)
    limite = agora_utc() + timedelta(days=dias)
    return session.exec(
        select(Calibracao).where(
            Calibracao.proxima_data.is_not(None),
            Calibracao.proxima_data <= limite,
        ).order_by(Calibracao.proxima_data)
    ).all()


@router.get("/calibracoes/exportar/pdf", summary="Exportar registo de calibrações em PDF")
def exportar_calibracoes_pdf(
    filtro: Optional[str] = None,
    urgencia: Optional[str] = None,
    session: Session = Depends(get_session),
):
    calibracoes = session.exec(select(Calibracao).order_by(Calibracao.data_realizada.desc())).all()

    eq_ids = {c.equipamento_id for c in calibracoes}
    ut_ids = {c.executado_por_id for c in calibracoes if c.executado_por_id is not None}
    eq_map = {e.id: e for e in session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()} if eq_ids else {}
    ut_map = {u.id: u for u in session.exec(select(Utilizador).where(Utilizador.id.in_(ut_ids))).all()} if ut_ids else {}

    filtro_norm = (filtro or "").strip().lower()
    if filtro_norm:
        calibracoes = [
            c for c in calibracoes
            if filtro_norm in (eq_map.get(c.equipamento_id) and eq_map[c.equipamento_id].nome or "").lower()
            or filtro_norm in (c.observacoes or "").lower()
        ]

    agora = agora_utc()
    if urgencia == "proximas30":
        limite = agora + timedelta(days=30)
        calibracoes = [c for c in calibracoes if c.proxima_data and c.proxima_data <= limite]
    elif urgencia == "vencidas":
        calibracoes = [c for c in calibracoes if c.proxima_data and c.proxima_data < agora]

    timestamp_fmt = agora.strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro = agora.strftime("%Y%m%d-%H%M%S")

    linhas_tabela = []
    for idx, c in enumerate(calibracoes, start=1):
        eq = eq_map.get(c.equipamento_id)
        ut = ut_map.get(c.executado_por_id) if c.executado_por_id else None
        data_str = c.data_realizada.strftime("%d/%m/%Y") if c.data_realizada else "—"
        prox_str = c.proxima_data.strftime("%d/%m/%Y") if c.proxima_data else "—"
        periodo = f"{c.periodicidade_dias} dias" if c.periodicidade_dias else "—"
        cert = '<span class="badge badge-green">Sim</span>' if c.certificado_url else '<span class="badge badge-gray">Não</span>'
        if c.proxima_data and c.proxima_data < agora:
            prox_str = f'<span style="color:#dc2626;font-weight:600;">{prox_str}</span>'
        linhas_tabela.append(f"""
        <tr>
          <td class="mono" style="text-align:center;">{idx}</td>
          <td><strong>{eq.nome if eq else f"EQ-{c.equipamento_id}"}</strong>
              <span class="dim">{eq.codigo if eq else ""}</span></td>
          <td class="mono">{data_str}</td>
          <td class="mono">{prox_str}</td>
          <td class="mono" style="text-align:center;">{periodo}</td>
          <td>{ut.nome if ut else "—"}</td>
          <td style="text-align:center;">{cert}</td>
        </tr>""")

    filtros_desc = ""
    if filtro_norm:
        filtros_desc += f'Pesquisa: "{filtro}" · '
    if urgencia == "proximas30":
        filtros_desc += "Próximas 30 dias"
    elif urgencia == "vencidas":
        filtros_desc += "Vencidas"

    html = html_relatorio(
        titulo_doc="Registo de Calibrações",
        subtitulo=filtros_desc.rstrip(" · "),
        timestamp_fmt=timestamp_fmt,
        meta_extra=f"Total de registos: <strong>{len(calibracoes)}</strong>",
        kpis_html="",
        section_label="Histórico de Calibrações",
        cabecalhos=[
            ("#", "4%"), ("Equipamento", "25%"), ("Data Realizada", "12%"),
            ("Próxima Data", "12%"), ("Periodicidade", "11%"),
            ("Executado por", "22%"), ("Certificado", "14%"),
        ],
        linhas_tabela=linhas_tabela,
        colspan=7,
    )

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF de calibrações: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="calibracoes-{timestamp_ficheiro}.pdf"'},
    )
