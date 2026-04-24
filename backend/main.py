import hashlib
import hmac
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Optional, TypeVar

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select

from database import criar_tabelas, get_session
from models import (
    Avaria,
    Calibracao,
    DocumentacaoEquipamento,
    Equipamento,
    EstadoEquipamento,
    Manutencao,
    PrioridadeAvaria,
    Reserva,
    RoleUtilizador,
    SessaoUso,
    TipoDocumento,
    Utilizador,
)
from collections import defaultdict

logger = logging.getLogger(__name__)
ModeloT = TypeVar("ModeloT")


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


def _listar_reservas_enriquecidas(session: Session):
    """Obtém reservas com metadados de equipamento e utilizador.

    Args:
        session: Sessão ativa de base de dados.

    Returns:
        list[dict[str, Any]]: Reservas enriquecidas para consumo no frontend.
    """
    reservas = session.exec(select(Reserva)).all()
    if not reservas:
        return []

    equipamento_ids = {r.equipamento_id for r in reservas}
    utilizador_ids = {r.utilizador_id for r in reservas}

    equipamentos = session.exec(select(Equipamento).where(Equipamento.id.in_(equipamento_ids))).all()
    utilizadores = session.exec(select(Utilizador).where(Utilizador.id.in_(utilizador_ids))).all()

    equipamentos_por_id = {e.id: e for e in equipamentos}
    utilizadores_por_id = {u.id: u for u in utilizadores}

    resultado: list[dict[str, Any]] = []
    for r in reservas:
        eq = equipamentos_por_id.get(r.equipamento_id)
        ut = utilizadores_por_id.get(r.utilizador_id)
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
                "data_inicio": r.data_inicio,
                "data_fim": r.data_fim,
                "notas": r.notas,
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


TOKEN_TTL_HORAS = 8
PIN_INICIAL = "0000"
_sessoes_ativas: dict[str, dict] = {}
_logs_auth: list[dict] = []


def _agora_utc() -> datetime:
    return datetime.utcnow()


def _normalizar_pin(pin: str) -> str:
    return pin.strip()


def _validar_formato_pin(pin: str) -> None:
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN deve ter exatamente 4 dígitos")


def _validar_dias(dias: int) -> int:
    """Valida o período de análise para evitar consultas descontroladas."""
    if dias < 1 or dias > 365:
        raise HTTPException(status_code=400, detail="O parâmetro 'dias' deve estar entre 1 e 365")
    return dias


def _hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000)
    return f"{salt}${digest.hex()}"


def _verificar_pin(pin: str, pin_hash: str) -> bool:
    try:
        salt, esperado = pin_hash.split("$", 1)
    except ValueError:
        return False
    atual = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000).hex()
    return hmac.compare_digest(atual, esperado)


def _expirar_sessoes_antigas() -> None:
    agora = _agora_utc()
    expirados = [token for token, info in _sessoes_ativas.items() if info["expira_em"] <= agora]
    for token in expirados:
        _sessoes_ativas.pop(token, None)


def _registar_log(
    acao: str,
    sucesso: bool,
    detalhe: str,
    utilizador_id: Optional[int] = None,
) -> None:
    _logs_auth.append({
        "timestamp": _agora_utc().isoformat(),
        "acao": acao,
        "sucesso": sucesso,
        "detalhe": detalhe,
        "utilizador_id": utilizador_id,
    })
    if len(_logs_auth) > 500:
        del _logs_auth[0]


def _criar_sessao(utilizador: Utilizador) -> dict[str, Any]:
    _expirar_sessoes_antigas()
    token = secrets.token_urlsafe(32)
    expira_em = _agora_utc() + timedelta(hours=TOKEN_TTL_HORAS)
    _sessoes_ativas[token] = {
        "utilizador_id": utilizador.id,
        "expira_em": expira_em,
        "role": utilizador.role,
    }
    return {
        "token": token,
        "expira_em": expira_em.isoformat(),
        "expira_em_epoch_ms": int(expira_em.timestamp() * 1000),
    }


def _extrair_token(authorization: Optional[str]) -> str:
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
    _expirar_sessoes_antigas()
    token = _extrair_token(authorization)
    dados = _sessoes_ativas.get(token)
    if not dados:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    utilizador = session.get(Utilizador, dados["utilizador_id"])
    if not utilizador or not utilizador.ativo:
        _sessoes_ativas.pop(token, None)
        raise HTTPException(status_code=401, detail="Utilizador inválido ou inativo")
    return utilizador


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

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Garante inicialização de infraestrutura antes de aceitar pedidos."""
    criar_tabelas()
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

# ─────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────

class EstadoUpdate(BaseModel):
    # Aceita string (ex: "Disponível", "Ocupado") para flexibilidade com frontend
    novo_estado: str

class AvariaCreate(BaseModel):
    descricao: str
    prioridade: PrioridadeAvaria = PrioridadeAvaria.MEDIA
    reportado_por_id: Optional[int] = None

class AvariaResolve(BaseModel):
    notas_resolucao: Optional[str] = None

class ManutencaoCreate(BaseModel):
    descricao: str
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    executado_por_id: Optional[int] = None

class CalibracaoCreate(BaseModel):
    data_realizada: datetime
    periodicidade_dias: Optional[int] = None
    proxima_data: Optional[datetime] = None
    certificado_url: Optional[str] = None
    observacoes: Optional[str] = None
    executado_por_id: Optional[int] = None

class DocumentoCreate(BaseModel):
    titulo: str
    tipo_documento: TipoDocumento = TipoDocumento.OUTRO
    caminho_ficheiro: str
    descricao: Optional[str] = None
    carregado_por_id: Optional[int] = None

class CheckinCreate(BaseModel):
    reserva_id: Optional[int] = None  # Opcional: pode fazer checkin sem reserva

class ReservaCreate(BaseModel):
    equipamento_id: int
    utilizador_id: int
    projeto: Optional[str] = None
    data_inicio: datetime
    data_fim: datetime
    notas: Optional[str] = None

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

class UtilizadorCreate(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: RoleUtilizador = RoleUtilizador.USER


class UtilizadorUpdate(BaseModel):
    nome: Optional[str] = None
    numero_colaborador: Optional[str] = None
    departamento: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    role: Optional[RoleUtilizador] = None


class LoginRequest(BaseModel):
    user_id: int
    pin: str


class AlterarPinRequest(BaseModel):
    pin_atual: str
    novo_pin: str


class AdminAlterarPinRequest(BaseModel):
    novo_pin: str


class AlterarRoleRequest(BaseModel):
    pin_atual: str
    role: RoleUtilizador


class BootstrapAdminRequest(BaseModel):
    nome: str
    numero_colaborador: str
    departamento: str
    pin: str

class EquipamentoUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    localizacao: Optional[str] = None
    numero_serie: Optional[str] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    ano_fabrico: Optional[int] = None
    potencia_kw: Optional[float] = None
    ligacao_eletrica: Optional[str] = None
    corrente_a: Optional[float] = None
    voltagem_v: Optional[float] = None
    peso_kg: Optional[float] = None
    peso_max_kg: Optional[float] = None
    notas_tecnicas: Optional[str] = None
    foto_url: Optional[str] = None

class EquipamentoCreate(BaseModel):
    nome: str
    tipo: str
    localizacao: str
    codigo: str
    numero_serie: Optional[str] = None
    range_temp: Optional[str] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    ano_fabrico: Optional[int] = None
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

    if not utilizador.pin_hash:
        utilizador.pin_hash = _hash_pin(PIN_INICIAL)
        utilizador.forcar_troca_pin = True
        session.add(utilizador)
        _persistir_sessao(session, "Falha ao inicializar credenciais do utilizador")
        session.refresh(utilizador)

    if not _verificar_pin(pin, utilizador.pin_hash):
        _registar_log("login", False, "PIN inválido", utilizador.id)
        raise HTTPException(status_code=401, detail="PIN inválido")

    sessao = _criar_sessao(utilizador)
    _registar_log("login", True, "Login com sucesso", utilizador.id)
    return {
        "token": sessao["token"],
        "expira_em": sessao["expira_em"],
        "expira_em_epoch_ms": sessao["expira_em_epoch_ms"],
        "utilizador": {
            "id": utilizador.id,
            "nome": utilizador.nome,
            "iniciais": _iniciais_utilizador(utilizador),
            "role": utilizador.role,
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
def auth_logout(authorization: Optional[str] = Header(default=None)):
    token = _extrair_token(authorization)
    sessao = _sessoes_ativas.pop(token, None)
    _registar_log("logout", bool(sessao), "Sessão terminada", sessao["utilizador_id"] if sessao else None)
    return {"mensagem": "Sessão terminada"}


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
    _persistir_sessao(session, "Falha ao atualizar PIN")
    session.refresh(utilizador)
    _registar_log("alterar_pin", True, "PIN alterado pelo utilizador", utilizador.id)
    return {"mensagem": "PIN atualizado com sucesso"}


@app.get("/auth/logs", summary="Logs de autenticação")
def auth_logs(admin: Utilizador = Depends(exigir_admin)):
    _ = admin
    return list(reversed(_logs_auth))

# ─────────────────────────────────────────────
# EQUIPAMENTOS
# ─────────────────────────────────────────────

@app.get("/equipamentos", summary="Listar todos os equipamentos")
def listar_equipamentos(session: Session = Depends(get_session)):
    return session.exec(select(Equipamento)).all()

@app.get("/equipamentos/{equipamento_id}", summary="Detalhe de um equipamento")
def detalhe_equipamento(equipamento_id: int, session: Session = Depends(get_session)):
    return _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")


@app.get("/equipamentos/exportar/pdf", summary="Exportar equipamentos para PDF")
def exportar_equipamentos_pdf(
    filtro: Optional[str] = None,
    estado: Optional[str] = None,
    session: Session = Depends(get_session),
):
    equipamentos = session.exec(select(Equipamento)).all()

    filtro_normalizado = (filtro or "").strip().lower()
    estado_normalizado = (estado or "").strip()

    if filtro_normalizado:
        equipamentos = [
            eq for eq in equipamentos
            if filtro_normalizado in (eq.nome or "").lower()
            or filtro_normalizado in (eq.tipo or "").lower()
            or filtro_normalizado in (eq.localizacao or "").lower()
        ]

    if estado_normalizado:
        equipamentos = [eq for eq in equipamentos if eq.estado_atual == estado_normalizado]

    equipamentos_ordenados = sorted(equipamentos, key=lambda eq: (eq.nome or "").lower())

    linhas = [
        f"Total de equipamentos: {len(equipamentos_ordenados)}",
        f"Gerado em: {datetime.utcnow().strftime('%d/%m/%Y %H:%M')} (UTC)",
        "",
    ]

    for idx, eq in enumerate(equipamentos_ordenados, start=1):
        data_registo = eq.criado_em.strftime("%d/%m/%Y %H:%M") if eq.criado_em else "-"
        codigo = eq.codigo or "-"
        linhas.extend([
            f"{idx}. {eq.nome} ({codigo})",
            f"   Tipo: {eq.tipo}   |   Estado: {eq.estado_atual}",
            f"   Localização: {eq.localizacao}",
            f"   Registado em: {data_registo}",
            "",
        ])

    ficheiro_pdf = _gerar_pdf_texto("Relatorio de Equipamentos", linhas)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    return Response(
        content=ficheiro_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="equipamentos-{timestamp}.pdf"'},
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
    # Atualiza apenas os campos fornecidos (partial update)
    for campo, valor in dados.model_dump(exclude_unset=True).items():
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
    eq.estado_atual = dados.novo_estado
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
    Regista o início da utilização real.
    Porquê: O timestamp de início é essencial para calcular a eficiência OEE.
    Valida que o equipamento está disponível antes de abrir a sessão.
    """
    try:
        eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")

        estados_bloqueantes = [
            EstadoEquipamento.AVARIADO,
            EstadoEquipamento.EM_MANUTENCAO,
            EstadoEquipamento.EM_CALIBRACAO,
            EstadoEquipamento.OCUPADO,
        ]
        if eq.estado_atual in estados_bloqueantes:
            raise HTTPException(
                status_code=400,
                detail=f"Operação negada. Estado atual: {eq.estado_atual}."
            )

        # Garante que não existe sessão aberta — evita sobreposição de tempos
        sessao_aberta = session.exec(
            select(SessaoUso).where(
                SessaoUso.equipamento_id == equipamento_id,
                SessaoUso.fim.is_(None),
            )
        ).first()
        if sessao_aberta:
            raise HTTPException(status_code=400, detail="Equipamento já está em uso por outro operador.")

        nova_sessao = SessaoUso(
            equipamento_id=equipamento_id,
            utilizador_id=utilizador_atual.id,
            utilizador=utilizador_atual.nome,
            reserva_id=dados.reserva_id,
            inicio=datetime.utcnow(),
        )
        eq.estado_atual = EstadoEquipamento.OCUPADO
        session.add(nova_sessao)
        session.add(eq)
        _persistir_sessao(session, "Falha ao registar check-in")
        session.refresh(nova_sessao)
        return {"mensagem": "Check-in realizado com sucesso.", "sessao": nova_sessao}

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Erro de base de dados no check-in")
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

        sessao_aberta.fim = datetime.utcnow()
        eq = session.get(Equipamento, equipamento_id)
        if eq:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL
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
    session: Session = Depends(get_session)
) -> dict[str, Any]:
    """
    Calcula a eficiência OEE comparando tempo reservado vs tempo real de uso.
    Fórmula: Eficiência = Σ(tempo_real) / Σ(tempo_reservado) × 100%
    Porquê: Esta métrica é o principal argumento para justificar novos investimentos.
    """
    dias = _validar_dias(dias)
    limite = datetime.utcnow() - timedelta(days=dias)

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
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    avaria = Avaria(
        equipamento_id=equipamento_id,
        descricao=dados.descricao,
        prioridade=dados.prioridade,
        reportado_por_id=dados.reportado_por_id,
    )
    session.add(avaria)
    _persistir_sessao(session, "Falha ao registar avaria")
    session.refresh(avaria)
    session.refresh(eq)
    return {"mensagem": "Avaria registada com sucesso", "estado_atual": eq.estado_atual, "avaria": avaria}

@app.patch("/avarias/{avaria_id}/resolver")
def resolver_avaria(
    avaria_id: int,
    dados: AvariaResolve,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    avaria = session.get(Avaria, avaria_id)
    if not avaria:
        raise HTTPException(status_code=404, detail="Avaria não encontrada")
    if avaria.resolvida:
        raise HTTPException(status_code=400, detail="Avaria já estava resolvida")
    avaria.resolvida = True
    avaria.data_resolucao = datetime.utcnow()
    if dados.notas_resolucao:
        avaria.notas_resolucao = dados.notas_resolucao
    outras_abertas = session.exec(
        select(Avaria).where(
            Avaria.equipamento_id == avaria.equipamento_id,
            Avaria.resolvida == False,
            Avaria.id != avaria_id
        )
    ).first()
    if not outras_abertas:
        eq = session.get(Equipamento, avaria.equipamento_id)
        if eq and eq.estado_atual == EstadoEquipamento.AVARIADO:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL
            session.add(eq)
    session.add(avaria)
    _persistir_sessao(session, "Falha ao resolver avaria")
    session.refresh(avaria)
    return {"mensagem": "Avaria resolvida com sucesso", "avaria": avaria}

@app.get("/avarias")
def listar_todas_avarias(resolvida: Optional[bool] = None, session: Session = Depends(get_session)):
    query = select(Avaria)
    if resolvida is not None:
        query = query.where(Avaria.resolvida == resolvida)
    return session.exec(query.order_by(Avaria.data_registo.desc())).all()

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
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    manutencao = Manutencao(
        equipamento_id=equipamento_id,
        descricao=dados.descricao,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        executado_por_id=dados.executado_por_id,
    )
    eq.estado_atual = EstadoEquipamento.MANUTENCAO
    session.add(manutencao)
    session.add(eq)
    _persistir_sessao(session, "Falha ao registar manutenção")
    session.refresh(manutencao)
    return {"mensagem": "Manutenção registada com sucesso", "manutencao": manutencao}

@app.get("/manutencoes")
def listar_todas_manutencoes(session: Session = Depends(get_session)):
    return session.exec(select(Manutencao).order_by(Manutencao.data_realizada.desc())).all()

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
    admin: Utilizador = Depends(exigir_admin),
) -> dict[str, Any]:
    _ = admin
    eq = _obter_ou_404(session, Equipamento, equipamento_id, "Equipamento não encontrado")
    calibracao = Calibracao(
        equipamento_id=equipamento_id,
        data_realizada=dados.data_realizada,
        periodicidade_dias=dados.periodicidade_dias,
        proxima_data=dados.proxima_data,
        certificado_url=dados.certificado_url,
        observacoes=dados.observacoes,
        executado_por_id=dados.executado_por_id,
    )
    eq.estado_atual = EstadoEquipamento.CALIBRACAO
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
    limite = datetime.utcnow() + timedelta(days=dias)
    return session.exec(
        select(Calibracao).where(
            Calibracao.proxima_data.is_not(None),
            Calibracao.proxima_data <= limite,
        ).order_by(Calibracao.proxima_data)
    ).all()


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
            "data_inicio": r["data_inicio"].isoformat(),
            "data_fim": r["data_fim"].isoformat(),
        }
        for r in reservas
    ]


@app.get("/reservas/exportar/pdf", summary="Exportar reservas para PDF")
def exportar_reservas_pdf(session: Session = Depends(get_session)):
    reservas = _listar_reservas_enriquecidas(session)
    reservas_ordenadas = sorted(reservas, key=lambda r: r["data_inicio"])

    linhas = [
        f"Total de reservas: {len(reservas_ordenadas)}",
        f"Gerado em: {datetime.utcnow().strftime('%d/%m/%Y %H:%M')} (UTC)",
        "",
    ]

    for idx, r in enumerate(reservas_ordenadas, start=1):
        inicio = r["data_inicio"].strftime("%d/%m/%Y %H:%M")
        fim = r["data_fim"].strftime("%d/%m/%Y %H:%M")
        projeto = r["projeto"] or "-"
        notas = r["notas"] or "-"
        linhas.extend([
            f"{idx}. {r['equipamento_codigo']} - {r['equipamento_nome']}",
            f"   Utilizador: {r['utilizador_nome']}",
            f"   Inicio: {inicio}   |   Fim: {fim}",
            f"   Projeto: {projeto}",
            f"   Notas: {notas}",
            "",
        ])

    ficheiro_pdf = _gerar_pdf_texto("Relatorio de Reservas", linhas)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    return Response(
        content=ficheiro_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="reservas-{timestamp}.pdf"'},
    )


@app.get("/planeamento/exportar/pdf", summary="Exportar planeamento global para PDF")
def exportar_planeamento_pdf(session: Session = Depends(get_session)):
    reservas = _listar_reservas_enriquecidas(session)
    reservas_ordenadas = sorted(
        reservas,
        key=lambda r: (r["equipamento_nome"].lower(), r["data_inicio"]),
    )

    linhas = [
        f"Total de blocos planeados: {len(reservas_ordenadas)}",
        f"Gerado em: {datetime.utcnow().strftime('%d/%m/%Y %H:%M')} (UTC)",
        "",
    ]

    for idx, r in enumerate(reservas_ordenadas, start=1):
        inicio = r["data_inicio"].strftime("%d/%m/%Y %H:%M")
        fim = r["data_fim"].strftime("%d/%m/%Y %H:%M")
        projeto = r["projeto"] or "-"
        linhas.extend([
            f"{idx}. {r['equipamento_nome']} ({r['equipamento_codigo']})",
            f"   Janela: {inicio} -> {fim}",
            f"   Utilizador: {r['utilizador_nome']}   |   Projeto: {projeto}",
            "",
        ])

    ficheiro_pdf = _gerar_pdf_texto("Relatorio de Planeamento Global", linhas)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    return Response(
        content=ficheiro_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="planeamento-{timestamp}.pdf"'},
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

    # Conflito temporal: [inicio, fim) não pode sobrepor outra reserva do mesmo equipamento
    conflito = session.exec(
        select(Reserva).where(
            Reserva.equipamento_id == dados.equipamento_id,
            Reserva.data_inicio < dados.data_fim,
            Reserva.data_fim > dados.data_inicio,
        )
    ).first()
    if conflito:
        raise HTTPException(
            status_code=409,
            detail="Já existe uma reserva para este equipamento no intervalo selecionado",
        )

    reserva = Reserva(
        equipamento_id=dados.equipamento_id,
        utilizador_id=dados.utilizador_id,
        projeto=dados.projeto,
        data_inicio=dados.data_inicio,
        data_fim=dados.data_fim,
        notas=dados.notas,
    )
    session.add(reserva)
    _persistir_sessao(session, "Falha ao criar reserva")
    session.refresh(reserva)
    return reserva

@app.delete("/reservas/{reserva_id}", summary="Cancelar reserva")
def cancelar_reserva(
    reserva_id: int,
    session: Session = Depends(get_session),
    utilizador_atual: Utilizador = Depends(exigir_pin_alterado),
) -> dict[str, str]:
    reserva = session.get(Reserva, reserva_id)
    if not reserva:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if reserva.utilizador_id != utilizador_atual.id and utilizador_atual.role != RoleUtilizador.ADMIN:
        raise HTTPException(status_code=403, detail="Só o dono da reserva (ou admin) pode cancelar")
    session.delete(reserva)
    _persistir_sessao(session, "Falha ao cancelar reserva")
    return {"mensagem": "Reserva cancelada com sucesso"}

# ─────────────────────────────────────────────
# UTILIZADORES
# ─────────────────────────────────────────────

@app.get("/utilizadores")
def listar_utilizadores(
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
):
    _ = admin
    return session.exec(select(Utilizador)).all()

@app.post("/utilizadores")
def criar_utilizador(
    dados: UtilizadorCreate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    _ = admin
    ut = Utilizador(
        nome=dados.nome,
        numero_colaborador=dados.numero_colaborador,
        departamento=dados.departamento,
        email=dados.email,
        cargo=dados.cargo,
        role=dados.role,
        pin_hash=_hash_pin(PIN_INICIAL),
        forcar_troca_pin=True,
        ativo=True,
    )
    session.add(ut)
    _persistir_sessao(session, "Falha ao criar utilizador")
    session.refresh(ut)
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
    _persistir_sessao(session, "Falha ao desativar utilizador")
    return {"mensagem": "Utilizador desativado"}


@app.patch("/utilizadores/{utilizador_id}")
def atualizar_utilizador(
    utilizador_id: int,
    dados: UtilizadorUpdate,
    session: Session = Depends(get_session),
    admin: Utilizador = Depends(exigir_admin),
) -> Utilizador:
    """Partial update: nome, numero_colaborador, departamento"""
    _ = admin
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(ut, campo, valor)
    session.add(ut)
    _persistir_sessao(session, "Falha ao atualizar utilizador")
    session.refresh(ut)
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
    _persistir_sessao(session, "Falha ao atualizar PIN do utilizador")
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
    pin_atual = _normalizar_pin(dados.pin_atual)
    _validar_formato_pin(pin_atual)
    if not _verificar_pin(pin_atual, admin.pin_hash):
        raise HTTPException(status_code=401, detail="PIN do administrador inválido")
    ut = _obter_ou_404(session, Utilizador, utilizador_id, "Utilizador não encontrado")
    ut.role = dados.role
    session.add(ut)
    _persistir_sessao(session, "Falha ao atualizar perfil do utilizador")
    return {"mensagem": "Role atualizada com sucesso"}

# ─────────────────────────────────────────────
# OEE GLOBAL (Dashboard)
# ─────────────────────────────────────────────

@app.get("/dashboard/oee", summary="OEE global de todos os equipamentos")
def oee_global(dias: int = 30, session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    """
    Agrega a eficiência de todos os equipamentos num único endpoint para o dashboard.
    Porquê: Evita N chamadas à API (uma por equipamento) no carregamento do dashboard.
    """
    dias = _validar_dias(dias)
    limite = datetime.utcnow() - timedelta(days=dias)
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
