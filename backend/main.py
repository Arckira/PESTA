import base64
import hashlib
import hmac
import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, TypeVar

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import io

from xhtml2pdf import pisa
from playwright.sync_api import sync_playwright
from pydantic import BaseModel, model_validator
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select, delete

from database import criar_tabelas, get_session, engine, _garantir_coluna_mssql, IS_MSSQL, _garantir_indices_filtrados_mssql
from models import (
    Avaria,
    Calibracao,
    DocumentacaoEquipamento,
    Equipamento,
    EstadoEquipamento,
    Log,
    Manutencao,
    Reserva,
    RoleUtilizador,
    SessaoAuth,
    SessaoUso,
    SeveridadeAvaria,
    TipoDocumento,
    Utilizador,
    normalizar_estado_equipamento,
)
from collections import defaultdict, deque

logger = logging.getLogger(__name__)
ModeloT = TypeVar("ModeloT")

# Logo INDUSTRIAL TESTING LAB em base64 — embutido no HTML dos PDFs para que o Playwright
# não precise de resolver caminhos de ficheiro durante a renderização.
_LOGO_BASE64: str = ""
try:
    _logo_path = os.path.join(os.path.dirname(__file__), "..", "legacy-frontend", "src", "assets", "industrial-testing-lab-logo.png")
    with open(_logo_path, "rb") as _f:
        _LOGO_BASE64 = base64.b64encode(_f.read()).decode("ascii")
except FileNotFoundError:
    logger.warning("Logo INDUSTRIAL TESTING LAB não encontrado em %s — PDFs usarão texto.", _logo_path)

_LOGO_HTML: str = (
    f'<img src="data:image/png;base64,{_LOGO_BASE64}" alt="INDUSTRIAL TESTING LAB" class="logo-img"/>'
    if _LOGO_BASE64
    else '<div class="logo-fallback">INDUSTRIAL TESTING LAB</div>'
)

# Garante as colunas novas de SessoesUso na primeira chamada ao check-in,
# sem depender de reinício do servidor (migração lazy).
_sessaouso_migrada = False
_avarias_migrada = False
_manutencoes_migrada = False

def _garantir_colunas_sessaouso() -> None:
    global _sessaouso_migrada
    if _sessaouso_migrada:
        return
    try:
        tipo_int = "INT" if IS_MSSQL else "INTEGER"
        tipo_datetime = "DATETIME" if IS_MSSQL else "TIMESTAMP"
        tipo_bool = "BIT" if IS_MSSQL else "INTEGER"
        tipo_texto_150 = "NVARCHAR(150)" if IS_MSSQL else "VARCHAR(150)"
        tipo_texto_180 = "NVARCHAR(180)" if IS_MSSQL else "VARCHAR(180)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "SessoesUso", "duracao_prevista_minutos", f"{tipo_int} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "fim_automatico", f"{tipo_datetime} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "termino_forcado", f"{tipo_bool} NOT NULL DEFAULT 0")
            _garantir_coluna_mssql(conn, "SessoesUso", "valida_para_stats", f"{tipo_bool} NOT NULL DEFAULT 1")
            _garantir_coluna_mssql(conn, "SessoesUso", "projeto", f"{tipo_texto_150} NULL")
            _garantir_coluna_mssql(conn, "SessoesUso", "metodo", f"{tipo_texto_180} NULL")
        _sessaouso_migrada = True
        logger.info("Colunas SessoesUso garantidas (incl. termino_forcado / valida_para_stats).")
    except Exception:
        logger.warning("Não foi possível garantir colunas SessoesUso — migração será re-tentada na próxima chamada.")

def _garantir_colunas_avarias() -> None:
    """Garante que todas as colunas do modelo Avaria existem na base de dados.

    Porquê: a função usa migração lazy (executada na primeira chamada ao endpoint
    de avarias) em vez de ALTER TABLE no arranque do servidor. Esta abordagem evita
    falhas de inicialização quando a base de dados está em modo só-leitura ou
    partilhada, e é segura para múltiplas instâncias do servidor em simultâneo
    porque _garantir_coluna_mssql verifica a existência antes de executar o ALTER.

    Inclui a coluna 'severidade' necessária para o Modo Limitado: sem ela, o
    servidor arrancaria mas a primeira escrita de avaria falharia com erro SQL.
    O DEFAULT 'BLOQUEANTE' garante que registos legados mantêm comportamento
    conservador sem necessidade de um UPDATE separado — operação atómica no SQLite.
    """
    global _avarias_migrada
    if _avarias_migrada:
        return
    try:
        tipo_float = "FLOAT" if IS_MSSQL else "REAL"
        tipo_texto_150 = "NVARCHAR(150)" if IS_MSSQL else "VARCHAR(150)"
        tipo_texto_100 = "NVARCHAR(100)" if IS_MSSQL else "VARCHAR(100)"
        # Coluna de severidade para o Modo Limitado (VARCHAR(20) com DEFAULT BLOQUEANTE)
        tipo_texto_20 = "NVARCHAR(20)" if IS_MSSQL else "VARCHAR(20)"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "Avarias", "custo_reparacao", f"{tipo_float} NULL")
            _garantir_coluna_mssql(conn, "Avarias", "empresa_externa", f"{tipo_texto_150} NULL")
            _garantir_coluna_mssql(conn, "Avarias", "num_sc_po", f"{tipo_texto_100} NULL")
            # Porquê NOT NULL DEFAULT: o SQLite permite ADD COLUMN NOT NULL apenas quando
            # um DEFAULT é fornecido — aplica o valor conservador a todos os registos
            # existentes de forma atómica, sem bloquear leituras concorrentes.
            _garantir_coluna_mssql(
                conn,
                "Avarias",
                "severidade",
                f"{tipo_texto_20} NOT NULL DEFAULT '{SeveridadeAvaria.BLOQUEANTE.value}'",
            )
        _avarias_migrada = True
        logger.info("Colunas Avarias (custo_reparacao, empresa_externa, num_sc_po, severidade) garantidas.")
    except Exception:
        logger.warning("Não foi possível garantir colunas Avarias — migração será re-tentada.")


def _garantir_colunas_manutencoes() -> None:
    global _manutencoes_migrada
    if _manutencoes_migrada:
        return
    try:
        tipo_texto_60 = "NVARCHAR(60)" if IS_MSSQL else "VARCHAR(60)"
        tipo_float = "FLOAT" if IS_MSSQL else "REAL"
        tipo_texto_100 = "NVARCHAR(100)" if IS_MSSQL else "VARCHAR(100)"
        tipo_texto_longo = "NVARCHAR(MAX)" if IS_MSSQL else "TEXT"
        with engine.begin() as conn:
            _garantir_coluna_mssql(conn, "Manutencoes", "tipo_intervencao", f"{tipo_texto_60} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "custo_eur", f"{tipo_float} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "referencia_sc_po", f"{tipo_texto_100} NULL")
            _garantir_coluna_mssql(conn, "Manutencoes", "observacoes_externas", f"{tipo_texto_longo} NULL")
        _manutencoes_migrada = True
        logger.info(
            "Colunas Manutencoes (tipo_intervencao, custo_eur, referencia_sc_po, observacoes_externas) garantidas."
        )
    except Exception:
        logger.warning("Não foi possível garantir colunas Manutencoes — migração será re-tentada.")


def _pdf_escape(texto: str) -> str:
    """Escapa caracteres especiais para conteúdo textual em PDF."""
    return texto.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _gerar_pdf_texto(titulo: str, linhas: list[str]) -> bytes:
    """Gera um PDF textual minimalista sem dependências externas.

    Args:
        titulo: Título apresentado em cada página.
        linhas: Linhas de texto do corpo do relatório.

    Returns:
        bytes: Conteúdo binário do ficheiro PDF.
    """
    linhas_por_pagina = 44
    paginas = [linhas[i:i + linhas_por_pagina] for i in range(0, len(linhas), linhas_por_pagina)] or [[]]

    objetos: list[bytes] = []

    def add_obj(payload: bytes) -> int:
        objetos.append(payload)
        return len(objetos)

    catalog_id = add_obj(b"<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add_obj(b"<< /Type /Pages /Kids [] /Count 0 >>")
    font_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []
    content_ids: list[int] = []

    for pagina in paginas:
        linhas_completas = [titulo, ""] + pagina
        comandos = [
            "BT",
            "/F1 12 Tf",
            "50 790 Td",
            "14 TL",
        ]
        for idx, linha in enumerate(linhas_completas):
            texto = _pdf_escape(linha)
            if idx == 0:
                comandos.append(f"({texto}) Tj")
            else:
                comandos.append("T*")
                comandos.append(f"({texto}) Tj")
        comandos.append("ET")
        stream = "\n".join(comandos).encode("latin-1", errors="replace")
        content_id = add_obj(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        )
        content_ids.append(content_id)

        page_id = add_obj(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode("ascii")
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objetos[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")

    # Garante IDs esperados para referências no PDF.
    if catalog_id != 1 or pages_id != 2 or font_id != 3:
        raise RuntimeError("Estrutura PDF inválida")

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objetos, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{i} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objetos) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))

    pdf.extend(
        (
            f"trailer\n<< /Size {len(objetos) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF"
        ).encode("ascii")
    )
    return bytes(pdf)


def _gerar_pdf_playwright(html: str) -> bytes:
    """Renderiza HTML para PDF via Chromium headless (Playwright).

    Suporta CSS moderno completo: flex, nth-child, background em <tr>, etc.
    """
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
            # Garantido mesmo em caso de excepção — evita fuga de processo Chromium
            browser.close()
    return pdf_bytes


_CSS_RELATORIO = """
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 landscape; margin: 15mm 12mm 18mm 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #1e293b;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { display: flex; justify-content: space-between; align-items: flex-end;
              border-bottom: 3px solid #dc2626; padding-bottom: 10px; margin-bottom: 14px; }
    .logo-img { height: 38px; display: block; }
    .logo-fallback { font-size: 24pt; font-weight: 900; color: #dc2626; line-height: 1; }
    .subtitle { font-size: 8pt; color: #64748b; text-transform: uppercase; margin-top: 4px; }
    .doc-title { font-size: 14pt; font-weight: 700; margin-top: 4px; }
    .meta { font-size: 8pt; color: #64748b; text-align: right; line-height: 1.8; }
    .kpis { display: flex; gap: 12px; margin-bottom: 16px; }
    .kpi { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 14px; }
    .kpi-label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .kpi-value { font-size: 22pt; font-weight: 700; color: #0f172a; line-height: 1.2; margin: 4px 0; }
    .kpi-sub { font-size: 7.5pt; color: #94a3b8; }
    .section-label { font-size: 8pt; font-weight: 700; color: #475569; text-transform: uppercase;
                     letter-spacing: 0.05em; margin-bottom: 8px; }
    table.rel { width: 100%; border-collapse: collapse; }
    table.rel thead tr { background-color: #1e293b; color: #ffffff; }
    table.rel thead th { padding: 9px 8px; font-size: 8.5pt; font-weight: 600;
                         text-align: left; white-space: nowrap; }
    table.rel tbody tr:nth-child(even) { background-color: #f8fafc; }
    table.rel tbody td { padding: 8px; font-size: 8.5pt; border-bottom: 1px solid #e2e8f0;
                         vertical-align: middle; }
    .mono { font-family: "Courier New", monospace; font-size: 8pt; }
    .dim { color: #94a3b8; font-size: 7.5pt; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px;
             font-size: 7.5pt; font-weight: 600; white-space: nowrap; }
    .badge-green  { background: #dcfce7; color: #166534; }
    .badge-red    { background: #fee2e2; color: #991b1b; }
    .badge-blue   { background: #dbeafe; color: #1e40af; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    .badge-purple { background: #ede9fe; color: #5b21b6; }
    .badge-gray   { background: #f1f5f9; color: #334155; }
    .footer { margin-top: 14px; font-size: 7pt; color: #94a3b8; text-align: center;
              border-top: 1px solid #e2e8f0; padding-top: 6px; }
"""


def _html_relatorio(
    titulo_doc: str,
    subtitulo: str,
    timestamp_fmt: str,
    meta_extra: str,
    kpis_html: str,
    section_label: str,
    cabecalhos: list[tuple[str, str]],
    linhas_tabela: list[str],
    colspan: int,
) -> str:
    """Constrói HTML completo para um relatório tabular compatível com Playwright.

    Args:
        titulo_doc: Título principal do documento.
        subtitulo: Subtítulo (ex: filtros activos).
        timestamp_fmt: Data/hora de geração formatada.
        meta_extra: HTML adicional na coluna da direita do cabeçalho.
        kpis_html: Bloco HTML de cards KPI (ou string vazia).
        section_label: Rótulo da secção acima da tabela.
        cabecalhos: Lista de (texto, largura em %) para cada coluna.
        linhas_tabela: Lista de strings HTML para as linhas <tr>.
        colspan: Número de colunas (para linha vazia).
    """
    ths = "".join(
        f'<th style="width:{w};">{txt}</th>' for txt, w in cabecalhos
    )
    tbody = (
        "".join(linhas_tabela)
        if linhas_tabela
        else f'<tr><td colspan="{colspan}" style="text-align:center;padding:20px;color:#94a3b8;">'
             "Nenhum registo encontrado para os filtros aplicados.</td></tr>"
    )
    return f"""<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8"/>
<style>{_CSS_RELATORIO}</style>
</head>
<body>
  <div class="header">
    <div>
      {_LOGO_HTML}
      <div class="subtitle">Testing Centre</div>
      <div class="doc-title">{titulo_doc}</div>
      {f'<div class="dim" style="margin-top:4px;">{subtitulo}</div>' if subtitulo else ''}
    </div>
    <div class="meta">
      Gerado em: {timestamp_fmt} (UTC)<br/>
      {meta_extra}
    </div>
  </div>
  {kpis_html}
  <div class="section-label">{section_label}</div>
  <table class="rel">
    <thead><tr>{ths}</tr></thead>
    <tbody>{tbody}</tbody>
  </table>
  <div class="footer">Industrial Testing Lab — Documento de Circulação Interna — Confidencial</div>
</body>
</html>"""


def _listar_reservas_enriquecidas(session: Session):
    """Obtém reservas com metadados de equipamento, utilizador e sessão real.

    Inclui ``sessao_inicio`` e ``sessao_fim`` da SessaoUso associada para
    permitir comparação visual planeado vs. realizado no calendário.

    Args:
        session: Sessão ativa de base de dados.

    Returns:
        list[dict[str, Any]]: Reservas enriquecidas para consumo no frontend.
    """
    reservas = session.exec(select(Reserva)).all()
    if not reservas:
        return []

    reserva_ids = {r.id for r in reservas}
    equipamento_ids = {r.equipamento_id for r in reservas}
    utilizador_ids = {r.utilizador_id for r in reservas}

    equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all()
    utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all()
    sessoes = session.exec(
        select(SessaoUso).where(SessaoUso.reserva_id.in_(reserva_ids))
    ).all()

    # Sessões ad-hoc ativas (sem reserva_id) no mesmo conjunto de equipamentos —
    # necessário para reservas cujo check-in foi feito sem ligar à reserva explicitamente.
    sessoes_adhoc = session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id.in_(equipamento_ids),
            SessaoUso.reserva_id.is_(None),
            SessaoUso.fim.is_(None),
        )
    ).all()

    equipamentos_por_id = {e.id: e for e in equipamentos}
    utilizadores_por_id = {u.id: u for u in utilizadores}

    # Última sessão vinculada por reserva (mais recente em caso de múltiplos check-ins)
    sessao_por_reserva: dict[int, SessaoUso] = {}
    for s in sessoes:
        if s.reserva_id is not None:
            anterior = sessao_por_reserva.get(s.reserva_id)
            if anterior is None or s.inicio > anterior.inicio:
                sessao_por_reserva[s.reserva_id] = s

    # Sessão ad-hoc ativa mais recente por equipamento
    sessao_adhoc_por_equipamento: dict[int, SessaoUso] = {}
    for s in sessoes_adhoc:
        anterior = sessao_adhoc_por_equipamento.get(s.equipamento_id)
        if anterior is None or s.inicio > anterior.inicio:
            sessao_adhoc_por_equipamento[s.equipamento_id] = s

    resultado: list[dict[str, Any]] = []
    for r in reservas:
        eq = equipamentos_por_id.get(r.equipamento_id)
        ut = utilizadores_por_id.get(r.utilizador_id)
        sess = sessao_por_reserva.get(r.id)

        # Se não há sessão vinculada (ou está fechada), tentar sessão ad-hoc ativa
        # no mesmo equipamento cujo início caia dentro da janela da reserva.
        if (sess is None or sess.fim is not None):
            adhoc = sessao_adhoc_por_equipamento.get(r.equipamento_id)
            if adhoc is not None and r.data_inicio <= adhoc.inicio <= r.data_fim:
                sess = adhoc

        resultado.append(
            {
                "id": r.id,
                "equipamento_id": r.equipamento_id,
                "equipamento_nome": eq.nome if eq else "—",
                "equipamento_codigo": eq.codigo if eq else "—",
                "utilizador_id": r.utilizador_id,
                "utilizador_nome": ut.nome if ut else "—",
                "utilizador_iniciais": _iniciais_utilizador(ut),
                "projeto": r.projeto,
                "metodo": r.metodo,
                "data_inicio": r.data_inicio,
                "data_fim": r.data_fim,
                "notas": r.notas,
                # Dados de execução real provenientes do check-in/checkout
                "sessao_inicio": sess.inicio if sess else None,
                "sessao_fim": sess.fim if sess else None,
                # True se há sessão ativa (check-in feito mas checkout ainda não)
                "esta_ativa": sess is not None and sess.fim is None,
            }
        )
    return resultado


def _iniciais_nome(nome: str) -> str:
    """Calcula iniciais com base no primeiro e último nome.

    Args:
        nome: Nome completo do utilizador.

    Returns:
        str: Iniciais em maiúsculas.
    """
    partes = [parte for parte in nome.split() if parte]
    if not partes:
        return ""
    if len(partes) == 1:
        return partes[0][0].upper()
    return f"{partes[0][0]}{partes[-1][0]}".upper()


def _iniciais_utilizador(utilizador: Optional[Utilizador]) -> str:
    """Obtém iniciais consistentes para um utilizador opcional."""
    if not utilizador:
        return ""
    if utilizador.iniciais:
        return utilizador.iniciais
    return _iniciais_nome(utilizador.nome or "")


def _obter_ou_404(
    session: Session,
    modelo: type[ModeloT],
    identificador: int,
    detalhe: str,
) -> ModeloT:
    """Obtém entidade por ID ou devolve erro HTTP 404."""
    item = session.get(modelo, identificador)
    if not item:
        raise HTTPException(status_code=404, detail=detalhe)
    return item


def _calcular_metricas_uso(
    reservas: list[Reserva],
    sessoes: list[SessaoUso],
) -> dict[str, float]:
    """Calcula métricas de eficiência temporal de utilização.

    Notes:
        Em cenários com milhões de registos, a agregação temporal pode ser
        migrada para Polars/NumPy para reduzir latência de CPU em batch.
    """
    tempo_reservado = sum((r.data_fim - r.data_inicio).total_seconds() for r in reservas)
    tempo_real = sum((s.fim - s.inicio).total_seconds() for s in sessoes if s.fim is not None)
    eficiencia = round((tempo_real / tempo_reservado * 100), 1) if tempo_reservado > 0 else 0
    return {
        "tempo_reservado_horas": round(tempo_reservado / 3600, 2),
        "tempo_real_horas": round(tempo_real / 3600, 2),
        "eficiencia_pct": eficiencia,
    }


# Margem de segurança para turnos industriais: 10h (600 min) cobre o turno
# de 8h mais possíveis horas extraordinárias e passagens de turno sobrepostas.
# Configurável via variável de ambiente ACCESS_TOKEN_EXPIRE_MINUTES.
TOKEN_TTL_MINUTOS: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "600"))
PIN_INICIAL = "0000"
# deque(maxlen=500): evicção automática O(1) quando o limite é atingido.
# list com del[0] é O(n) — todos os elementos são deslocados em memória
# a cada chamada de autenticação, ineficiente em ambiente de alta frequência.
_logs_auth: deque[dict] = deque(maxlen=500)


def _agora_utc() -> datetime:
    """Devolve a data/hora UTC atual."""
    return datetime.now(timezone.utc)


def _iso_z(dt: datetime | None) -> str | None:
    """Serializa datetimes em ISO-8601 com sufixo Z."""

    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalizar_pin(pin: str) -> str:
    """Remove espaços desnecessários do PIN."""
    return pin.strip()


def _validar_formato_pin(pin: str) -> None:
    """Valida que o PIN tem exatamente 4 dígitos numéricos."""
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN deve ter exatamente 4 dígitos")


def _validar_dias(dias: int) -> int:
    """Valida o período de análise para evitar consultas descontroladas."""
    if dias < 1 or dias > 365:
        raise HTTPException(status_code=400, detail="O parâmetro 'dias' deve estar entre 1 e 365")
    return dias


def _calcular_oee_temporal(tempo_real_s: float, tempo_planeado_s: float) -> float | None:
    """OEE = min(Tempo_Real / Tempo_Planeado, 1) × 100.

    Centraliza a fórmula para que todos os endpoints usem o mesmo cálculo.
    Devolve None se não houver tempo planeado (sem reservas no período).
    Limita a 100% para que overruns não distorçam a métrica de eficiência.
    """
    if tempo_planeado_s <= 0:
        return None
    return round(min(tempo_real_s / tempo_planeado_s, 1.0) * 100, 1)


def _calcular_valida_para_stats(inicio: datetime, fim: datetime, termino_forcado: bool) -> bool:
    """Sessão válida para OEE: duracao >= 300s E não foi um término forçado."""
    duracao_s = (fim - inicio).total_seconds()
    return duracao_s >= 300 and not termino_forcado


def _hash_pin(pin: str) -> str:
    """Encripta o PIN usando PBKDF2-SHA256 com sal único."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000)
    return f"{salt}${digest.hex()}"


def _verificar_pin(pin: str, pin_hash: str) -> bool:
    """Verifica que o PIN introduzido corresponde ao hash armazenado."""
    try:
        salt, esperado = pin_hash.split("$", 1)
    except ValueError:
        return False
    atual = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000).hex()
    return hmac.compare_digest(atual, esperado)


def _registar_log(
    acao: str,
    sucesso: bool,
    detalhe: str,
    utilizador_id: Optional[int] = None,
) -> None:
    """Regista evento de autenticação em memória para auditoria rápida.
    
    Porque: Permite auditoria em tempo real sem impacto em performance na base de dados.
    """
    # deque(maxlen=500) ejeta automaticamente o registo mais antigo quando cheio
    _logs_auth.append({
        "timestamp": _iso_z(_agora_utc()),
        "acao": acao,
        "sucesso": sucesso,
        "detalhe": detalhe,
        "utilizador_id": utilizador_id,
    })


def _registar_log_bd(
    session: Session,
    acao: str,
    sucesso: bool,
    detalhe: str,
    utilizador_id: Optional[int] = None,
    utilizador_nome: Optional[str] = None,
    role: Optional[str] = None,
    entidade: Optional[str] = None,
    entidade_id: Optional[int] = None,
) -> None:
    """Persiste um registo de auditoria na base de dados.

    Porque: logs em BD sobrevivem a reinícios e permitem auditorias forenses,
    ao contrário do buffer em memória volátil (_logs_auth). Erros de escrita
    são ignorados (só registados) para nao bloquear a operação principal.
    """
    try:
        entrada = Log(
            utilizador_id=utilizador_id,
            utilizador_nome=utilizador_nome,
            role=role,
            acao=acao,
            entidade=entidade,
            entidade_id=entidade_id,
            detalhe=detalhe,
            sucesso=sucesso,
        )
        session.add(entrada)
        session.flush()
    except SQLAlchemyError:
        logger.warning("Falha ao persistir log de auditoria para accao '%s'", acao)
        # Porquê: um flush falhado deixa a sessão SQLAlchemy num estado inválido
        # (rolled-back state). Se não fizermos rollback aqui, o próximo commit
        # no endpoint que chamou esta função lança InvalidRequestError, transformando
        # uma falha de log (não-crítica) numa falha de operação (crítica).
        try:
            session.rollback()
        except Exception:
            pass


def _criar_sessao(utilizador: Utilizador, session: Session) -> dict[str, Any]:
    """Cria e persiste uma nova sessão de autenticação em base de dados.
    
    Porque: A persistência em BD garante que as sessões sobrevivem a reinícios
    de servidor, essencial para resiliência em ambientes de laboratório críticos.
    
    Args:
        utilizador: Utilizador para o qual criar a sessão.
        session: Sessão ativa da base de dados.
    
    Returns:
        dict: Token, data de expiração em ISO e milissegundos.
    
    Raises:
        HTTPException: Se a operação na base de dados falhar.
    """
    try:
        token = secrets.token_urlsafe(32)
        expira_em = _agora_utc() + timedelta(minutes=TOKEN_TTL_MINUTOS)
        
        sessao_auth = SessaoAuth(
            token=token,
            utilizador_id=utilizador.id,
            role=utilizador.role,
            expira_em=expira_em,
        )
        session.add(sessao_auth)
        session.commit()
        
        return {
            "token": token,
            "expira_em": _iso_z(expira_em),
            "expira_em_epoch_ms": int(expira_em.timestamp() * 1000),
        }
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Falha ao criar sessão de autenticação para utilizador %d", utilizador.id)
        raise HTTPException(
            status_code=503,
            detail="Falha ao criar sessão de autenticação"
        ) from exc


def _extrair_token(authorization: Optional[str]) -> str:
    """Extrai o token JWT do cabeçalho Authorization."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    prefixo = "Bearer "
    if not authorization.startswith(prefixo):
        raise HTTPException(status_code=401, detail="Formato de autorização inválido")
    return authorization[len(prefixo):].strip()


def obter_utilizador_atual(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> Utilizador:
    """Valida o token e devolve o utilizador autenticado.
    
    Porque: Centralizar a validação de sessão garante que políticas de segurança
    (expiração, utilizadores desativados) são aplicadas consistentemente.
    
    Args:
        authorization: Cabeçalho Authorization com token Bearer.
        session: Sessão ativa da base de dados.
    
    Returns:
        Utilizador autenticado e ativo.
    
    Raises:
        HTTPException 401: Se o token for inválido, expirado ou utilizador inativo.
    """
    try:
        token = _extrair_token(authorization)
        
        # Consulta a sessão autenticada na base de dados
        sessao_auth = session.get(SessaoAuth, token)
        if not sessao_auth:
            raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
        
        # Verifica se a sessão expirou
        agora = _agora_utc()
        if sessao_auth.expira_em <= agora:
            # Porquê flush em vez de commit: esta dependência é invocada antes de
            # qualquer lógica de endpoint. Um commit aqui confirmaria a deleção
            # mas deixaria a sessão SQLAlchemy num estado que pode conflituar com
            # o rollback do endpoint em caso de falha posterior. O flush propaga
            # a deleção para a transacção activa sem a confirmar — a limpeza de
            # sessões expiradas não é crítica e já é feita pelo lifespan no arranque.
            session.delete(sessao_auth)
            session.flush()
            raise HTTPException(status_code=401, detail="Sessão expirada")

        # Obtém o utilizador e valida ativação
        utilizador = session.get(Utilizador, sessao_auth.utilizador_id)
        if not utilizador or not utilizador.ativo:
            # Idem — flush em vez de commit pela mesma razão acima.
            session.delete(sessao_auth)
            session.flush()
            raise HTTPException(status_code=401, detail="Utilizador inválido ou inativo")
        
        return utilizador
        
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao validar sessão: %s", authorization)
        raise HTTPException(
            status_code=503,
            detail="Erro ao validar sessão"
        ) from exc


def obter_utilizador_opcional(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> Optional[Utilizador]:
    """Devolve o utilizador autenticado ou None se não autenticado.

    Usado em endpoints acessíveis anonimamente (ex: via QR Code) mas que
    também aceitam utilizadores autenticados.
    """
    if not authorization:
        return None
    try:
        return obter_utilizador_atual(authorization=authorization, session=session)
    except HTTPException:
        return None


def _persistir_sessao(session: Session, detalhe_erro: str) -> None:
    """Efetua commit transacional com rollback e erro HTTP controlado.

    Args:
        session: Sessão ativa da base de dados.
        detalhe_erro: Mensagem devolvida ao cliente em caso de falha.
    """
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Falha transacional: %s", detalhe_erro)
        raise HTTPException(status_code=503, detail=detalhe_erro) from exc


def exigir_admin(utilizador: Utilizador = Depends(obter_utilizador_atual)) -> Utilizador:
    if utilizador.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Acesso reservado a administradores")
    return utilizador


def exigir_pin_alterado(utilizador: Utilizador = Depends(obter_utilizador_atual)) -> Utilizador:
    if utilizador.forcar_troca_pin:
        raise HTTPException(status_code=403, detail="PIN inicial deve ser alterado antes de continuar")
    return utilizador


def _limpar_sessoes_expiradas(session: Session) -> int:
    """Remove sessões expiradas da base de dados.
    
    Porque: Manter a tabela de sessões limpa evita crescimento infinito e melhora
    performance das queries de validação de sessão. Deve ser executada periodicamente
    ou como parte de manutenção.
    
    Returns:
        int: Número de sessões removidas.
    """
    try:
        agora = _agora_utc()
        consulta = select(SessaoAuth).where(SessaoAuth.expira_em <= agora)
        sessoes_expiradas = session.exec(consulta).all()
        
        quantidade = len(sessoes_expiradas)
        for sessao in sessoes_expiradas:
            session.delete(sessao)
        
        if quantidade > 0:
            session.commit()
            logger.info("Removidas %d sessões expiradas de autenticação", quantidade)
        
        return quantidade
        
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao limpar sessões expiradas")
        return 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Garante inicialização de infraestrutura antes de aceitar pedidos.
    
    Nota: Limpeza de sessões expiradas deve ser agendada separadamente (ex: APScheduler)
    para não bloquear o arranque da aplicação.
    """
    criar_tabelas()
    _garantir_colunas_sessaouso()
    _garantir_colunas_avarias()
    _garantir_colunas_manutencoes()
    # Limpa tokens expirados ao arrancar para evitar acumulação desnecessária.
    try:
        with Session(engine) as s:
            s.exec(delete(SessaoAuth).where(SessaoAuth.expira_em < _agora_utc()))
            s.commit()
    except Exception:
        logger.exception("Falha ao limpar sessões expiradas durante o arranque")
    # Índice único filtrado: garante ao nível da BD que não pode existir mais do
    # que uma sessão ativa (fim IS NULL) por equipamento em simultâneo.
    # Porquê aqui e não no modelo SQLModel: o SQLite não suporta índices parciais
    # via SQLModel/Alembic autogenerate — tem de ser criado via SQL direto.
    # CREATE UNIQUE INDEX IF NOT EXISTS é idempotente — seguro em cada arranque.
    # Este índice transforma a race condition do check-in duplo num IntegrityError
    # que o endpoint trata devolvendo HTTP 409, em vez de dados duplicados silenciosos.
    try:
        from sqlalchemy import text
        with Session(engine) as s:
            s.exec(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_sessao_ativa_unica "
                "ON SessoesUso (equipamento_id) WHERE fim IS NULL"
            ))
            s.commit()
        logger.info("Índice de sessão ativa única garantido em SessoesUso.")
    except Exception:
        logger.warning("Não foi possível criar índice ix_sessao_ativa_unica — check-in duplo não está protegido ao nível da BD.")
    yield

app = FastAPI(
    title="Industrial Testing Lab",
    description="Gestão de equipamentos de laboratório",
    lifespan=lifespan
)

# CORS — necessário para o React (Vite) comunicar com o FastAPI em desenvolvimento
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(SQLAlchemyError)
async def _tratar_erro_base_dados(request, exc):
    """Converte SQLAlchemyError nao tratado em 503.

    Porque: endpoints de leitura simples (GETs) nao têm try/except próprio;
    este handler garante que uma falha de BD devolve sempre 503 e nao 500,
    mantendo a interface de erros consistente com os endpoints que já têm
    tratamento explícito.
    """
    logger.exception("Erro de base de dados nao tratado em %s %s", request.method, request.url)
    return JSONResponse(
        status_code=503,
        content={"detail": "Falha temporária na base de dados. Tente novamente."},
    )


# ─────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────

class EstadoUpdate(BaseModel):
    # Aceita string (ex: "Disponível", "Ocupado") para flexibilidade com frontend
    novo_estado: str

class AvariaCreate(BaseModel):
    """Payload de entrada para registo de uma nova avaria.

    Porquê: validar o campo 'severidade' aqui (camada Pydantic), antes de
    qualquer acesso à base de dados, garante que valores inválidos são
    rejeitados com HTTP 422 (Unprocessable Entity) — o código de estado
    REST correto para erros de validação de input — sem consumir uma
    transação de BD desnecessária.
    """

    descricao: str
    utilizador_id: Optional[int] = None
    empresa_externa: Optional[str] = None
    custo_reparacao: Optional[float] = None
    num_sc_po: Optional[str] = None
    # Default BLOQUEANTE: a omissão do campo pelo frontend nunca deve resultar
    # num estado mais permissivo do que o esperado — princípio de falha segura.
    severidade: str = SeveridadeAvaria.BLOQUEANTE.value

    @model_validator(mode="after")
    def validar_severidade(self) -> "AvariaCreate":
        """Rejeita valores de severidade fora do enum SeveridadeAvaria.

        Porquê: o modelo Avaria persiste 'severidade' como VARCHAR(20) sem
        restrição CHECK na BD (SQLite não a suporta nativamente). A validação
        aqui é a única barreira antes da escrita — sem ela, um valor inválido
        entraria na BD silenciosamente e corromperia a máquina de estados.
        """
        valores_validos = {s.value for s in SeveridadeAvaria}
        if self.severidade not in valores_validos:
            raise ValueError(
                f"Severidade inválida: '{self.severidade}'. "
                f"Valores aceites: {sorted(valores_validos)}"
            )
        return self

class AvariaResolve(BaseModel):
    relatorio_tecnico: Optional[str] = None
    custo: Optional[float] = None

class ManutencaoCreate(BaseModel):
    descricao: str
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    executado_por_id: Optional[int] = None
    tipo_intervencao: Optional[str] = None
    custo_eur: Optional[float] = None
    fornecedor: Optional[str] = None
    referencia_sc_po: Optional[str] = None
    observacoes_externas: Optional[str] = None

class CalibracaoCreate(BaseModel):
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    certificado_url: Optional[str] = None
    observacoes: Optional[str] = None
    executado_por_id: Optional[int] = None
    custo_eur: Optional[float] = None
    fornecedor: Optional[str] = None

class DocumentoCreate(BaseModel):
    titulo: str
    tipo_documento: TipoDocumento = TipoDocumento.OUTRO
    caminho_ficheiro: str
    descricao: Optional[str] = None
    carregado_por_id: Optional[int] = None

class CheckinCreate(BaseModel):
    reserva_id: Optional[int] = None  # Opcional: pode fazer checkin sem reserva
    duracao_prevista_minutos: Optional[int] = None  # Duração estimada do ensaio em minutos
    projeto: Optional[str] = None
    metodo: Optional[str] = None

class CheckoutCreate(BaseModel):
    concluido_com_sucesso: bool = True  # Marca se o ensaio foi concluído com sucesso

class AtualizarDuracaoCreate(BaseModel):
    duracao_prevista_minutos: int

class ReservaCreate(BaseModel):
    equipamento_id: int
    utilizador_id: int
    projeto: Optional[str] = None
    # Porque: o método de ensaio permite rastrear a norma aplicada em cada reserva.
    metodo: Optional[str] = None
    data_inicio: datetime
    data_fim: datetime
    notas: Optional[str] = None
    # Duração estimada do ensaio em minutos (preenchida quando inicia o check-in)
    duracao_prevista_minutos: Optional[int] = None
    # Indica se o ensaio foi concluído com sucesso (usado para cálculo de OEE)
    concluido_com_sucesso: Optional[bool] = None

    @model_validator(mode="after")
    def validar_intervalo(self) -> "ReservaCreate":
        """Valida regras temporais da reserva no boundary de input.

        Notes:
            Esta validação no schema impede que regras de negócio cruciais
            fiquem dispersas por múltiplos endpoints e reduz regressões.
        """
        if self.data_fim <= self.data_inicio:
            raise ValueError("data_fim tem de ser posterior a data_inicio")

        for campo, valor in (("data_inicio", self.data_inicio), ("data_fim", self.data_fim)):
            if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
                raise ValueError(f"{campo} deve estar alinhada à hora cheia (ex: 09:00)")

        duracao_segundos = (self.data_fim - self.data_inicio).total_seconds()
        if duracao_segundos < 3600:
            raise ValueError("A reserva mínima é de 1 hora")
        if duracao_segundos % 3600 != 0:
            raise ValueError("A duração da reserva deve ser em horas inteiras")
        return self


class ReservaUpdate(BaseModel):
    equipamento_id: Optional[int] = None
    projeto: Optional[str] = None
    data_inicio: Optional[datetime] = None
    data_fim: Optional[datetime] = None
    notas: Optional[str] = None
    duracao_prevista_minutos: Optional[int] = None
    concluido_com_sucesso: Optional[bool] = None


def _validar_intervalo_reserva(data_inicio: datetime, data_fim: datetime) -> None:
    """Valida o intervalo temporal de uma reserva antes de persistir.

    Porque: a colisão de horários e a consistência das horas cheias são regras
    de negócio centrais do laboratório, por isso devem ser verificadas no servidor.
    """

    if data_fim <= data_inicio:
        raise HTTPException(status_code=400, detail="A data de fim tem de ser posterior à data de início")

    for campo, valor in (("data_inicio", data_inicio), ("data_fim", data_fim)):
        if valor.minute != 0 or valor.second != 0 or valor.microsecond != 0:
            raise HTTPException(
                status_code=400,
                detail=f"{campo} deve estar alinhado à hora cheia (ex: 09:00)",
            )

    duracao_segundos = (data_fim - data_inicio).total_seconds()
    if duracao_segundos < 3600:
        raise HTTPException(status_code=400, detail="A reserva mínima é de 1 hora")
    if duracao_segundos % 3600 != 0:
        raise HTTPException(status_code=400, detail="A duração da reserva deve ser em horas inteiras")


def _validar_colisao_reserva(
    session: Session,
    equipamento_id: int,
    data_inicio: datetime,
    data_fim: datetime,
    reserva_id: Optional[int] = None,
) -> None:
    """Garante que não existe sobreposição temporal para o mesmo equipamento."""

    consulta = select(Reserva).where(
        Reserva.equipamento_id == equipamento_id,
        Reserva.data_inicio < data_fim,
        Reserva.data_fim > data_inicio,
    )
    if reserva_id is not None:
        consulta = consulta.where(Reserva.id != reserva_id)

    conflito = session.exec(consulta).first()
    if conflito:
        raise HTTPException(
            status_code=409,
            detail="Já existe uma reserva para este equipamento no intervalo selecionado",
        )

class UtilizadorCreate(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: RoleUtilizador = RoleUtilizador.USER
    pin: Optional[str] = None


class UtilizadorUpdate(BaseModel):
    nome: Optional[str] = None
    numero_colaborador: Optional[str] = None
    departamento: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: Optional[RoleUtilizador] = None
    pin: Optional[str] = None


class LoginRequest(BaseModel):
    user_id: int
    pin: str


class AlterarPinRequest(BaseModel):
    pin_atual: str
    novo_pin: str


class AdminAlterarPinRequest(BaseModel):
    novo_pin: str


class AlterarRoleRequest(BaseModel):
    role: RoleUtilizador
    pin_atual: Optional[str] = None


class BootstrapAdminRequest(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    pin: str

class AutoRegistoRequest(BaseModel):
    """Schema para auto-registo de novo utilizador."""
    nome: str
    numero_colaborador: str
    departamento: Optional[str] = None
    email: Optional[str] = None
    pin: str
    
    @model_validator(mode="after")
    def validar_pin_registo(self) -> "AutoRegistoRequest":
        """Valida que o PIN tem exatamente 4 dígitos numéricos."""
        pin_normalizado = self.pin.strip()
        if len(pin_normalizado) != 4 or not pin_normalizado.isdigit():
            raise ValueError("PIN deve ter exatamente 4 dígitos")
        return self

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
    # Limites térmicos e de humidade — editáveis via Ficha Técnica
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidade_max: Optional[float] = None
    # Permite alterar o estado via PATCH /equipamentos/{id}. Se for enviado
    # um estado igual a "Avariado" e ocorrer uma transição (antigo != novo),
    # o sistema criará automaticamente um registo de Avaria na mesma transacção.
    estado_atual: Optional[str] = None
    # Descrição opcional associada à Avaria criada automaticamente.
    descricao_avaria: Optional[str] = None

class EquipamentoCreate(BaseModel):
    nome: str
    tipo: str
    localizacao: str
    codigo: str
    numero_serie: Optional[str] = None
    # Limites térmicos — correspondem às colunas Float do modelo Equipamento
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
    # Aceita string (ex: "Disponível", "Ocupado") para flexibilidade com frontend
    estado_atual: str = EstadoEquipamento.DISPONIVEL.value
    foto_url: Optional[str] = None

# ─────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────

@app.get("/auth/utilizadores", summary="Lista de utilizadores ativos para login")
def listar_utilizadores_login(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    utilizadores = session.exec(select(Utilizador).where(Utilizador.ativo == True).order_by(Utilizador.nome)).all()
    return [{"id": u.id, "nome": u.nome, "iniciais": _iniciais_utilizador(u)} for u in utilizadores]


@app.post("/auth/login", summary="Login por utilizador + PIN")
def auth_login(dados: LoginRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    pin = _normalizar_pin(dados.pin)
    _validar_formato_pin(pin)

    utilizador = session.get(Utilizador, dados.user_id)
    if not utilizador or not utilizador.ativo:
        _registar_log("login", False, "Utilizador não encontrado ou inativo", dados.user_id)
        raise HTTPException(status_code=404, detail="Utilizador não encontrado")

    if not utilizador.pin_hash or '$' not in utilizador.pin_hash:
        utilizador.pin_hash = _hash_pin(PIN_INICIAL)
        utilizador.forcar_troca_pin = True
        session.add(utilizador)
        _persistir_sessao(session, "Falha ao inicializar credenciais do utilizador")
        session.refresh(utilizador)

    if not _verificar_pin(pin, utilizador.pin_hash):
        _registar_log("login", False, "PIN inválido", utilizador.id)
        raise HTTPException(status_code=401, detail="PIN inválido")

    # Renovação automática: se já existe sessão válida criada hoje, prolonga-a
    # em vez de criar um token novo — evita acumulação de sessões no mesmo turno.
    agora = _agora_utc()
    inicio_do_dia = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    sessao_ativa = session.exec(
        select(SessaoAuth).where(
            SessaoAuth.utilizador_id == utilizador.id,
            SessaoAuth.criado_em >= inicio_do_dia,
            SessaoAuth.expira_em > agora,
        )
    ).first()

    if sessao_ativa:
        sessao_ativa.expira_em = agora + timedelta(minutes=TOKEN_TTL_MINUTOS)
        session.add(sessao_ativa)
        _registar_log_bd(session, "login_renovacao", True, "Token renovado (mesmo turno)", utilizador.id, utilizador.nome, str(utilizador.role))
        try:
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            raise HTTPException(status_code=503, detail="Falha ao renovar sessão") from exc
        sessao = {
            "token": sessao_ativa.token,
            "expira_em": _iso_z(sessao_ativa.expira_em),
            "expira_em_epoch_ms": int(sessao_ativa.expira_em.timestamp() * 1000),
        }
    else:
        _registar_log_bd(session, "login", True, "Login com sucesso", utilizador.id, utilizador.nome, str(utilizador.role))
        sessao = _criar_sessao(utilizador, session)

    _registar_log("login", True, "Login com sucesso", utilizador.id)
    return {
        "token": sessao["token"],
        "expira_em": sessao["expira_em"],
        "expira_em_epoch_ms": sessao["expira_em_epoch_ms"],
        "utilizador": {
            "id": utilizador.id,
            "nome": utilizador.nome,
            "iniciais": _iniciais_utilizador(utilizador),
            "role": utilizador.role.value if isinstance(utilizador.role, RoleUtilizador) else str(utilizador.role),
            "forcar_troca_pin": utilizador.forcar_troca_pin,
        },
    }


@app.get("/auth/bootstrap-status", summary="Estado da configuração inicial")
def auth_bootstrap_status(session: Session = Depends(get_session)):
    existe_admin = session.exec(
        select(Utilizador).where(
            Utilizador.ativo == True,
            Utilizador.role == RoleUtilizador.ADMIN,
        )
    ).first()
    return {
        "has_admin": bool(existe_admin),
        "can_bootstrap": not bool(existe_admin),
    }


@app.post("/auth/bootstrap-admin", summary="Criar primeiro admin (uso único)")
def auth_bootstrap_admin(
    dados: BootstrapAdminRequest,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    existe_admin = session.exec(
        select(Utilizador).where(
            Utilizador.ativo == True,
            Utilizador.role == RoleUtilizador.ADMIN,
        )
    ).first()
    if existe_admin:
        raise HTTPException(status_code=403, detail="Bootstrap indisponível: já existe um administrador ativo")

    pin = _normalizar_pin(dados.pin)
    _validar_formato_pin(pin)

    utilizador_existente = session.exec(
        select(Utilizador).where(
            Utilizador.numero_colaborador == dados.numero_colaborador,
        )
    ).first()

    if utilizador_existente:
        utilizador_existente.nome = dados.nome
        utilizador_existente.departamento = dados.departamento
        utilizador_existente.pin_hash = _hash_pin(pin)
        utilizador_existente.role = RoleUtilizador.ADMIN
        utilizador_existente.ativo = True
        utilizador_existente.forcar_troca_pin = False
        admin = utilizador_existente
    else:
        admin = Utilizador(
            nome=dados.nome,
            numero_colaborador=dados.numero_colaborador,
            departamento=dados.departamento,
            pin_hash=_hash_pin(pin),
            role=RoleUtilizador.ADMIN,
            ativo=True,
            forcar_troca_pin=False,
        )
    session.add(admin)
    _persistir_sessao(session, "Falha ao criar administrador inicial")
    session.refresh(admin)
    _registar_log("bootstrap_admin", True, "Primeiro admin criado", admin.id)
    return {"mensagem": "Admin inicial criado com sucesso", "utilizador_id": admin.id}


@app.post("/auth/auto-registo", summary="Auto-registo de novo utilizador")
def auth_auto_registo(
    dados: AutoRegistoRequest,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Auto-registo de novo utilizador sem requer aprovação de admin.
    
    Fluxo:
    1. Valida que numero_colaborador é único
    2. Hash do PIN com PBKDF2 (16 bytes salt, 150k iterações)
    3. Cria utilizador com role=USER e ativo=True
    4. Retorna ID do novo utilizador
    
    Porque: Permite que colaboradores se registem de forma autónoma no sistema,
    reduzindo carga administrativa. PIN é encriptado antes de persistência.
    Cada utilizador inicia com forcar_troca_pin=False (pode alterar PIN no 1º login).
    
    Args:
        dados: Dados de registo (nome, numero_colaborador, pin, departamento, email)
        session: Sessão de base de dados
    
    Returns:
        dict: Confirmação com ID do novo utilizador
    
    Raises:
        HTTPException 400: Se validação de Pydantic falhar (ex: PIN < 4 dígitos)
        HTTPException 409: Se numero_colaborador já existe
        HTTPException 503: Se falha de base de dados
    """
    pin = _normalizar_pin(dados.pin)
    
    # Verifica se o número de colaborador já existe (ativo ou inativo)
    utilizador_existente = session.exec(
        select(Utilizador).where(
            Utilizador.numero_colaborador == dados.numero_colaborador.strip()
        )
    ).first()
    
    if utilizador_existente:
        _registar_log(
            "auto_registo", 
            False, 
            f"Número de colaborador duplicado: {dados.numero_colaborador}",
            None
        )
        raise HTTPException(
            status_code=409, 
            detail="Número de colaborador já está registado no sistema"
        )
    
    try:
        # Cria novo utilizador com papel de USER
        novo_utilizador = Utilizador(
            nome=dados.nome.strip(),
            numero_colaborador=dados.numero_colaborador.strip(),
            departamento=dados.departamento.strip() if dados.departamento else None,
            email=dados.email.strip() if dados.email else None,
            pin_hash=_hash_pin(pin),
            role=RoleUtilizador.USER,
            ativo=True,
            forcar_troca_pin=False,  # Utilizador criado já pode fazer login
        )
        session.add(novo_utilizador)
        _persistir_sessao(session, "Falha ao registar novo utilizador")
        session.refresh(novo_utilizador)
        
        _registar_log(
            "auto_registo", 
            True, 
            f"Auto-registo com sucesso: {novo_utilizador.nome} ({novo_utilizador.numero_colaborador})",
            novo_utilizador.id
        )
        _registar_log_bd(
            session,
            "auto_registo",
            True,
            f"Novo utilizador registado: {novo_utilizador.nome}",
            novo_utilizador.id,
            novo_utilizador.nome,
            str(novo_utilizador.role),
            "Utilizador",
            novo_utilizador.id
        )
        
        return {
            "mensagem": "Auto-registo bem-sucedido",
            "utilizador_id": novo_utilizador.id,
            "utilizador_nome": novo_utilizador.nome,
        }
        
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados em auto-registo para %s", dados.numero_colaborador)
        _registar_log(
            "auto_registo",
            False,
            "Erro de base de dados",
            None
        )
        raise HTTPException(
            status_code=503,
            detail="Falha ao registar utilizador na base de dados"
        ) from exc


@app.get("/auth/me", summary="Utilizador atual")
def auth_me(utilizador: Utilizador = Depends(obter_utilizador_atual)) -> dict[str, Any]:
    return {
        "id": utilizador.id,
        "nome": utilizador.nome,
        "iniciais": _iniciais_utilizador(utilizador),
        "role": utilizador.role,
        "forcar_troca_pin": utilizador.forcar_troca_pin,
    }


@app.post("/auth/logout", summary="Terminar sessão")
def auth_logout(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Termina a sessão de autenticação do utilizador.
    
    Porque: Remover a sessão da base de dados garante que o token não pode ser
    reutilizado, mesmo em caso de roubo de token depois do logout.
    """
    try:
        token = _extrair_token(authorization)
        sessao_auth = session.get(SessaoAuth, token)
        
        if sessao_auth:
            utilizador_id = sessao_auth.utilizador_id
            _registar_log_bd(session, "logout", True, "Sessão terminada", utilizador_id)
            session.delete(sessao_auth)
            session.commit()
            _registar_log("logout", True, "Sessão terminada", utilizador_id)
        else:
            _registar_log("logout", False, "Sessão não encontrada", None)
        
        return {"mensagem": "Sessão terminada"}
        
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao terminar sessão: %s", authorization)
        raise HTTPException(
            status_code=503,
            detail="Erro ao terminar sessão"
        ) from exc


@app.patch("/auth/pin", summary="Alterar o próprio PIN")
def auth_alterar_pin(
    dados: AlterarPinRequest,
    utilizador: Utilizador = Depends(obter_utilizador_atual),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    pin_atual = _normalizar_pin(dados.pin_atual)
    novo_pin = _normalizar_pin(dados.novo_pin)
    _validar_formato_pin(pin_atual)
    _validar_formato_pin(novo_pin)
    if not _verificar_pin(pin_atual, utilizador.pin_hash):
        raise HTTPException(status_code=401, detail="PIN atual inválido")
    utilizador.pin_hash = _hash_pin(novo_pin)
    utilizador.forcar_troca_pin = False
    session.add(utilizador)
    _registar_log_bd(session, "alterar_pin", True, "PIN alterado pelo utilizador", utilizador.id, utilizador.nome, str(utilizador.role))
    _persistir_sessao(session, "Falha ao atualizar PIN")
    session.refresh(utilizador)
    _registar_log("alterar_pin", True, "PIN alterado pelo utilizador", utilizador.id)
    return {"mensagem": "PIN atualizado com sucesso"}


@app.get("/auth/logs", summary="Logs de autenticação em memória (sessão atual)")
def auth_logs(admin: Utilizador = Depends(exigir_admin)):
    _ = admin
    return list(reversed(_logs_auth))


@app.get("/admin/logs", summary="Logs de auditoria persistentes na BD (Admin)")
def listar_logs_bd(
    limite: int = 200,
    admin: Utilizador = Depends(exigir_admin),
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    """Devolve os registos de auditoria persistidos na tabela Logs.

    Porque: ao contrário do buffer em memória, estes logs sobrevivem a
    reinícios de servidor e permitem rastreabilidade histórica de acções
    de Admin e User. Limite máximo de 1000 registos por pedido.
    """
    _ = admin
    try:
        entradas = session.exec(
            select(Log).order_by(Log.criado_em.desc()).limit(min(limite, 1000))
        ).all()
        return [
            {
                "id": e.id,
                "utilizador_id": e.utilizador_id,
                "utilizador_nome": e.utilizador_nome,
                "role": e.role,
                "acao": e.acao,
                "entidade": e.entidade,
                "entidade_id": e.entidade_id,
                "detalhe": e.detalhe,
                "sucesso": e.sucesso,
                "criado_em": _iso_z(e.criado_em),
            }
            for e in entradas
        ]
    except SQLAlchemyError as exc:
        logger.exception("Falha ao listar logs de auditoria")
        raise HTTPException(status_code=503, detail="Falha ao obter logs de auditoria") from exc


@app.post("/auth/manutenacao/limpar-sessoes", summary="Limpar sessões expiradas (Admin)")
def admin_limpar_sessoes(
    admin: Utilizador = Depends(exigir_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Endpoint administrativo para remover sessões expiradas da base de dados.
    
    Porque: Permite manutenção manual da tabela de sessões em ambientes de produção
    sem necessidade de interrupção de serviço. Deve ser chamado periodicamente.
    """
    quantidade = _limpar_sessoes_expiradas(session)
    return {
        "mensagem": f"Removidas {quantidade} sessões expiradas",
        "quantidade": quantidade,
        "executado_por": admin.nome,
    }


# ─────────────────────────────────────────────
# EQUIPAMENTOS
# ─────────────────────────────────────────────

@app.get("/equipamentos", summary="Listar todos os equipamentos")
def listar_equipamentos(session: Session = Depends(get_session)):
    return session.exec(select(Equipamento)).all()

@app.get("/equipamentos/{equipamento_id}", summary="Detalhe de um equipamento")
def detalhe_equipamento(equipamento_id: int, session: Session = Depends(get_session)):
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    # Auto-checkout: se a sessão ativa ultrapassou fim_automatico, fechar e libertar.
    # Envolvido em try-except para que falhas de migração (colunas ainda não criadas)
    # nunca bloqueiem o carregamento do equipamento.
    if eq.estado_atual == EstadoEquipamento.OCUPADO.value:
        try:
            sessao_expirada = session.exec(
                select(SessaoUso).where(
                    SessaoUso.equipamento_id == equipamento_id,
                    SessaoUso.fim.is_(None),
                    SessaoUso.fim_automatico.is_not(None),
                    SessaoUso.fim_automatico <= _agora_utc(),
                )
            ).first()
            if sessao_expirada:
                logger.info(
                    "Auto-checkout: sessão %s do eq %s expirou em %s",
                    sessao_expirada.id, equipamento_id, sessao_expirada.fim_automatico,
                )
                sessao_expirada.fim = _agora_utc()
                sessao_expirada.termino_forcado = False
                sessao_expirada.valida_para_stats = _calcular_valida_para_stats(
                    sessao_expirada.inicio, sessao_expirada.fim, termino_forcado=False
                )
                eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
                session.add(sessao_expirada)
                session.add(eq)
                _persistir_sessao(session, "Falha no auto-checkout")
                session.refresh(eq)
        except Exception:
            session.rollback()
            logger.warning("Auto-checkout ignorado (possível migração de coluna pendente)")

    # Consistência: se existe sessão aberta mas o estado não é Ocupado, corrigir.
    # Isto resolve dessincronizações causadas por falhas parciais no check-in.
    if eq.estado_atual != EstadoEquipamento.OCUPADO.value:
        try:
            sessao_orfao = session.exec(
                select(SessaoUso).where(
                    SessaoUso.equipamento_id == equipamento_id,
                    SessaoUso.fim.is_(None),
                )
            ).first()
            if sessao_orfao:
                logger.info(
                    "Corrigindo estado do equipamento %s: sessão %s aberta mas estado='%s'",
                    equipamento_id, sessao_orfao.id, eq.estado_atual,
                )
                eq.estado_atual = EstadoEquipamento.OCUPADO.value
                session.add(eq)
                _persistir_sessao(session, "Falha ao corrigir estado do equipamento")
                session.refresh(eq)
        except Exception:
            session.rollback()
            logger.warning("Verificação de consistência ignorada (equipamento %s)", equipamento_id)

    # Calcular data_proxima_calibracao a partir da calibração mais recente —
    # o campo não existe na tabela de equipamentos: é derivado de Calibracao.proxima_data.
    # Devolvemos sempre este campo para que o frontend não tenha de fazer uma
    # segunda chamada só para obter a data de próxima calibração.
    calibracao_mais_recente = session.exec(
        select(Calibracao)
        .where(Calibracao.equipamento_id == equipamento_id)
        .order_by(Calibracao.data_realizada.desc())
    ).first()
    data_proxima_calibracao = (
        calibracao_mais_recente.proxima_data if calibracao_mais_recente else None
    )

    return {
        **eq.model_dump(),
        "data_proxima_calibracao": _iso_z(data_proxima_calibracao) if data_proxima_calibracao else None,
    }


@app.get("/equipamentos/exportar/pdf", summary="Exportar inventário de equipamentos para PDF formatado")
def exportar_equipamentos_pdf(
    filtro: Optional[str] = None,
    estado: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """Gera um PDF do inventário de equipamentos em formato tabular landscape.

    Aplica filtragem opcional por texto livre e por estado operacional antes
    de serializar os registos num template HTML processado pelo xhtml2pdf.
    Resolve mojibake declarando explicitamente UTF-8 no meta charset.
    """
    todos = session.exec(select(Equipamento)).all()

    filtro_norm = (filtro or "").strip().lower()
    estado_norm = (estado or "").strip()

    if filtro_norm:
        todos = [
            eq for eq in todos
            if filtro_norm in (eq.nome or "").lower()
            or filtro_norm in (eq.tipo or "").lower()
            or filtro_norm in (eq.localizacao or "").lower()
            or filtro_norm in (eq.codigo or "").lower()
        ]

    if estado_norm:
        todos = [eq for eq in todos if eq.estado_atual == estado_norm]

    ordenados = sorted(todos, key=lambda e: (e.nome or "").lower())

    # Mapeamento de estado → (cor de fundo do badge, cor do texto)
    _CORES_ESTADO: dict[str, tuple[str, str]] = {
        "Disponível":    ("#dcfce7", "#166534"),
        "Ocupado":       ("#dbeafe", "#1e40af"),
        "Avariado":      ("#fee2e2", "#991b1b"),
        "Em manutenção": ("#fef9c3", "#854d0e"),
        "Em calibração": ("#ede9fe", "#5b21b6"),
    }

    def _badge(estado_val: str) -> str:
        bg, fg = _CORES_ESTADO.get(estado_val, ("#f1f5f9", "#334155"))
        return (
            f'<span style="background:{bg};color:{fg};padding:2px 8px;'
            f'border-radius:4px;font-size:9pt;font-weight:600;white-space:nowrap;">'
            f'{estado_val}</span>'
        )

    linhas_tabela = []
    for idx, eq in enumerate(ordenados):
        bg_linha = "#f8fafc" if idx % 2 == 0 else "#ffffff"
        data_str = eq.criado_em.strftime("%d/%m/%Y") if eq.criado_em else "—"
        linhas_tabela.append(f"""
        <tr style="background:{bg_linha};">
            <td class="mono">EQ-{str(eq.id).zfill(3)}</td>
            <td><strong>{eq.nome or "—"}</strong></td>
            <td class="mono">{eq.codigo or "—"}</td>
            <td>{eq.tipo or "—"}</td>
            <td>{eq.localizacao or "—"}</td>
            <td style="text-align:center;">{_badge(eq.estado_atual)}</td>
            <td style="text-align:center;color:#64748b;">{data_str}</td>
        </tr>""")

    filtro_desc = ""
    if filtro_norm:
        filtro_desc += f'&nbsp;·&nbsp;Filtro: <em>"{filtro or ""}"</em>'
    if estado_norm:
        filtro_desc += f'&nbsp;·&nbsp;Estado: <em>"{estado or ""}"</em>'

    timestamp_formatado = _agora_utc().strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro  = _agora_utc().strftime("%Y%m%d-%H%M%S")

    html = f"""<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8" />
    <style>
        @page {{
            size: A4 landscape;
            margin: 15mm 12mm 18mm 12mm;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: Helvetica, Arial, sans-serif;
            font-size: 10pt;
            color: #1e293b;
            line-height: 1.4;
        }}
        .header {{
            border-bottom: 3px solid #dc2626;
            padding-bottom: 8px;
            margin-bottom: 14px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }}
        .logo-img {{ height: 36px; display: block; }}
        .logo-fallback {{ font-size: 20pt; font-weight: 900; color: #dc2626; letter-spacing: -1px; }}
        .doc-meta {{ font-size: 8pt; color: #64748b; text-align: right; line-height: 1.6; }}
        .doc-title {{ font-size: 14pt; font-weight: 700; margin-bottom: 2px; }}
        .resumo {{
            font-size: 9pt;
            color: #475569;
            margin-bottom: 12px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 9pt;
        }}
        thead tr {{
            background: #1e293b;
            color: #f8fafc;
        }}
        thead th {{
            padding: 7px 9px;
            text-align: left;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-size: 8pt;
            white-space: nowrap;
        }}
        tbody td {{
            padding: 6px 9px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
        }}
        .mono {{ font-family: "Courier New", Courier, monospace; font-size: 8.5pt; }}
        .footer-note {{
            margin-top: 14px;
            font-size: 7.5pt;
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
            {_LOGO_HTML}
            <div class="doc-title">Inventário de Equipamentos</div>
        </div>
        <div class="doc-meta">
            Gerado em: {timestamp_formatado} (UTC)<br/>
            Total de registos: <strong>{len(ordenados)}</strong>{filtro_desc}
        </div>
    </div>

    <div class="resumo">
        Documento de circulação interna — gerado automaticamente pelo sistema de gestão laboratorial Industrial Testing Lab.
    </div>

    <table>
        <thead>
            <tr>
                <th>ID</th>
                <th>Nome do Equipamento</th>
                <th>Código</th>
                <th>Tipo</th>
                <th>Localização</th>
                <th style="text-align:center;">Estado</th>
                <th style="text-align:center;">Registo</th>
            </tr>
        </thead>
        <tbody>
            {''.join(linhas_tabela) if linhas_tabela else
             '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">Nenhum equipamento encontrado para os filtros aplicados.</td></tr>'}
        </tbody>
    </table>

    <div class="footer-note">
        Industrial Testing Lab — Documento de Circulação Interna — Confidencial
    </div>
</body>
</html>"""

    try:
        pdf_bytes = _gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF do inventário de equipamentos: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inventario-equipamentos-{timestamp_ficheiro}.pdf"'},
    )


@app.get("/equipamentos/{equipamento_id}/exportar-pdf", summary="Relatório metrológico individual em PDF")
def exportar_relatorio_pdf_individual(
    equipamento_id: int,
    session: Session = Depends(get_session),
):
    if equipamento_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O identificador do equipamento fornecido é inválido.",
        )

    equipamento = session.get(Equipamento, equipamento_id)
    if not equipamento:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"O ativo com o ID {equipamento_id} não existe no ecossistema.",
        )

    stmt = (
        select(Calibracao)
        .where(Calibracao.equipamento_id == equipamento_id)
        .order_by(Calibracao.data_realizada.desc())
    )
    calibracao_mais_recente = session.exec(stmt).first()
    data_proxima = (
        calibracao_mais_recente.proxima_data.strftime("%d/%m/%Y")
        if calibracao_mais_recente and calibracao_mais_recente.proxima_data
        else "Não definida"
    )

    html_content = f"""
    <html>
    <head>
        <style>
            @page {{ size: A4; margin: 20mm; }}
            body {{ font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; line-height: 1.5; }}
            .header {{ border-bottom: 2px solid #dc2626; padding-bottom: 10px; margin-bottom: 20px; }}
            .logo-placeholder {{ font-size: 24pt; font-weight: bold; color: #dc2626; letter-spacing: -1px; }}
            .subtitle {{ font-size: 10pt; color: #64748b; text-transform: uppercase; }}
            .title {{ font-size: 18pt; font-weight: bold; margin-top: 5px; }}
            .meta-grid {{ display: table; width: 100%; margin-bottom: 30px; border-collapse: collapse; }}
            .meta-row {{ display: table-row; }}
            .meta-cell {{ display: table-cell; padding: 8px; border: 1px solid #e2e8f0; font-size: 10pt; }}
            .meta-label {{ font-weight: bold; background-color: #f8fafc; width: 30%; }}
            .section-title {{ font-size: 12pt; font-weight: bold; color: #0f172a; margin-bottom: 10px; text-transform: uppercase; }}
            .footer-note {{ font-size: 8pt; color: #94a3b8; margin-top: 50px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }}
        </style>
    </head>
    <body>
        <div class="header">
            <div class="logo-placeholder">INDUSTRIAL TESTING LAB</div>
            <div class="subtitle">Testing Centre — Relatório Operacional do Ativo</div>
            <div class="title">{equipamento.nome}</div>
        </div>

        <div class="section-title">Especificações do Equipamento</div>
        <div class="meta-grid">
            <div class="meta-row">
                <div class="meta-cell meta-label">Código Interno</div>
                <div class="meta-cell">{equipamento.codigo or "—"}</div>
            </div>
            <div class="meta-row">
                <div class="meta-cell meta-label">Tipo de Ativo</div>
                <div class="meta-cell">{equipamento.tipo}</div>
            </div>
            <div class="meta-row">
                <div class="meta-cell meta-label">Localização Física</div>
                <div class="meta-cell">{equipamento.localizacao}</div>
            </div>
            <div class="meta-row">
                <div class="meta-cell meta-label">Próxima Calibração</div>
                <div class="meta-cell" style="color: #b45309; font-weight: bold;">{data_proxima}</div>
            </div>
        </div>

        <div class="section-title">Estado e Disponibilidade Metrológica</div>
        <p style="font-size: 10pt;">Documento gerado automaticamente pelo servidor em <strong>{dt.datetime.now().strftime('%d/%m/%Y às %H:%M')}</strong>. Os dados acima refletem fielmente o estado atualizado do ativo persistido na base de dados central, estando em conformidade com as diretivas de rastreabilidade do laboratório.</p>

        <div class="footer-note">
            Industrial Testing Lab — Documento de Circulação Interna — Confidencial
        </div>
    </body>
    </html>
    """

    try:
        buffer = io.BytesIO()
        result = pisa.CreatePDF(html_content, dest=buffer)
        if result.err:
            raise RuntimeError(f"xhtml2pdf errors: {result.err}")
        pdf_bytes = buffer.getvalue()
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao processar a compilação do relatório PDF: {str(err)}",
        )

    nome_ficheiro = f"Relatorio_{equipamento.codigo or equipamento_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={nome_ficheiro}"},
    )


@app.post("/equipamentos", summary="Criar novo equipamento")
def criar_equipamento(
    dados: EquipamentoCreate,
    session: Session = Depends(get_session),
) -> Equipamento:
    # NOTE: Temporariamente não exigimos autorização de administrador
    # para facilitar testes de persistência no MSSQL. Remover este
    # comentário e restaurar `Depends(exigir_admin)` em produção.
    equipamento = Equipamento(**dados.model_dump())
    # LOG DE DIAGNÓSTICO — confirma recepção dos limites térmicos antes da persistência.
    # Remover após validação em ambiente de desenvolvimento.
    logger.debug(
        "[criar_equipamento] temp_min=%s  temp_max=%s  humidade_max=%s",
        equipamento.temp_min, equipamento.temp_max, equipamento.humidade_max,
    )
    try:
        session.add(equipamento)
        _persistir_sessao(session, "Falha ao criar equipamento")
        session.refresh(equipamento)
        return equipamento
    except IntegrityError as e:
        session.rollback()
        if "equipamento.codigo" in str(e.orig) or "UNIQUE constraint failed: equipamento.codigo" in str(e.orig):
            raise HTTPException(status_code=400, detail="Código do equipamento em falta ou já existente")
        raise HTTPException(status_code=400, detail="Dados inválidos para criar equipamento")

@app.patch("/equipamentos/{equipamento_id}", summary="Atualizar ficha técnica do equipamento")
def atualizar_equipamento(
    equipamento_id: int,
    dados: EquipamentoUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Equipamento:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    # Atualiza apenas os campos fornecidos (partial update). Se for pedido
    # a alteração de estado para 'Avariado', marca no objecto uma descrição
    # temporária (`_avaria_descricao`) que será usada pelo evento ORM
    # (see models.py) para criar o registo de avaria dentro da mesma transacção.
    changes = dados.model_dump(exclude_unset=True)

    # Tratar alteração de estado de forma explícita para validar e normalizar
    if 'estado_atual' in changes:
        novo_estado = normalizar_estado_equipamento(changes.pop('estado_atual'))
        if novo_estado not in {estado.value for estado in EstadoEquipamento}:
            raise HTTPException(status_code=400, detail="Estado do equipamento inválido")

        estado_anterior = normalizar_estado_equipamento(eq.estado_atual)
        # Impede libertar manualmente um equipamento com avaria aberta
        if novo_estado == EstadoEquipamento.DISPONIVEL.value:
            avaria_bloqueante = session.exec(
                select(Avaria).where(Avaria.equipamento_id == equipamento_id, Avaria.resolvida == False)
            ).first()
            if avaria_bloqueante:
                raise HTTPException(
                    status_code=409,
                    detail="Não é possível marcar o equipamento como Disponível enquanto existir uma avaria aberta. Resolva a avaria primeiro."
                )
        # Se transitar para 'Avariado' e não estava já avariado, prepara descrição
        if novo_estado == EstadoEquipamento.AVARIADO.value and estado_anterior != EstadoEquipamento.AVARIADO.value:
            descricao = changes.pop('descricao_avaria', None) or "Avaria detetada via alteração de estado"
            setattr(eq, '_avaria_descricao', descricao)

        eq.estado_atual = novo_estado

    # Aplica restantes campos (logística / ficha técnica)
    for campo, valor in changes.items():
        setattr(eq, campo, valor)

    session.add(eq)
    _persistir_sessao(session, "Falha ao atualizar equipamento")
    session.refresh(eq)
    return eq

@app.patch("/equipamentos/{equipamento_id}/estado", summary="Atualizar estado do equipamento")
def atualizar_estado(
    equipamento_id: int,
    dados: EstadoUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Equipamento:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    novo_estado = normalizar_estado_equipamento(dados.novo_estado)
    if novo_estado not in {estado.value for estado in EstadoEquipamento}:
        raise HTTPException(status_code=400, detail="Estado do equipamento inválido")
    # Impede libertar manualmente um equipamento com avaria aberta
    if novo_estado == EstadoEquipamento.DISPONIVEL.value:
        avaria_bloqueante = session.exec(
            select(Avaria).where(Avaria.equipamento_id == equipamento_id, Avaria.resolvida == False)
        ).first()
        if avaria_bloqueante:
            raise HTTPException(
                status_code=409,
                detail="Não é possível marcar o equipamento como Disponível enquanto existir uma avaria aberta. Resolva a avaria primeiro."
            )
    # Ao libertar manualmente o equipamento, encerra qualquer sessão ativa.
    if novo_estado == EstadoEquipamento.DISPONIVEL.value:
        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if sessao_aberta:
            sessao_aberta.fim = _agora_utc()
            session.add(sessao_aberta)
    eq.estado_atual = novo_estado
    session.add(eq)
    _persistir_sessao(session, "Falha ao atualizar estado do equipamento")
    session.refresh(eq)
    return eq

@app.delete("/equipamentos/{equipamento_id}", summary="Eliminar equipamento")
def eliminar_equipamento(
    equipamento_id: int,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    session.delete(eq)
    _persistir_sessao(session, "Falha ao eliminar equipamento")
    return {"mensagem": "Equipamento eliminado com sucesso"}


@app.post("/admin/reparar-avarias-faltantes", summary="Criar avarias em falta para equipamentos marcados como Avariado")
def reparar_avarias_faltantes(session: Session = Depends(get_session), admin: Utilizador = Depends(exigir_admin)) -> dict[str, object]:
    """Varre os equipamentos marcados como 'Avariado' e cria avarias abertas quando em falta.

    Porque: durante migrações ou operações manuais, é possível que o estado
    do equipamento tenha sido atualizado sem criar o registo de avaria.
    Este endpoint é intencionalmente administrativo e idempotente — não cria
    avarias quando já existe uma aberta para o mesmo equipamento.
    """

    _ = admin
    criado = []
    ignorados = []
    try:
        equipamentos_avariados = session.exec(
            select(Equipamento).where(Equipamento.estado_atual == EstadoEquipamento.AVARIADO.value)
        ).all()

        for eq in equipamentos_avariados:
            # Verificar se já existe avaria aberta
            existente = session.exec(
                select(Avaria).where(Avaria.equipamento_id == eq.id, Avaria.resolvida == False)
            ).first()
            if existente:
                ignorados.append(eq.id)
                continue

            av = Avaria(
                equipamento_id=eq.id,
                descricao="Avaria criada em reparação de dados (varredura)",
                resolvida=False,
            )
            session.add(av)
            criado.append(eq.id)

        if criado:
            session.commit()
        return {"criado": criado, "ignorados": ignorados, "total_avariado": len(equipamentos_avariados)}

    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Falha ao reparar avarias faltantes")
        raise HTTPException(status_code=503, detail="Falha ao reparar avarias faltantes") from exc

# ─────────────────────────────────────────────
# CHECK-IN / CHECK-OUT (Sessões de Uso Real)
# ─────────────────────────────────────────────

@app.post("/equipamentos/{equipamento_id}/checkin", summary="Iniciar utilização real")
def fazer_checkin(
    equipamento_id: int,
    dados: CheckinCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Regista o início da utilização real com sincronização de estado.
    
    Porquê: O timestamp de início é essencial para calcular a eficiência OEE.
    Valida que o equipamento está disponível antes de abrir a sessão.
    
    Restrição: Um utilizador não pode ter mais de um check-in ativo.
    Se deseja alterar a duração, use PATCH /equipamentos/{id}/sessao-uso/{sessao_id}/duracao
    
    Lógica de Sincronização:
    1. Se há uma sessão órfã (equipamento "Disponível" mas SessaoUso.fim = None de outro utilizador),
       fecha-a automaticamente antes de iniciar a nova.
    2. Se há uma sessão ativa do próprio utilizador atual, bloqueia (retorna 409 Conflict)
       indicando que deve editar em vez de criar novo.
    3. Se há uma sessão ativa de outro utilizador, bloqueia com mensagem clara (retorna 409).
    4. Garante atomicidade: estado só muda para OCUPADO se SessaoUso for criada com sucesso.
    
    Se duracao_prevista_minutos for fornecida e houver uma reserva, calcula
    o fim automático e atualiza a reserva.
    """
    _garantir_colunas_sessaouso()
    try:
        eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")

        # ─── Validação de estado ───
        estados_bloqueantes = [
            EstadoEquipamento.AVARIADO.value,
            EstadoEquipamento.MANUTENCAO.value,
            EstadoEquipamento.CALIBRACAO.value,
        ]
        estado_atual = normalizar_estado_equipamento(eq.estado_atual)
        if estado_atual in estados_bloqueantes:
            raise HTTPException(
                status_code=400,
                detail=f"Operação negada. Equipamento em estado: {estado_atual}."
            )

        # ─── Sincronização: Detectar e fechar sessões órfãs ───
        # Se o equipamento está "Disponível" mas existe SessaoUso.fim = None,
        # é uma sessão órfã que nunca foi fechada. Fechar automaticamente.
        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        
        if sessao_aberta:
            if estado_atual == EstadoEquipamento.DISPONIVEL.value and sessao_aberta.utilizador_id != utilizador_atual.id:
                # Sessão órfã de outro utilizador: fechar automaticamente
                logger.warning(
                    f"Sessão órfã detectada para eq {equipamento_id} de {sessao_aberta.utilizador}. "
                    f"Fechando automaticamente ao iniciar nova sessão."
                )
                sessao_aberta.fim = _agora_utc()
                session.add(sessao_aberta)
                session.flush()  # Garante a mudança antes de continuar
            elif sessao_aberta.utilizador_id == utilizador_atual.id:
                # Mesmo utilizador já tem um check-in ativo: bloquear
                raise HTTPException(
                    status_code=409,
                    detail=f"Já tem um check-in ativo iniciado às {_iso_z(sessao_aberta.inicio)}. "
                           f"Para alterar a duração, use a opção 'Editar Duração'."
                )
            else:
                # Outro utilizador está usando: bloquear com detalhes
                outro_utilizador = sessao_aberta.utilizador or "Utilizador desconhecido"
                raise HTTPException(
                    status_code=409,
                    detail=f"Equipamento em uso por '{outro_utilizador}' desde {_iso_z(sessao_aberta.inicio)}. "
                           f"Não é possível iniciar novo ensaio."
                )

        # ─── Criar nova sessão (transação atómica) ───
        agora = _agora_utc()
        fim_auto = (agora + timedelta(minutes=dados.duracao_prevista_minutos)) if dados.duracao_prevista_minutos else None
        nova_sessao = SessaoUso(
            equipamento_id=equipamento_id,
            utilizador_id=utilizador_atual.id,
            utilizador=utilizador_atual.nome,
            reserva_id=dados.reserva_id,
            inicio=agora,
            duracao_prevista_minutos=dados.duracao_prevista_minutos,
            fim_automatico=fim_auto,
            projeto=dados.projeto,
            metodo=dados.metodo,
        )
        eq.estado_atual = EstadoEquipamento.OCUPADO.value
        session.add(nova_sessao)
        session.add(eq)

        # Sincronizar a reserva se existir
        if dados.duracao_prevista_minutos and dados.reserva_id:
            reserva = session.get(Reserva, dados.reserva_id)
            if reserva:
                reserva.duracao_prevista_minutos = dados.duracao_prevista_minutos
                reserva.fim_automatico = fim_auto
                session.add(reserva)
        
        _persistir_sessao(session, "Falha ao registar check-in")
        session.refresh(nova_sessao)

        # Registo de auditoria: check-in é uma acção operacional crítica para OEE
        _registar_log_bd(
            session,
            acao="checkin",
            sucesso=True,
            detalhe=f"Check-in iniciado no equipamento '{eq.nome}' (ID={equipamento_id}). "
                    f"Projeto: {dados.projeto or '—'} | Método: {dados.metodo or '—'} | "
                    f"Duração estimada: {dados.duracao_prevista_minutos or '?'} min.",
            utilizador_id=utilizador_atual.id,
            utilizador_nome=utilizador_atual.nome,
            role=utilizador_atual.role,
            entidade="SessaoUso",
            entidade_id=nova_sessao.id,
        )

        return {"mensagem": "Check-in realizado com sucesso.", "sessao": nova_sessao}

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados no check-in")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.patch("/atualizar-duracao/{equipamento_id}", summary="Atualizar duração estimada do ensaio em curso")
@app.patch("/equipamentos/{equipamento_id}/sessao-ativa/duracao", summary="Editar duração de sessão em progresso")
def editar_duracao_sessao(
    equipamento_id: int,
    dados: AtualizarDuracaoCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Atualiza a duração prevista de uma sessão em progresso.
    
    Porquê: Permite ao operador ajustar o tempo estimado do ensaio se necessário.
    
    Restrição: Apenas o utilizador com a sessão ativa pode editar.

    Regra de negócio: o `fim_automatico` é recalculado com base na
    `data_inicio` original da reserva ativa, não no instante atual.
    """
    try:
        if dados.duracao_prevista_minutos <= 0:
            raise HTTPException(status_code=400, detail="A duração prevista deve ser superior a 0 minutos.")

        # Procurar sessão ativa do utilizador atual
        sessao = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.utilizador_id == utilizador_atual.id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        
        if not sessao:
            raise HTTPException(
                status_code=404,
                detail="Nenhuma sessão ativa para este utilizador neste equipamento."
            )

        novo_fim = sessao.inicio + timedelta(minutes=dados.duracao_prevista_minutos)
        sessao.duracao_prevista_minutos = dados.duracao_prevista_minutos
        sessao.fim_automatico = novo_fim
        session.add(sessao)

        # Sincronizar também a reserva se existir
        reserva = None
        if sessao.reserva_id:
            reserva = session.get(Reserva, sessao.reserva_id)
            if reserva:
                reserva.duracao_prevista_minutos = dados.duracao_prevista_minutos
                reserva.fim_automatico = reserva.data_inicio + timedelta(minutes=dados.duracao_prevista_minutos)
                session.add(reserva)

        logger.info(
            "Duração atualizada para sessão %s: %s min, fim_automatico=%s",
            sessao.id,
            dados.duracao_prevista_minutos,
            _iso_z(novo_fim),
        )

        _persistir_sessao(session, "Falha ao atualizar duração da sessão")
        session.refresh(sessao)

        return {
            "mensagem": f"Duração atualizada para {dados.duracao_prevista_minutos} minutos.",
            "sessao": sessao,
            "reserva": {
                "id": reserva.id,
                "data_inicio": reserva.data_inicio,
                "duracao_prevista_minutos": reserva.duracao_prevista_minutos,
                "fim_automatico": reserva.fim_automatico,
            } if reserva else None,
        }
    
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados ao atualizar duração")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.patch("/equipamentos/{equipamento_id}/checkout", summary="Terminar utilização real")
def fazer_checkout(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Regista o fim da utilização e liberta a máquina.
    Porquê: Fecha o ciclo de tempo real para posterior cálculo de eficiência OEE.
    """
    try:
        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if not sessao_aberta:
            raise HTTPException(status_code=404, detail="Não existe sessão ativa para este equipamento.")

        if (
            sessao_aberta.utilizador_id
            and sessao_aberta.utilizador_id != utilizador_atual.id
            and utilizador_atual.role != RoleUtilizador.ADMIN
        ):
            raise HTTPException(status_code=403, detail="Apenas o operador da sessão (ou admin) pode fazer checkout")

        sessao_aberta.fim = _agora_utc()
        sessao_aberta.termino_forcado = False
        sessao_aberta.valida_para_stats = _calcular_valida_para_stats(
            sessao_aberta.inicio, sessao_aberta.fim, termino_forcado=False
        )
        eq = session.get(Equipamento, equipamento_id)
        if eq:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
            session.add(eq)

        session.add(sessao_aberta)
        _persistir_sessao(session, "Falha ao registar check-out")
        session.refresh(sessao_aberta)
        return {"mensagem": "Check-out realizado. Equipamento libertado.", "sessao": sessao_aberta}

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados no check-out")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.patch("/equipamentos/{equipamento_id}/checkout-com-status", summary="Terminar utilização com status de sucesso/falha")
def fazer_checkout_com_status(
    equipamento_id: int,
    dados: CheckoutCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Regista o fim da utilização e marca o status de sucesso/falha para OEE.
    
    Porquê: Permite ao sistema calcular a taxa de sucesso dos ensaios,
    essencial para o cálculo do OEE (Overall Equipment Effectiveness).
    
    Args:
        equipamento_id: ID do equipamento.
        dados: CheckoutCreate com concluido_com_sucesso (True/False).
    
    Returns:
        dict com mensagem de sucesso e dados da sessão.
    """
    
    try:
        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if not sessao_aberta:
            raise HTTPException(status_code=404, detail="Não existe sessão ativa para este equipamento.")

        if (
            sessao_aberta.utilizador_id
            and sessao_aberta.utilizador_id != utilizador_atual.id
            and utilizador_atual.role != RoleUtilizador.ADMIN
        ):
            raise HTTPException(status_code=403, detail="Apenas o operador da sessão (ou admin) pode fazer checkout")

        sessao_aberta.fim = _agora_utc()
        sessao_aberta.termino_forcado = False
        sessao_aberta.valida_para_stats = _calcular_valida_para_stats(
            sessao_aberta.inicio, sessao_aberta.fim, termino_forcado=False
        )

        # Marcar o status de sucesso/falha na reserva associada
        if sessao_aberta.reserva_id:
            reserva = session.get(Reserva, sessao_aberta.reserva_id)
            if reserva:
                reserva.concluido_com_sucesso = dados.concluido_com_sucesso
                session.add(reserva)
        
        eq = session.get(Equipamento, equipamento_id)
        if eq:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
            session.add(eq)

        session.add(sessao_aberta)
        _persistir_sessao(session, "Falha ao registar check-out com status")
        session.refresh(sessao_aberta)
        return {
            "mensagem": f"Check-out realizado. Ensaio marcado como {'concluído com sucesso' if dados.concluido_com_sucesso else 'falhou'}.",
            "sessao": sessao_aberta,
            "concluido_com_sucesso": dados.concluido_com_sucesso,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados no check-out com status")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.patch("/equipamentos/{equipamento_id}/checkout-forcado", summary="Forçar término da sessão ativa")
def checkout_forcado(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Força o término da sessão ativa e penaliza a qualidade no OEE.

    Regras:
    - Fecha a sessão ativa (`SessaoUso.fim`).
    - Se existir reserva associada, marca `concluido_com_sucesso=False`.
    - Atualiza o estado do equipamento para `Disponível`.

    Porque: garante consistência operacional quando um ensaio fica preso e
    precisa de ser encerrado manualmente sem sucesso.
    """
    try:
        eq = session.get(Equipamento, equipamento_id)
        if not eq:
            raise HTTPException(status_code=404, detail="Equipamento não encontrado.")

        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()

        if sessao_aberta:
            # Só o operador da sessão ou um admin pode forçar o término.
            if (
                sessao_aberta.utilizador_id
                and sessao_aberta.utilizador_id != utilizador_atual.id
                and utilizador_atual.role != RoleUtilizador.ADMIN
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Apenas o operador da sessão (ou admin) pode forçar término.",
                )

            sessao_aberta.fim = _agora_utc()
            sessao_aberta.termino_forcado = True
            sessao_aberta.valida_para_stats = False
            session.add(sessao_aberta)

            # Penaliza qualidade no OEE quando o término é forçado.
            if sessao_aberta.reserva_id:
                reserva = session.get(Reserva, sessao_aberta.reserva_id)
                if reserva:
                    reserva.concluido_com_sucesso = False
                    session.add(reserva)

        # Resetar o hardware independentemente de existir sessão ativa.
        eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
        session.add(eq)

        _persistir_sessao(session, "Falha ao forçar término da sessão")
        return {
            "status": "sucesso",
            "mensagem": "Equipamento libertado com sucesso.",
            "sessao_fechada": sessao_aberta is not None,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados no término forçado")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.get("/equipamentos/{equipamento_id}/sessao-ativa", summary="Obter sessão ativa do utilizador atual")
def obter_sessao_ativa(
    equipamento_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Retorna a sessão em progresso do utilizador atual para um equipamento.

    Inclui dados resumidos da reserva associada (quando existir) para a UI
    conseguir mostrar o tempo previsto e permitir ajuste de duração.
    """
    _garantir_colunas_sessaouso()
    try:
        sessao = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.utilizador_id == utilizador_atual.id,
                SessaoUso.fim.is_(None),
            )
        ).first()

        if not sessao:
            return {}

        # Construir resumo de temporização a partir da sessão (fonte primária)
        # e completar com dados de reserva se existir.
        reserva_resumo: dict[str, Any] = {
            "duracao_prevista_minutos": sessao.duracao_prevista_minutos,
            "fim_automatico": sessao.fim_automatico,
        }
        if sessao.reserva_id:
            reserva = session.get(Reserva, sessao.reserva_id)
            if reserva:
                reserva_resumo["id"] = reserva.id
                reserva_resumo["data_inicio"] = reserva.data_inicio
                # Preferir dados da sessão; cair na reserva como fallback.
                if not reserva_resumo["duracao_prevista_minutos"]:
                    reserva_resumo["duracao_prevista_minutos"] = reserva.duracao_prevista_minutos
                if not reserva_resumo["fim_automatico"]:
                    reserva_resumo["fim_automatico"] = reserva.fim_automatico

        return {"sessao": sessao, "reserva": reserva_resumo if reserva_resumo.get("fim_automatico") else None}

    except SQLAlchemyError as exc:
        logger.exception("Erro ao obter sessão ativa")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.get("/equipamentos/{equipamento_id}/sessao-em-curso", summary="Sessão atualmente em curso (pública)")
def obter_sessao_em_curso(equipamento_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Devolve a sessão de uso em curso para o equipamento, independentemente do utilizador.
    Não requer autenticação — usado para mostrar 'Em curso desde' na UI pública."""
    try:
        sessao = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if not sessao:
            return {}
        return {
            "inicio": _iso_z(sessao.inicio) if sessao.inicio else None,
            "utilizador": sessao.utilizador,
            "duracao_prevista_minutos": sessao.duracao_prevista_minutos,
            "fim_automatico": _iso_z(sessao.fim_automatico) if sessao.fim_automatico else None,
        }
    except SQLAlchemyError as exc:
        logger.exception("Erro ao obter sessão em curso")
        raise HTTPException(status_code=503, detail="Falha de ligação à base de dados") from exc


@app.get("/equipamentos/{equipamento_id}/sessoes", summary="Histórico de sessões de um equipamento")
def listar_sessoes(equipamento_id: int, session: Session = Depends(get_session)):
    return session.exec(
        select(SessaoUso)
        .where(SessaoUso.equipamento_id == equipamento_id)
        .order_by(SessaoUso.inicio.desc())
    ).all()


@app.get("/equipamentos/{equipamento_id}/eficiencia", summary="Calcular OEE do equipamento")
def calcular_eficiencia(
    equipamento_id: int,
    dias: int = 30,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Calcula a eficiência OEE comparando tempo reservado vs tempo real de uso.
    Fórmula: Eficiência = Σ(tempo_real) / Σ(tempo_reservado) × 100%
    Porquê: Esta métrica é o principal argumento para justificar novos investimentos.
    """
    _ = utilizador_atual
    dias = _validar_dias(dias)
    limite = _agora_utc() - timedelta(days=dias)

    reservas = session.exec(
        select(Reserva).where(
            Reserva.equipamento_id == equipamento_id,
            Reserva.data_inicio >= limite
        )
    ).all()

    sessoes = session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id == equipamento_id,
            SessaoUso.inicio >= limite,
            SessaoUso.fim.is_not(None),  # Só sessões fechadas
        )
    ).all()

    metricas = _calcular_metricas_uso(reservas, sessoes)

    return {
        "equipamento_id": equipamento_id,
        "periodo_dias": dias,
        "total_reservas": len(reservas),
        "total_sessoes": len(sessoes),
        **metricas,
    }

# ─────────────────────────────────────────────
# AVARIAS
# ─────────────────────────────────────────────

@app.get("/equipamentos/{equipamento_id}/avarias")
def listar_avarias(equipamento_id: int, session: Session = Depends(get_session)):
    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(select(Avaria).where(Avaria.equipamento_id == equipamento_id)).all()

@app.post("/equipamentos/{equipamento_id}/avaria")
def registar_avaria(
    equipamento_id: int,
    dados: AvariaCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    """Registar uma avaria e transitar o estado do equipamento por severidade.

    A transição de estado é gerida pelo evento ORM `marcar_estado_equipamento_por_severidade`
    definido em models.py, que é invocado automaticamente após o INSERT da avaria:
      - severidade BLOQUEANTE → equipamento passa para 'Avariado'  (check-in bloqueado)
    - severidade ALERTA     → equipamento passa para 'Limitado' (check-in permitido)

    Porquê não alterar eq.estado_atual aqui diretamente: se o fizéssemos, o valor
    fixo sobrescreveria o estado calculado pelo evento ORM, anulando a distinção
    de severidade que é o núcleo do requisito de Modo Limitado.
    """
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")

    # Sinalizar ao evento `criar_avaria_se_transitou_para_avariado` (models.py) que
    # esta avaria foi criada explicitamente pelo endpoint — evita duplicado ORM.
    setattr(eq, "_avaria_manual_registada", True)

    # Criar o registo de avaria com o campo severidade mapeado explicitamente.
    # Crítico: o evento after_insert lê target.severidade para decidir o estado
    # de destino do equipamento — se não for passado aqui, ficaria no default
    # do modelo (BLOQUEANTE) independentemente do que o utilizador enviou.
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

    _persistir_sessao(session, "Falha ao registar avaria")
    session.refresh(avaria)
    # Refresh ao equipamento para devolver o estado atualizado pelo evento ORM
    session.refresh(eq)
    return {"mensagem": "Avaria registada com sucesso", "estado_atual": eq.estado_atual, "avaria": avaria}

def _resolver_avaria_logica(avaria_id: int, dados: AvariaResolve, session: Session) -> dict[str, Any]:
    """Marca uma avaria como resolvida e recalcula o estado do equipamento.

    Implementa a regra de resolução defensiva com três níveis de prioridade:
      1. Se ainda existir pelo menos uma avaria BLOQUEANTE aberta → 'Avariado'
    2. Se não houver bloqueantes mas houver avarias de ALERTA abertas → 'Limitado'
      3. Se não existir nenhuma avaria ativa → 'Disponível'

    Porquê esta hierarquia: a resolução de uma avaria nunca deve promover o
    equipamento para um estado mais saudável do que o garantido pelas avarias
    restantes. Sem esta lógica, resolver uma avaria ALERTA com uma BLOQUEANTE
    ainda aberta colocaria o equipamento erroneamente como 'Disponível',
    permitindo check-ins e distorcendo a métrica de Disponibilidade do OEE.

    A lógica corre dentro de uma transação gerida por `_persistir_sessao`,
    que executa commit em caso de sucesso e rollback em caso de SQLAlchemyError.
    """
    avaria = session.get(Avaria, avaria_id)
    if not avaria:
        raise HTTPException(status_code=404, detail="Avaria não encontrada")
    if avaria.resolvida:
        raise HTTPException(status_code=400, detail="Avaria já estava resolvida")

    avaria.resolvida = True
    avaria.data_resolucao = _agora_utc()
    if dados.relatorio_tecnico:
        avaria.notas_resolucao = dados.relatorio_tecnico
    if dados.custo is not None:
        avaria.custo_reparacao = dados.custo

    # ── Regra de resolução defensiva (3 níveis de prioridade) ────────────────
    # Consultar avarias restantes por severidade, excluindo a que está a ser
    # resolvida agora (id != avaria_id). A consulta corre antes do commit para
    # que o estado da avaria atual (resolvida=True) ainda não esteja persistido,
    # garantindo que não se conta a si própria como "ainda aberta".

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
        # Só transitar se o equipamento estiver num estado de falha.
        # Porquê: evita sobrescrever estados como 'Ocupado' ou 'Em manutenção',
        # que têm precedência operacional própria e não foram causados por avarias.
        estados_de_falha = {
            EstadoEquipamento.AVARIADO.value,
            EstadoEquipamento.DEGRADADO.value,
        }
        if estado_atual_norm in estados_de_falha:
            if outras_bloqueantes:
                # Nível 1: ainda há falhas graves — equipamento permanece bloqueado
                novo_estado = EstadoEquipamento.AVARIADO.value
            elif outras_alerta:
                # Nível 2: sem bloqueantes mas com alertas — modo limitado activo
                novo_estado = EstadoEquipamento.DEGRADADO.value
            else:
                # Nível 3: todas as avarias resolvidas — equipamento recuperado
                novo_estado = EstadoEquipamento.DISPONIVEL.value
            eq.estado_atual = novo_estado
            session.add(eq)

    session.add(avaria)
    _persistir_sessao(session, "Falha ao resolver avaria")
    session.refresh(avaria)
    return {"mensagem": "Avaria resolvida com sucesso", "avaria": avaria}

@app.patch("/avarias/{avaria_id}/resolver")
def resolver_avaria(
    avaria_id: int,
    dados: AvariaResolve,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    return _resolver_avaria_logica(avaria_id, dados, session)

@app.put("/avarias/{avaria_id}/resolver")
def resolver_avaria_put(
    avaria_id: int,
    dados: AvariaResolve,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    return _resolver_avaria_logica(avaria_id, dados, session)

@app.get("/avarias")
def listar_todas_avarias(resolvida: Optional[bool] = None, session: Session = Depends(get_session)):
    query = select(Avaria)
    if resolvida is not None:
        query = query.where(Avaria.resolvida == resolvida)
    return session.exec(query.order_by(Avaria.data_registo.desc())).all()


@app.get("/avarias/exportar/pdf", summary="Exportar avarias para PDF")
def exportar_avarias_pdf(
    resolvida: Optional[bool] = None,
    pesquisa: Optional[str] = None,
    session: Session = Depends(get_session),
):
    avarias = session.exec(select(Avaria).order_by(Avaria.data_registo.desc())).all()

    if resolvida is not None:
        avarias = [a for a in avarias if a.resolvida == resolvida]

    pesquisa_normalizada = (pesquisa or "").strip().lower()
    if pesquisa_normalizada:
        equipamento_ids = {a.equipamento_id for a in avarias}
        utilizador_ids = {a.utilizador_id for a in avarias if a.utilizador_id is not None}

        equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all() if equipamento_ids else []
        utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all() if utilizador_ids else []
        equipamentos_por_id = {e.id: e for e in equipamentos}
        utilizadores_por_id = {u.id: u for u in utilizadores}

        filtradas: list[Avaria] = []
        for avaria in avarias:
            eq = equipamentos_por_id.get(avaria.equipamento_id)
            ut = utilizadores_por_id.get(avaria.utilizador_id) if avaria.utilizador_id is not None else None
            haystack = " ".join([
                str(avaria.id),
                eq.nome if eq else "",
                eq.codigo if eq else "",
                avaria.descricao or "",
                ut.nome if ut else "",
                "resolvida" if avaria.resolvida else "aberta",
            ]).lower()
            if pesquisa_normalizada in haystack:
                filtradas.append(avaria)
        avarias = filtradas

    equipamento_ids = {a.equipamento_id for a in avarias}
    utilizador_ids = {a.utilizador_id for a in avarias if a.utilizador_id is not None}
    equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all() if equipamento_ids else []
    utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all() if utilizador_ids else []
    equipamentos_por_id = {e.id: e for e in equipamentos}
    utilizadores_por_id = {u.id: u for u in utilizadores}

    agora = _agora_utc()
    timestamp_fmt = agora.strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro = agora.strftime("%Y%m%d-%H%M%S")

    n_abertas = sum(1 for a in avarias if not a.resolvida)
    n_resolvidas = len(avarias) - n_abertas

    kpis_html = f"""
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Total de Avarias</div>
        <div class="kpi-value">{len(avarias)}</div><div class="kpi-sub">no filtro actual</div></div>
      <div class="kpi"><div class="kpi-label">Abertas</div>
        <div class="kpi-value" style="color:#dc2626;">{n_abertas}</div><div class="kpi-sub">por resolver</div></div>
      <div class="kpi"><div class="kpi-label">Resolvidas</div>
        <div class="kpi-value" style="color:#166534;">{n_resolvidas}</div><div class="kpi-sub">encerradas</div></div>
    </div>"""

    linhas_tabela = []
    for idx, avaria in enumerate(avarias, start=1):
        eq = equipamentos_por_id.get(avaria.equipamento_id)
        ut = utilizadores_por_id.get(avaria.utilizador_id) if avaria.utilizador_id is not None else None
        data_registo = avaria.data_registo.strftime("%d/%m/%Y %H:%M") if avaria.data_registo else "—"
        data_resolucao = avaria.data_resolucao.strftime("%d/%m/%Y") if avaria.data_resolucao else "—"
        if avaria.resolvida:
            estado_badge = '<span class="badge badge-green">Resolvida</span>'
        else:
            estado_badge = '<span class="badge badge-red">Aberta</span>'
        descricao = (avaria.descricao or "")[:120]
        linhas_tabela.append(f"""
        <tr>
          <td class="mono" style="text-align:center;">AV-{avaria.id:03d}</td>
          <td><strong>{eq.nome if eq else f"EQ-{avaria.equipamento_id}"}</strong>
              <span class="dim">{eq.codigo if eq else ""}</span></td>
          <td>{descricao}</td>
          <td class="mono">{data_registo}<br/><span class="dim">{ut.nome if ut else "—"}</span></td>
          <td style="text-align:center;">{estado_badge}</td>
          <td class="mono">{data_resolucao}</td>
        </tr>""")

    filtros_desc = ""
    if pesquisa_normalizada:
        filtros_desc += f'Pesquisa: "{pesquisa}" · '
    if resolvida is not None:
        filtros_desc += "Resolvidas" if resolvida else "Abertas"

    html = _html_relatorio(
        titulo_doc="Relatório de Avarias",
        subtitulo=filtros_desc.rstrip(" · "),
        timestamp_fmt=timestamp_fmt,
        meta_extra=f"Total de registos: <strong>{len(avarias)}</strong>",
        kpis_html=kpis_html,
        section_label="Registo de Avarias",
        cabecalhos=[
            ("ID", "8%"), ("Equipamento", "22%"), ("Descrição", "30%"),
            ("Registo / Reportado por", "20%"), ("Estado", "10%"), ("Resolução", "10%"),
        ],
        linhas_tabela=linhas_tabela,
        colspan=6,
    )

    try:
        pdf_bytes = _gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF de avarias: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao compilar o relatório PDF: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="avarias-{timestamp_ficheiro}.pdf"'},
    )

# ─────────────────────────────────────────────
# MANUTENÇÕES
# ─────────────────────────────────────────────

@app.get("/equipamentos/{equipamento_id}/manutencoes")
def listar_manutencoes(equipamento_id: int, session: Session = Depends(get_session)):
    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(Manutencao).where(Manutencao.equipamento_id == equipamento_id)
        .order_by(Manutencao.data_realizada.desc())
    ).all()

@app.post("/equipamentos/{equipamento_id}/manutencao")
def registar_manutencao(
    equipamento_id: int,
    dados: ManutencaoCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    _ = utilizador
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    manutencao = Manutencao(
        equipamento_id=equipamento_id,
        descricao=dados.descricao,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        executado_por_id=dados.executado_por_id,
        tipo_intervencao=dados.tipo_intervencao,
        custo_eur=dados.custo_eur,
        fornecedor=dados.fornecedor,
        referencia_sc_po=dados.referencia_sc_po,
        observacoes_externas=dados.observacoes_externas,
    )
    eq.estado_atual = EstadoEquipamento.MANUTENCAO.value
    session.add(manutencao)
    session.add(eq)
    _persistir_sessao(session, "Falha ao registar manutenção")
    session.refresh(manutencao)
    return {"mensagem": "Manutenção registada com sucesso", "manutencao": manutencao}

@app.get("/manutencoes")
def listar_todas_manutencoes(session: Session = Depends(get_session)):
    return session.exec(select(Manutencao).order_by(Manutencao.data_realizada.desc())).all()


# ─────────────────────────────────────────────
# ANALYTICS FINANCEIROS
# ─────────────────────────────────────────────

def _to_utc(dt: Optional[datetime]) -> datetime:
    """Garante que um datetime tem timezone UTC — SQLite devolve datetimes naive."""
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

@app.get("/financeiro/resumo", summary="Resumo financeiro por período")
def resumo_financeiro(
    ano: int,
    mes: Optional[int] = None,
    equipamento_id: Optional[int] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    from calendar import monthrange

    if mes:
        _, ultimo_dia = monthrange(ano, mes)
        data_inicio = datetime(ano, mes, 1, tzinfo=timezone.utc)
        data_fim = datetime(ano, mes, ultimo_dia, 23, 59, 59, tzinfo=timezone.utc)
    else:
        data_inicio = datetime(ano, 1, 1, tzinfo=timezone.utc)
        data_fim = datetime(ano, 12, 31, 23, 59, 59, tzinfo=timezone.utc)

    q_avarias = select(Avaria).where(
        Avaria.data_registo >= data_inicio,
        Avaria.data_registo <= data_fim,
        Avaria.custo_reparacao.is_not(None),
    )
    q_manutencoes = select(Manutencao).where(
        Manutencao.data_realizada >= data_inicio,
        Manutencao.data_realizada <= data_fim,
        Manutencao.custo_eur.is_not(None),
    )
    q_calibracoes = select(Calibracao).where(
        Calibracao.data_realizada >= data_inicio,
        Calibracao.data_realizada <= data_fim,
        Calibracao.custo_eur.is_not(None),
    )

    if equipamento_id:
        q_avarias = q_avarias.where(Avaria.equipamento_id == equipamento_id)
        q_manutencoes = q_manutencoes.where(Manutencao.equipamento_id == equipamento_id)
        q_calibracoes = q_calibracoes.where(Calibracao.equipamento_id == equipamento_id)

    avarias = session.exec(q_avarias).all()
    manutencoes = session.exec(q_manutencoes).all()
    calibracoes = session.exec(q_calibracoes).all()

    eq_ids = {a.equipamento_id for a in avarias} | \
             {m.equipamento_id for m in manutencoes} | \
             {c.equipamento_id for c in calibracoes}
    equipamentos_map: dict[int, str] = {}
    if eq_ids:
        eqs = session.exec(select(Equipamento).where(Equipamento.id.in_(eq_ids))).all()
        equipamentos_map = {e.id: e.nome for e in eqs}

    total_avarias = sum(a.custo_reparacao or 0 for a in avarias)
    total_manutencoes = sum(m.custo_eur or 0 for m in manutencoes)
    total_calibracoes = sum(c.custo_eur or 0 for c in calibracoes)
    total_geral = total_avarias + total_manutencoes + total_calibracoes

    por_eq: dict[int, dict] = {}
    for a in avarias:
        e = por_eq.setdefault(a.equipamento_id, {
            "equipamento_id": a.equipamento_id,
            "nome": equipamentos_map.get(a.equipamento_id, f"EQ-{a.equipamento_id}"),
            "avarias_eur": 0.0, "manutencoes_eur": 0.0,
            "calibracoes_eur": 0.0, "total_eur": 0.0, "n_intervencoes": 0,
        })
        e["avarias_eur"] += a.custo_reparacao or 0
        e["n_intervencoes"] += 1
    for m in manutencoes:
        e = por_eq.setdefault(m.equipamento_id, {
            "equipamento_id": m.equipamento_id,
            "nome": equipamentos_map.get(m.equipamento_id, f"EQ-{m.equipamento_id}"),
            "avarias_eur": 0.0, "manutencoes_eur": 0.0,
            "calibracoes_eur": 0.0, "total_eur": 0.0, "n_intervencoes": 0,
        })
        e["manutencoes_eur"] += m.custo_eur or 0
        e["n_intervencoes"] += 1
    for c in calibracoes:
        e = por_eq.setdefault(c.equipamento_id, {
            "equipamento_id": c.equipamento_id,
            "nome": equipamentos_map.get(c.equipamento_id, f"EQ-{c.equipamento_id}"),
            "avarias_eur": 0.0, "manutencoes_eur": 0.0,
            "calibracoes_eur": 0.0, "total_eur": 0.0, "n_intervencoes": 0,
        })
        e["calibracoes_eur"] += c.custo_eur or 0
        e["n_intervencoes"] += 1
    for e in por_eq.values():
        e["total_eur"] = round(e["avarias_eur"] + e["manutencoes_eur"] + e["calibracoes_eur"], 2)
    lista_por_eq = sorted(por_eq.values(), key=lambda x: x["total_eur"], reverse=True)

    por_forn: dict[str, dict] = {}
    def _add_forn(nome: Optional[str], valor: float) -> None:
        if not nome or not nome.strip():
            return
        chave = nome.strip().lower()
        f = por_forn.setdefault(chave, {"fornecedor": nome.strip(), "total_eur": 0.0, "n_intervencoes": 0})
        f["total_eur"] += valor
        f["n_intervencoes"] += 1
    for a in avarias:
        _add_forn(a.empresa_externa, a.custo_reparacao or 0)
    for m in manutencoes:
        _add_forn(getattr(m, "fornecedor", None), m.custo_eur or 0)
    for c in calibracoes:
        _add_forn(getattr(c, "fornecedor", None), c.custo_eur or 0)
    for f in por_forn.values():
        f["total_eur"] = round(f["total_eur"], 2)
    lista_por_forn = sorted(por_forn.values(), key=lambda x: x["total_eur"], reverse=True)

    evolucao_mensal: list[dict] = []
    MESES_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
    if not mes:
        for m_num in range(1, 13):
            _, ult = monthrange(ano, m_num)
            m_ini = datetime(ano, m_num, 1, tzinfo=timezone.utc)
            m_fim = datetime(ano, m_num, ult, 23, 59, 59, tzinfo=timezone.utc)
            av_m = sum(a.custo_reparacao or 0 for a in avarias
                       if m_ini <= _to_utc(a.data_registo) <= m_fim)
            mn_m = sum(m.custo_eur or 0 for m in manutencoes
                       if m_ini <= _to_utc(m.data_realizada) <= m_fim)
            cl_m = sum(c.custo_eur or 0 for c in calibracoes
                       if m_ini <= _to_utc(c.data_realizada) <= m_fim)
            evolucao_mensal.append({
                "mes": m_num,
                "label": MESES_PT[m_num - 1],
                "avarias_eur": round(av_m, 2),
                "manutencoes_eur": round(mn_m, 2),
                "calibracoes_eur": round(cl_m, 2),
                "total_eur": round(av_m + mn_m + cl_m, 2),
            })

    label_periodo = f"{ano}/{mes:02d}" if mes else str(ano)
    return {
        "periodo": {"ano": ano, "mes": mes, "label": label_periodo},
        "total_eur": round(total_geral, 2),
        "por_categoria": {
            "avarias_eur": round(total_avarias, 2),
            "manutencoes_eur": round(total_manutencoes, 2),
            "calibracoes_eur": round(total_calibracoes, 2),
        },
        "por_equipamento": lista_por_eq,
        "por_fornecedor": lista_por_forn,
        "evolucao_mensal": evolucao_mensal,
    }


@app.get("/manutencoes/exportar/pdf", summary="Exportar registo de manutenções em PDF")
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

    agora = _agora_utc()
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

    html = _html_relatorio(
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
        pdf_bytes = _gerar_pdf_playwright(html)
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


# ─────────────────────────────────────────────
# CALIBRAÇÕES
# ─────────────────────────────────────────────

@app.get("/equipamentos/{equipamento_id}/calibracoes")
def listar_calibracoes(equipamento_id: int, session: Session = Depends(get_session)):
    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(Calibracao).where(Calibracao.equipamento_id == equipamento_id)
        .order_by(Calibracao.data_realizada.desc())
    ).all()

@app.post("/equipamentos/{equipamento_id}/calibracao")
def registar_calibracao(
    equipamento_id: int,
    dados: CalibracaoCreate,
    session: Session = Depends(get_session),
    utilizador: Optional[Utilizador] = Depends(obter_utilizador_opcional),
) -> dict[str, Any]:
    _ = utilizador
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    calibracao = Calibracao(
        equipamento_id=equipamento_id,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        certificado_url=dados.certificado_url,
        observacoes=dados.observacoes,
        executado_por_id=dados.executado_por_id,
        custo_eur=dados.custo_eur,
        fornecedor=dados.fornecedor,
    )
    eq.estado_atual = EstadoEquipamento.CALIBRACAO.value
    session.add(calibracao)
    session.add(eq)
    _persistir_sessao(session, "Falha ao registar calibração")
    session.refresh(calibracao)
    return {"mensagem": "Calibração registada com sucesso", "calibracao": calibracao}

@app.get("/calibracoes")
def listar_todas_calibracoes(session: Session = Depends(get_session)):
    return session.exec(select(Calibracao).order_by(Calibracao.data_realizada.desc())).all()

@app.get("/calibracoes/proximas")
def calibracoes_proximas(dias: int = 30, session: Session = Depends(get_session)):
    dias = _validar_dias(dias)
    limite = _agora_utc() + timedelta(days=dias)
    return session.exec(
        select(Calibracao).where(
            Calibracao.proxima_data.is_not(None),
            Calibracao.proxima_data <= limite,
        ).order_by(Calibracao.proxima_data)
    ).all()


@app.get("/calibracoes/exportar/pdf", summary="Exportar registo de calibrações em PDF")
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

    agora = _agora_utc()
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

    html = _html_relatorio(
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
        pdf_bytes = _gerar_pdf_playwright(html)
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


@app.get("/equipamentos/{equipamento_id}/documentacao")
def listar_documentacao_equipamento(
    equipamento_id: int,
    session: Session = Depends(get_session),
):
    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(DocumentacaoEquipamento)
        .where(DocumentacaoEquipamento.equipamento_id == equipamento_id)
        .order_by(DocumentacaoEquipamento.criado_em.desc())
    ).all()


@app.post("/equipamentos/{equipamento_id}/documentacao")
def registar_documentacao_equipamento(
    equipamento_id: int,
    dados: DocumentoCreate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> DocumentacaoEquipamento:
    _ = admin
    _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    documento = DocumentacaoEquipamento(
        equipamento_id=equipamento_id,
        titulo=dados.titulo,
        tipo_documento=dados.tipo_documento,
        caminho_ficheiro=dados.caminho_ficheiro,
        descricao=dados.descricao,
        carregado_por_id=dados.carregado_por_id,
    )
    session.add(documento)
    _persistir_sessao(session, "Falha ao registar documentação do equipamento")
    session.refresh(documento)
    return documento

# ─────────────────────────────────────────────
# RESERVAS
# ─────────────────────────────────────────────

from routers.reservas import router as reservas_router

app.include_router(reservas_router)


@app.get("/reservas/exportar/pdf", summary="Exportar todas as reservas em PDF")
def exportar_reservas_pdf(session: Session = Depends(get_session)):
    reservas_raw = _listar_reservas_enriquecidas(session)
    agora = _agora_utc()

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

    html = _html_relatorio(
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
        pdf_bytes = _gerar_pdf_playwright(html)
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


@app.get("/reservas", summary="Listar todas as reservas (para o calendário)")
def listar_reservas(session: Session = Depends(get_session)):
    """
    Retorna reservas enriquecidas com nome do utilizador e equipamento.
    Porquê: O FullCalendar precisa de dados completos para renderizar os eventos.
    """
    reservas = _listar_reservas_enriquecidas(session)
    return [
        {
            **r,
            "data_inicio": _iso_z(r["data_inicio"]),
            "data_fim": _iso_z(r["data_fim"]),
        }
        for r in reservas
    ]


@app.get("/planeamento/exportar/pdf", summary="Exportar relatório executivo do laboratório em PDF formatado")
def exportar_planeamento_pdf(session: Session = Depends(get_session)):
    """Gera o relatório executivo do estado do laboratório em PDF landscape."""
    agora = _agora_utc()
    janela_oee = agora - timedelta(days=30)

    todos_equipamentos = session.exec(select(Equipamento)).all()
    total_equipamentos = len(todos_equipamentos)

    todas_reservas_raw = session.exec(select(Reserva)).all()
    reservas_ativas = sum(1 for r in todas_reservas_raw if r.data_fim >= agora)

    # ── OEE Global (últimos 30 dias) ────────────────────────────────────────
    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= janela_oee)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(SessaoUso.inicio >= janela_oee)
    ).all()
    sessoes_ativas_pre = session.exec(
        select(SessaoUso).where(SessaoUso.fim.is_(None), SessaoUso.inicio < janela_oee)
    ).all()

    reservas_por_eq: dict[int, list] = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_eq[r.equipamento_id].append(r)

    sessoes_por_eq: dict[int, list] = defaultdict(list)
    for s in sessoes_periodo + sessoes_ativas_pre:
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
        oee = _calcular_oee_temporal(real_s, planeado_s)
        if oee is not None:
            oees_validos.append(oee)

    oee_global_str = (
        f"{round(sum(oees_validos) / len(oees_validos), 1):.1f}%"
        if oees_validos else "—"
    )

    # ── Planeamento: todos os blocos ordenados cronologicamente ─────────────
    reservas_enriquecidas = _listar_reservas_enriquecidas(session)
    reservas_ordenadas = sorted(
        reservas_enriquecidas,
        key=lambda r: r["data_inicio"],
    )

    # Mapeamento estado → (bg, fg) para badge inline
    _CORES_ESTADO = {
        "Disponível":    ("#dcfce7", "#166534"),
        "Ocupado":       ("#dbeafe", "#1e40af"),
        "Avariado":      ("#fee2e2", "#991b1b"),
        "Em manutenção": ("#fef9c3", "#854d0e"),
        "Em calibração": ("#ede9fe", "#5b21b6"),
    }

    def _badge_estado(est: str) -> str:
        bg, fg = _CORES_ESTADO.get(est, ("#f1f5f9", "#334155"))
        return (
            f'<span style="background:{bg};color:{fg};padding:2px 7px;'
            f'border-radius:4px;font-size:8pt;font-weight:600;">{est}</span>'
        )

    linhas_tabela = []
    for idx, r in enumerate(reservas_ordenadas):
        bg = "#f8fafc" if idx % 2 == 0 else "#ffffff"
        inicio_str = r["data_inicio"].strftime("%d/%m/%Y %H:%M")
        fim_str    = r["data_fim"].strftime("%d/%m/%Y %H:%M")
        projeto    = r.get("projeto") or "—"
        metodo     = r.get("metodo") or ""
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

    timestamp_fmt  = agora.strftime("%d/%m/%Y às %H:%M")
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
        .kpis {{
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
        }}
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
        table.plan {{
            width: 100%;
            border-collapse: collapse;
        }}
        table.plan thead tr {{
            background-color: #1e293b;
            color: #ffffff;
        }}
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
            {_LOGO_HTML}
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
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle")
            pdf_bytes = page.pdf(
                format="A4",
                landscape=True,
                margin={"top": "15mm", "right": "12mm", "bottom": "18mm", "left": "12mm"},
                print_background=True,
            )
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

@app.get("/reservas/por-dia", summary="Reservas de um dia específico com utilizadores")
def reservas_por_dia(data: str, session: Session = Depends(get_session)):
    """
    Retorna reservas de um dia com lista de utilizadores — para o dropdown do calendário.
    Parâmetro: data no formato YYYY-MM-DD
    """
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
                "utilizador_iniciais": _iniciais_utilizador(ut),
                "projeto": r.projeto,
            })
    return resultado

@app.post("/reservas", summary="Criar nova reserva")
def criar_reserva(
    dados: ReservaCreate,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> Reserva:
    if dados.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Só pode criar reservas para o próprio utilizador")
    _obter_ou_404(session, Equipamento, dados.equipamento_id, "Equipamento não encontrado")
    _obter_ou_404(session, Utilizador, dados.utilizador_id, "Utilizador não encontrado")

    _validar_intervalo_reserva(dados.data_inicio, dados.data_fim)
    _validar_colisao_reserva(session, dados.equipamento_id, dados.data_inicio, dados.data_fim)

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
    _persistir_sessao(session, "Falha ao criar reserva")
    session.refresh(reserva)
    return reserva

# ─────────────────────────────────────────────
# UTILIZADORES
# ─────────────────────────────────────────────

@app.get("/utilizadores")
def listar_utilizadores(
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
):
    _ = admin
    try:
        return session.exec(
            select(Utilizador).where(Utilizador.ativo == True).order_by(Utilizador.nome)
        ).all()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Falha ao listar utilizadores") from exc


@app.post("/utilizadores")
def criar_utilizador(
    dados: UtilizadorCreate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    _ = admin
    if dados.pin:
        pin_novo = _normalizar_pin(dados.pin)
        _validar_formato_pin(pin_novo)
        pin_hash_calculado = _hash_pin(pin_novo)
        forcar_troca = False
    else:
        pin_hash_calculado = _hash_pin(PIN_INICIAL)
        forcar_troca = True
    ut = Utilizador(
        nome=dados.nome,
        numero_colaborador=dados.numero_colaborador,
        departamento=dados.departamento,
        email=dados.email,
        cargo=dados.cargo,
        role=dados.role,
        pin_hash=pin_hash_calculado,
        forcar_troca_pin=forcar_troca,
        ativo=True,
    )
    session.add(ut)
    try:
        session.commit()
        session.refresh(ut)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao criar utilizador") from exc
    return ut


@app.delete("/utilizadores/{utilizador_id}")
def eliminar_utilizador(
    utilizador_id: int,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.ativo = False
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao desativar utilizador") from exc
    return {"mensagem": "Utilizador desativado"}


@app.patch("/utilizadores/{utilizador_id}")
def atualizar_utilizador(
    utilizador_id: int,
    dados: UtilizadorUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    _ = admin
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    dados_dict = dados.model_dump(exclude_unset=True)
    pin_novo = dados_dict.pop('pin', None)
    for campo, valor in dados_dict.items():
        setattr(ut, campo, valor)
    if pin_novo:
        pin_normalizado = _normalizar_pin(pin_novo)
        _validar_formato_pin(pin_normalizado)
        ut.pin_hash = _hash_pin(pin_normalizado)
        ut.forcar_troca_pin = False
    session.add(ut)
    try:
        session.commit()
        session.refresh(ut)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar utilizador") from exc
    return ut


@app.patch("/utilizadores/{utilizador_id}/pin")
def admin_alterar_pin_utilizador(
    utilizador_id: int,
    dados: AdminAlterarPinRequest,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    novo_pin = _normalizar_pin(dados.novo_pin)
    _validar_formato_pin(novo_pin)
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.pin_hash = _hash_pin(novo_pin)
    ut.forcar_troca_pin = True
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar PIN do utilizador") from exc
    _registar_log("admin_alterar_pin", True, "PIN alterado por admin", utilizador_id)
    return {"mensagem": "PIN atualizado e troca obrigatória ativada"}


@app.patch("/utilizadores/{utilizador_id}/role")
def admin_alterar_role_utilizador(
    utilizador_id: int,
    dados: AlterarRoleRequest,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.role = dados.role
    session.add(ut)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao atualizar perfil do utilizador") from exc
    return {"mensagem": "Role atualizada com sucesso"}

# ─────────────────────────────────────────────
# OEE GLOBAL (Dashboard)
# ─────────────────────────────────────────────

@app.get("/dashboard/oee", summary="OEE global de todos os equipamentos")
def oee_global(
    dias: int = 30,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> list[dict[str, Any]]:
    """
    Agrega a eficiência de todos os equipamentos num único endpoint para o dashboard.
    Porquê: Evita N chamadas à API (uma por equipamento) no carregamento do dashboard.
    """
    _ = admin
    dias = _validar_dias(dias)
    limite = _agora_utc() - timedelta(days=dias)
    equipamentos = session.exec(select(Equipamento)).all()

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.inicio >= limite,
            SessaoUso.fim.is_not(None),
        )
    ).all()

    reservas_por_equipamento = defaultdict(list)
    for reserva in reservas_periodo:
        reservas_por_equipamento[reserva.equipamento_id].append(reserva)

    sessoes_por_equipamento = defaultdict(list)
    for sessao in sessoes_periodo:
        sessoes_por_equipamento[sessao.equipamento_id].append(sessao)

    resultado: list[dict[str, Any]] = []
    for eq in equipamentos:
        reservas = reservas_por_equipamento.get(eq.id, [])
        sessoes = sessoes_por_equipamento.get(eq.id, [])
        metricas = _calcular_metricas_uso(reservas, sessoes)
        resultado.append({
            "id": eq.id,
            "nome": eq.nome,
            "codigo": eq.codigo,
            "estado_atual": eq.estado_atual,
            **metricas,
            "total_reservas": len(reservas),
        })
    return resultado

@app.get("/stats/oee_summary", summary="Sumário OEE global e por equipamento para o Dashboard")
def oee_summary(
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> dict[str, Any]:
    """
    Sumário OEE para o Dashboard: valor global aggregado + lista individual.

    Fórmula: OEE = min(Tempo_Real / Tempo_Planeado, 1) × 100
    Limitamos a 1.0 (100%) para que overruns de planeamento não distorçam
    artificialmente a métrica — o OEE mede eficiência, não horas extra.

    Desvio_Planeamento = max(0, (Tempo_Real − Tempo_Planeado) / Tempo_Planeado × 100)
    Exprime em % quanto o tempo real excedeu o planeado; é devolvido
    separadamente como sinal de má gestão de planeamento.

    Tratamento de divisão por zero:
      Se Tempo_Planeado == 0 (sem reservas no período), ambos os campos
      ficam None e o equipamento é excluído da média global.
    """
    dias = _validar_dias(dias)
    limite = _agora_utc() - timedelta(days=dias)
    equipamentos = session.exec(select(Equipamento)).all()

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    # Incluir sessões ativas (fim IS NULL) para contabilizar tempo real em curso
    sessoes_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.inicio >= limite,
        )
    ).all()

    reservas_por_eq: dict[int, list] = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_eq[r.equipamento_id].append(r)

    sessoes_por_eq: dict[int, list] = defaultdict(list)
    for s in sessoes_periodo:
        sessoes_por_eq[s.equipamento_id].append(s)

    # Sessões ativas iniciadas ANTES da janela de análise (equipamentos 'Ocupado' há mais de N dias).
    # Sem esta segunda query, o numerador (tempo real) seria 0 para equipamentos cujo
    # check-in ocorreu antes de `limite`, tornando o OEE incorrectamente 0%.
    sessoes_ativas_pre_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_(None),
            SessaoUso.inicio < limite,
        )
    ).all()
    for s in sessoes_ativas_pre_periodo:
        sessoes_por_eq[s.equipamento_id].append(s)

    individual: list[dict[str, Any]] = []
    oee_com_dados: list[float] = []

    # Snapshot único para consistência entre equipamentos durante o ciclo
    agora = _agora_utc()

    for eq in equipamentos:
        reservas_eq = reservas_por_eq.get(eq.id, [])
        sessoes_eq = sessoes_por_eq.get(eq.id, [])

        # Janelamento Temporal Dinâmico:
        # Regra 1 — reserva futura (agora <= inicio): contribui 0 segundos
        # Regra 2 — reserva em curso (inicio < agora < fim): contribui (agora − inicio)
        # Regra 3 — reserva concluída (agora >= fim): contribui (fim − inicio) total
        tempo_planeado_s = 0.0
        for r in reservas_eq:
            if agora <= r.data_inicio:
                continue  # Reserva futura — excluir do denominador
            planeado = (min(agora, r.data_fim) - r.data_inicio).total_seconds()
            tempo_planeado_s += max(0.0, planeado)

        # Sessões concluídas usam s.fim; sessões ativas usam `agora` como fim efetivo
        tempo_real_s = 0.0
        for s in sessoes_eq:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())

        oee_pct: float | None = _calcular_oee_temporal(tempo_real_s, tempo_planeado_s)
        if oee_pct is not None:
            # Desvio = max(0, ratio − 1) × 100 — só positivo quando há overrun de tempo
            ratio = tempo_real_s / tempo_planeado_s
            desvio_pct: float | None = round(max(0.0, ratio - 1.0) * 100, 1)
            oee_com_dados.append(oee_pct)
        else:
            desvio_pct = None

        individual.append({
            "id": eq.id,
            "nome": eq.nome,
            "codigo": eq.codigo,
            "estado_atual": eq.estado_atual,
            "oee_pct": oee_pct,
            "desvio_planeamento_pct": desvio_pct,
            "tempo_planeado_h": round(tempo_planeado_s / 3600, 2),
            "tempo_real_h": round(tempo_real_s / 3600, 2),
            "total_reservas": len(reservas_eq),
            "tem_sessao_ativa": any(s.fim is None for s in sessoes_eq),
        })

    # Média global: sobre valores já limitados a 100% (overruns não inflacionam)
    oee_global = round(sum(oee_com_dados) / len(oee_com_dados), 1) if oee_com_dados else None

    return {
        "oee_global": oee_global,
        # Disponibilidade ≡ OEE nesta fase (Qualidade e Performance assumidos = 100%)
        "disponibilidade_global": oee_global,
        "performance_global": 100.0,
        "qualidade_global": 100.0,
        "individual": individual,
    }


@app.get("/stats/oee_historico", summary="OEE agregado por dia para gráfico de tendência")
def oee_historico(
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> list[dict[str, Any]]:
    """
    OEE diário dos últimos N dias (máx 90) para o gráfico de tendência do Dashboard.

    Cada ponto representa um dia com pelo menos uma reserva com tempo planeado > 0.
    Dias sem reservas iniciadas são omitidos para não gerar pontos zero falsos.
    Janelamento temporal aplicado: para dias passados min(agora, fim) = fim;
    para o dia atual, a reserva em curso contribui apenas com o tempo decorrido.
    """
    dias = _validar_dias(dias)
    dias = min(dias, 90)
    agora = _agora_utc()
    limite = agora - timedelta(days=dias)

    reservas_periodo = session.exec(
        select(Reserva).where(Reserva.data_inicio >= limite)
    ).all()
    sessoes_periodo = session.exec(
        select(SessaoUso).where(
            SessaoUso.inicio >= limite,
        )
    ).all()

    # Agrupar por dia UTC com base na data de início
    reservas_por_dia: dict = defaultdict(list)
    for r in reservas_periodo:
        reservas_por_dia[r.data_inicio.date()].append(r)

    sessoes_por_dia: dict = defaultdict(list)
    for s in sessoes_periodo:
        sessoes_por_dia[s.inicio.date()].append(s)

    resultado: list[dict[str, Any]] = []

    for dia, reservas_dia in sorted(reservas_por_dia.items()):
        sessoes_dia = sessoes_por_dia.get(dia, [])

        # Janelamento temporal: reservas futuras dentro do dia contribuem 0 s
        tempo_planeado_s = 0.0
        for r in reservas_dia:
            if agora <= r.data_inicio:
                continue
            planeado = (min(agora, r.data_fim) - r.data_inicio).total_seconds()
            tempo_planeado_s += max(0.0, planeado)

        if tempo_planeado_s <= 0:
            continue  # Omitir dias sem tempo planeado — evita pontos zero falsos

        tempo_real_s = 0.0
        for s in sessoes_dia:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())

        oee_pct = _calcular_oee_temporal(tempo_real_s, tempo_planeado_s)
        if oee_pct is None:
            continue

        resultado.append({
            "data": dia.isoformat(),
            "oee_pct": oee_pct,
            "tempo_planeado_h": round(tempo_planeado_s / 3600, 2),
            "tempo_real_h": round(tempo_real_s / 3600, 2),
        })

    return resultado


@app.post("/admin/stats/limpar-sessoes-invalidas", summary="Marcar sessões históricas inválidas para OEE")
def limpar_sessoes_invalidas(
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, Any]:
    """
    Script de limpeza único: percorre todas as sessões fechadas e marca
    valida_para_stats=False nas que sejam inválidas (duração < 300s, término
    forçado já registado, ou sessões abertas há mais de 24h sem fim registado).

    Apenas administradores podem executar este endpoint.
    """
    if utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Apenas administradores podem executar esta operação.")

    agora = _agora_utc()
    limite_orfas = agora - timedelta(hours=24)

    # Fechar e invalidar sessões órfãs abertas há mais de 24h
    sessoes_orfas = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_(None),
            SessaoUso.inicio <= limite_orfas,
        )
    ).all()
    invalidadas_orfas = 0
    for s in sessoes_orfas:
        s.fim = agora
        s.termino_forcado = True
        s.valida_para_stats = False
        session.add(s)
        invalidadas_orfas += 1

    # Reclassificar sessões fechadas que ainda não têm o campo calculado
    # (sessões antigas criadas antes desta migração têm valida_para_stats=True por omissão)
    sessoes_fechadas = session.exec(
        select(SessaoUso).where(
            SessaoUso.fim.is_not(None),
            SessaoUso.valida_para_stats == True,
        )
    ).all()
    invalidadas_curtas = 0
    for s in sessoes_fechadas:
        if s.termino_forcado or (s.fim - s.inicio).total_seconds() < 300:
            s.valida_para_stats = False
            session.add(s)
            invalidadas_curtas += 1

    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro ao limpar sessões inválidas")
        raise HTTPException(status_code=503, detail="Falha ao limpar sessões inválidas") from exc

    total = invalidadas_orfas + invalidadas_curtas
    logger.info("Limpeza OEE: %d sessões órfãs fechadas, %d sessões curtas/forçadas invalidadas", invalidadas_orfas, invalidadas_curtas)
    return {
        "mensagem": f"{total} sessões marcadas como inválidas para OEE.",
        "sessoes_orfas_fechadas": invalidadas_orfas,
        "sessoes_curtas_ou_forcadas": invalidadas_curtas,
        "total_invalidadas": total,
    }


@app.get("/metricas/oee/{equipamento_id}", summary="OEE específico para um equipamento")
def oee_equipamento(
    equipamento_id: int,
    dias: int = 30,
    session: Session = Depends(get_session),
    _: Utilizador = Depends(obter_utilizador_atual),
) -> dict[str, Any]:
    """
    Calcula o OEE temporal de um equipamento individual.

    Fórmula: OEE = min(Tempo_Real / Tempo_Planeado, 1) × 100
    Usando _calcular_oee_temporal — mesma lógica do /stats/oee_summary.

    Inclui sessões ativas (fim IS NULL) para que o OEE suba em tempo real
    enquanto o equipamento está em uso. A sessão ativa contribui com o tempo
    decorrido desde o seu início até ao momento do pedido (snapshot `agora`).

    Também devolve taxa_sucesso_planeamento_pct (reservas concluídas / total),
    que é uma métrica complementar de qualidade do planeamento, distinta do OEE.

    Args:
        equipamento_id: ID do equipamento para análise.
        dias: Janela de análise em dias (máx 365).

    Returns:
        dict com oee_pct temporal, taxa_sucesso_planeamento_pct e tempos.
    """
    dias = _validar_dias(dias)
    limite = _agora_utc() - timedelta(days=dias)
    # Snapshot único para consistência entre denominador e numerador
    agora = _agora_utc()

    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")

    reservas = session.exec(
        select(Reserva).where(
            Reserva.equipamento_id == equipamento_id,
            Reserva.data_inicio >= limite,
        )
    ).all()

    # Incluir sessões ativas (fim IS NULL) para contabilizar tempo real em curso
    sessoes = list(session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id == equipamento_id,
            SessaoUso.inicio >= limite,
        )
    ).all())

    # Sessão ativa iniciada antes da janela de análise (check-in há mais de N dias)
    sessao_pre = session.exec(
        select(SessaoUso).where(
            SessaoUso.equipamento_id == equipamento_id,
            SessaoUso.fim.is_(None),
            SessaoUso.inicio < limite,
        )
    ).first()
    if sessao_pre is not None:
        sessoes.append(sessao_pre)

    # Janelamento temporal: reservas futuras contribuem 0; reservas em curso contribuem
    # apenas o tempo já decorrido, não o tempo planeado total.
    tempo_planeado_s = 0.0
    for r in reservas:
        if agora <= r.data_inicio:
            continue  # Reserva futura — excluir do denominador
        planeado = (min(agora, r.data_fim) - r.data_inicio).total_seconds()
        tempo_planeado_s += max(0.0, planeado)

    # Sessões concluídas usam s.fim; sessões ativas usam `agora` como fim efetivo
    tempo_real_s = 0.0
    for s in sessoes:
        try:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())
        except (TypeError, ValueError):
            # Protecção contra datas malformadas na base de dados
            continue

    oee_pct = _calcular_oee_temporal(tempo_real_s, tempo_planeado_s)

    # Taxa de sucesso de planeamento: reservas concluídas / total (métrica distinta do OEE)
    reservas_sucesso = [r for r in reservas if r.concluido_com_sucesso is True]
    taxa_sucesso_planeamento = (
        len(reservas_sucesso) / len(reservas) * 100 if reservas else 0.0
    )

    return {
        "equipamento_id": equipamento_id,
        "equipamento_nome": eq.nome,
        "oee_pct": oee_pct if oee_pct is not None else 0.0,
        "taxa_sucesso_planeamento_pct": round(taxa_sucesso_planeamento, 2),
        "tempo_planeado_h": round(tempo_planeado_s / 3600, 2),
        "tempo_real_h": round(tempo_real_s / 3600, 2),
        "total_reservas": len(reservas),
        "reservas_sucesso": len(reservas_sucesso),
        "periodo_dias": dias,
        "desde": _iso_z(limite),
    }


