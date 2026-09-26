"""Geração de PDFs via Playwright (HTML→PDF) e fallback textual."""

from __future__ import annotations

import base64
import logging
import os

from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

# ─── Logo em base64 ───────────────────────────────────────────────────────────

_LOGO_BASE64: str = ""
try:
    _logo_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "Frontend", "src", "assets", "lab-logo.png"
    )
    with open(_logo_path, "rb") as _f:
        _LOGO_BASE64 = base64.b64encode(_f.read()).decode("ascii")
except FileNotFoundError:
    logger.warning("Logo não encontrado — PDFs usarão texto.")

LOGO_HTML: str = (
    f'<img src="data:image/png;base64,{_LOGO_BASE64}" alt="Industrial Testing Lab" class="logo-img"/>'
    if _LOGO_BASE64
    else '<div class="logo-fallback">INDUSTRIAL TESTING LAB</div>'
)

# ─── CSS partilhado ───────────────────────────────────────────────────────────

CSS_RELATORIO = """
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


# ─── Geração de PDF ───────────────────────────────────────────────────────────

def gerar_pdf_playwright(html: str) -> bytes:
    """Renderiza HTML → PDF via Chromium headless (Playwright).

    try/finally garante que o browser é sempre fechado, mesmo em excepção.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle")
            return page.pdf(
                format="A4",
                landscape=True,
                margin={"top": "15mm", "right": "12mm", "bottom": "18mm", "left": "12mm"},
                print_background=True,
            )
        finally:
            # Garantido mesmo em caso de excepção — evita fuga de processo Chromium
            browser.close()


def _pdf_escape(texto: str) -> str:
    return texto.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def gerar_pdf_texto(titulo: str, linhas: list[str]) -> bytes:
    """PDF textual minimalista sem dependências externas (fallback)."""
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

    for pagina in paginas:
        linhas_completas = [titulo, ""] + pagina
        comandos = ["BT", "/F1 12 Tf", "50 790 Td", "14 TL"]
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
        page_id = add_obj(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode("ascii")
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objetos[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")

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


# ─── Template HTML tabular ────────────────────────────────────────────────────

def html_relatorio(
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
    ths = "".join(f'<th style="width:{w};">{txt}</th>' for txt, w in cabecalhos)
    tbody = (
        "".join(linhas_tabela)
        if linhas_tabela
        else (
            f'<tr><td colspan="{colspan}" style="text-align:center;padding:20px;color:#94a3b8;">'
            "Nenhum registo encontrado para os filtros aplicados.</td></tr>"
        )
    )
    return f"""<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8"/>
<style>{CSS_RELATORIO}</style>
</head>
<body>
  <div class="header">
    <div>
      {LOGO_HTML}
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
