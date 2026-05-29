from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select

from app.core.deps import exigir_admin, obter_utilizador_opcional
from app.db.database import get_session
from app.models.avaria import Avaria
from app.models.calibracao import Calibracao
from app.models.base import EstadoEquipamento, normalizar_estado_equipamento
from app.models.equipamento import Equipamento
from app.models.reserva import DocumentacaoEquipamento
from app.models.sessao import SessaoUso
from app.models.utilizador import Utilizador
from app.schemas.equipamento import EquipamentoCreate, EquipamentoUpdate, EstadoUpdate
from app.schemas.reserva import DocumentoCreate
from app.services.auth_service import agora_utc, iso_z, obter_ou_404, persistir_sessao
from app.services.pdf_service import LOGO_HTML, gerar_pdf_playwright

logger = logging.getLogger(__name__)

router = APIRouter(tags=["equipamentos"])


@router.get("/equipamentos", summary="Listar todos os equipamentos")
def listar_equipamentos(session: Session = Depends(get_session)):
    return session.exec(select(Equipamento)).all()


@router.get("/equipamentos/exportar/pdf", summary="Exportar inventário de equipamentos para PDF")
def exportar_equipamentos_pdf(
    filtro: Optional[str] = None,
    estado: Optional[str] = None,
    session: Session = Depends(get_session),
):
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

    _CORES_ESTADO: dict[str, tuple[str, str]] = {
        "Disponível": ("#dcfce7", "#166534"), "Ocupado": ("#dbeafe", "#1e40af"),
        "Avariado": ("#fee2e2", "#991b1b"), "Em manutenção": ("#fef9c3", "#854d0e"),
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

    timestamp_formatado = agora_utc().strftime("%d/%m/%Y às %H:%M")
    timestamp_ficheiro = agora_utc().strftime("%Y%m%d-%H%M%S")

    html = f"""<!DOCTYPE html>
<html lang="pt"><head><meta charset="UTF-8" />
<style>
    @page {{ size: A4 landscape; margin: 15mm 12mm 18mm 12mm; }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1e293b; }}
    .header {{ border-bottom: 3px solid #dc2626; padding-bottom: 8px; margin-bottom: 14px;
               display: flex; justify-content: space-between; align-items: flex-end; }}
    .logo-img {{ height: 36px; display: block; }}
    .logo-fallback {{ font-size: 20pt; font-weight: 900; color: #dc2626; }}
    .doc-meta {{ font-size: 8pt; color: #64748b; text-align: right; }}
    .doc-title {{ font-size: 14pt; font-weight: 700; margin-bottom: 2px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 9pt; }}
    thead tr {{ background: #1e293b; color: #f8fafc; }}
    thead th {{ padding: 7px 9px; text-align: left; font-weight: 600; font-size: 8pt; white-space: nowrap; }}
    tbody td {{ padding: 6px 9px; border-bottom: 1px solid #e2e8f0; }}
    .mono {{ font-family: "Courier New", Courier, monospace; font-size: 8.5pt; }}
    .footer-note {{ margin-top: 14px; font-size: 7.5pt; color: #94a3b8; text-align: center; }}
</style></head><body>
    <div class="header">
        <div>{LOGO_HTML}<div class="doc-title">Inventário de Equipamentos</div></div>
        <div class="doc-meta">Gerado em: {timestamp_formatado} (UTC)<br/>
        Total: <strong>{len(ordenados)}</strong>{filtro_desc}</div>
    </div>
    <table><thead><tr>
        <th>ID</th><th>Nome</th><th>Código</th><th>Tipo</th>
        <th>Localização</th><th style="text-align:center;">Estado</th>
        <th style="text-align:center;">Registo</th>
    </tr></thead><tbody>
        {''.join(linhas_tabela) if linhas_tabela else
         '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">Nenhum equipamento.</td></tr>'}
    </tbody></table>
    <div class="footer-note">Industrial Testing Lab — Documento de Circulação Interna — Confidencial</div>
</body></html>"""

    try:
        pdf_bytes = gerar_pdf_playwright(html)
    except Exception as exc:
        logger.error("Falha ao gerar PDF do inventário: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {exc}")

    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inventario-equipamentos-{timestamp_ficheiro}.pdf"'},
    )


@router.get("/equipamentos/{equipamento_id}", summary="Detalhe de um equipamento")
def detalhe_equipamento(equipamento_id: int, session: Session = Depends(get_session)):
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")

    if eq.estado_atual == EstadoEquipamento.OCUPADO.value:
        try:
            sessao_expirada = session.exec(
                select(SessaoUso).where(
                    SessaoUso.equipamento_id == equipamento_id,
                    SessaoUso.fim.is_(None),
                    SessaoUso.fim_automatico.is_not(None),
                    SessaoUso.fim_automatico <= agora_utc(),
                )
            ).first()
            if sessao_expirada:
                from app.services.auth_service import calcular_valida_para_stats
                sessao_expirada.fim = agora_utc()
                sessao_expirada.termino_forcado = False
                sessao_expirada.valida_para_stats = calcular_valida_para_stats(
                    sessao_expirada.inicio, sessao_expirada.fim, termino_forcado=False
                )
                eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
                session.add(sessao_expirada)
                session.add(eq)
                persistir_sessao(session, "Falha no auto-checkout")
                session.refresh(eq)
        except Exception:
            session.rollback()
            logger.warning("Auto-checkout ignorado (possível migração de coluna pendente)")

    if eq.estado_atual != EstadoEquipamento.OCUPADO.value:
        try:
            sessao_orfao = session.exec(
                select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
            ).first()
            if sessao_orfao:
                eq.estado_atual = EstadoEquipamento.OCUPADO.value
                session.add(eq)
                persistir_sessao(session, "Falha ao corrigir estado do equipamento")
                session.refresh(eq)
        except Exception:
            session.rollback()
            logger.warning("Verificação de consistência ignorada (equipamento %s)", equipamento_id)

    calibracao_mais_recente = session.exec(
        select(Calibracao)
        .where(Calibracao.equipamento_id == equipamento_id)
        .order_by(Calibracao.data_realizada.desc())
    ).first()
    data_proxima_calibracao = calibracao_mais_recente.proxima_data if calibracao_mais_recente else None

    return {
        **eq.model_dump(),
        "data_proxima_calibracao": iso_z(data_proxima_calibracao) if data_proxima_calibracao else None,
    }


@router.post("/equipamentos", summary="Criar novo equipamento")
def criar_equipamento(dados: EquipamentoCreate, session: Session = Depends(get_session)) -> Equipamento:
    equipamento = Equipamento(**dados.model_dump())
    try:
        session.add(equipamento)
        persistir_sessao(session, "Falha ao criar equipamento")
        session.refresh(equipamento)
        return equipamento
    except IntegrityError as e:
        session.rollback()
        if "equipamento.codigo" in str(e.orig) or "UNIQUE constraint failed" in str(e.orig):
            raise HTTPException(status_code=400, detail="Código do equipamento em falta ou já existente")
        raise HTTPException(status_code=400, detail="Dados inválidos para criar equipamento")


@router.patch("/equipamentos/{equipamento_id}", summary="Atualizar ficha técnica do equipamento")
def atualizar_equipamento(
    equipamento_id: int,
    dados: EquipamentoUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Equipamento:
    _ = admin
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    changes = dados.model_dump(exclude_unset=True)

    if "estado_atual" in changes:
        novo_estado = normalizar_estado_equipamento(changes.pop("estado_atual"))
        if novo_estado not in {e.value for e in EstadoEquipamento}:
            raise HTTPException(status_code=400, detail="Estado do equipamento inválido")
        estado_anterior = normalizar_estado_equipamento(eq.estado_atual)
        if novo_estado == EstadoEquipamento.DISPONIVEL.value:
            avaria_bloqueante = session.exec(
                select(Avaria).where(Avaria.equipamento_id == equipamento_id, Avaria.resolvida == False)
            ).first()
            if avaria_bloqueante:
                raise HTTPException(status_code=409, detail="Não é possível marcar como Disponível enquanto existir uma avaria aberta.")
        if novo_estado == EstadoEquipamento.AVARIADO.value and estado_anterior != EstadoEquipamento.AVARIADO.value:
            descricao = changes.pop("descricao_avaria", None) or "Avaria detetada via alteração de estado"
            setattr(eq, "_avaria_descricao", descricao)
        eq.estado_atual = novo_estado

    for campo, valor in changes.items():
        setattr(eq, campo, valor)

    session.add(eq)
    persistir_sessao(session, "Falha ao atualizar equipamento")
    session.refresh(eq)
    return eq


@router.patch("/equipamentos/{equipamento_id}/estado", summary="Atualizar estado do equipamento")
def atualizar_estado(
    equipamento_id: int,
    dados: EstadoUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Equipamento:
    _ = admin
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    novo_estado = normalizar_estado_equipamento(dados.novo_estado)
    if novo_estado not in {e.value for e in EstadoEquipamento}:
        raise HTTPException(status_code=400, detail="Estado do equipamento inválido")
    if novo_estado == EstadoEquipamento.DISPONIVEL.value:
        avaria_bloqueante = session.exec(
            select(Avaria).where(Avaria.equipamento_id == equipamento_id, Avaria.resolvida == False)
        ).first()
        if avaria_bloqueante:
            raise HTTPException(status_code=409, detail="Não é possível marcar como Disponível com avaria aberta.")
        sessao_aberta = session.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == equipamento_id, SessaoUso.fim.is_(None))
        ).first()
        if sessao_aberta:
            sessao_aberta.fim = agora_utc()
            session.add(sessao_aberta)
    eq.estado_atual = novo_estado
    session.add(eq)
    persistir_sessao(session, "Falha ao atualizar estado do equipamento")
    session.refresh(eq)
    return eq


@router.delete("/equipamentos/{equipamento_id}", summary="Eliminar equipamento")
def eliminar_equipamento(
    equipamento_id: int,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, str]:
    _ = admin
    eq = obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    session.delete(eq)
    persistir_sessao(session, "Falha ao eliminar equipamento")
    return {"mensagem": "Equipamento eliminado com sucesso"}


@router.post("/admin/reparar-avarias-faltantes", summary="Criar avarias em falta (Admin)")
def reparar_avarias_faltantes(
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, object]:
    _ = admin
    criado = []
    ignorados = []
    try:
        equipamentos_avariados = session.exec(
            select(Equipamento).where(Equipamento.estado_atual == EstadoEquipamento.AVARIADO.value)
        ).all()
        for eq in equipamentos_avariados:
            existente = session.exec(
                select(Avaria).where(Avaria.equipamento_id == eq.id, Avaria.resolvida == False)
            ).first()
            if existente:
                ignorados.append(eq.id)
                continue
            av = Avaria(equipamento_id=eq.id, descricao="Avaria criada em reparação de dados (varredura)", resolvida=False)
            session.add(av)
            criado.append(eq.id)
        if criado:
            session.commit()
        return {"criado": criado, "ignorados": ignorados, "total_avariado": len(equipamentos_avariados)}
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Falha ao reparar avarias faltantes") from exc


@router.get("/equipamentos/{equipamento_id}/documentacao")
def listar_documentacao_equipamento(equipamento_id: int, session: Session = Depends(get_session)):
    obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    return session.exec(
        select(DocumentacaoEquipamento)
        .where(DocumentacaoEquipamento.equipamento_id == equipamento_id)
        .order_by(DocumentacaoEquipamento.criado_em.desc())
    ).all()


@router.post("/equipamentos/{equipamento_id}/documentacao")
def registar_documentacao_equipamento(
    equipamento_id: int,
    dados: DocumentoCreate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> DocumentacaoEquipamento:
    _ = admin
    obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    documento = DocumentacaoEquipamento(
        equipamento_id=equipamento_id,
        titulo=dados.titulo,
        tipo_documento=dados.tipo_documento,
        caminho_ficheiro=dados.caminho_ficheiro,
        descricao=dados.descricao,
        carregado_por_id=dados.carregado_por_id,
    )
    session.add(documento)
    persistir_sessao(session, "Falha ao registar documentação")
    session.refresh(documento)
    return documento
