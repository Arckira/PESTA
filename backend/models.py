"""Modelos relacionais do dominio de gestao de laboratorio.

Este modulo consolida a camada de persistencia com SQLModel a pensar em
SQL Server 2022 Express, mantendo ao mesmo tempo compatibilidade suficiente
com o MVP atual durante a transicao a partir do Excel.
"""

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Column, DateTime, Index, String, Float, Integer, ForeignKey, event, update, insert as sa_insert, inspect as sa_inspect
from sqlalchemy.types import TypeDecorator
from sqlmodel import Field, Relationship, SQLModel


def _to_utc(dt: datetime) -> datetime:
    """Normaliza um datetime para UTC aware."""

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _datetime_to_iso_z(dt: datetime | None) -> str | None:
    """Serializa datetimes em ISO-8601 com sufixo Z."""

    if dt is None:
        return None
    return _to_utc(dt).isoformat().replace("+00:00", "Z")


class UTCDateTime(TypeDecorator):
    """Persistencia UTC sem conversoes implicitas no SQL Server."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _to_utc(value).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return _to_utc(value)


class UTCModel(SQLModel):
    model_config = ConfigDict(json_encoders={datetime: _datetime_to_iso_z})


def utc_now() -> datetime:
    """Devolve a data/hora UTC atual.

    Returns:
        datetime: Instante UTC sem timezone explicito, alinhado com o
        comportamento atual do projeto.
    """

    return datetime.now(timezone.utc)


def calcular_proxima_data(
    data_realizada: Optional[datetime],
    periodicidade_dias: Optional[int],
) -> Optional[datetime]:
    """Calcula a proxima data planeada para um registo periodico.

    Args:
        data_realizada: Data em que a intervencao foi executada.
        periodicidade_dias: Frequencia em dias entre intervencoes.

    Returns:
        Optional[datetime]: Proxima data calculada, ou ``None`` se nao
        existirem dados suficientes.
    """

    if not data_realizada or not periodicidade_dias or periodicidade_dias <= 0:
        return None
    return data_realizada + timedelta(days=periodicidade_dias)


class EstadoEquipamento(str, Enum):
    """Estados operacionais unificados para clarificar a operação na Industrial Testing Lab."""

    DISPONIVEL = "Disponível"
    OCUPADO = "Ocupado"
    AVARIADO = "Avariado"
    MANUTENCAO = "Em manutenção"
    CALIBRACAO = "Em calibração"


def normalizar_estado_equipamento(estado: Optional[str]) -> str:
    """Converte estados legados para os nomes canónicos do sistema.

    Porque: a base de dados pode ainda conter valores antigos; normalizar
    aqui evita ruído na UI e mantém a lógica operacional consistente durante
    a migração.
    """

    if estado is None:
        return EstadoEquipamento.DISPONIVEL.value

    texto = str(estado).strip()
    legado = {
        "nok": EstadoEquipamento.AVARIADO.value,
        "em funcionamento": EstadoEquipamento.DISPONIVEL.value,
    }
    return legado.get(texto.lower(), texto)


class RoleUtilizador(str, Enum):
    """Perfis autorizados na aplicacao."""

    USER = "user"
    ADMIN = "admin"


class TipoDocumento(str, Enum):
    """Classificacao simples de documentos ligados ao equipamento."""

    MANUAL = "manual"
    DATASHEET = "datasheet"
    CERTIFICADO = "certificado"
    OUTRO = "outro"



class Equipamento(UTCModel, table=True):
    __tablename__ = "Equipamentos"
    __table_args__ = (
        Index("ix_equipamento_nome_localizacao", "nome", "localizacao"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    # Nota (PT-PT): Os nomes dos campos (ex.: temp_min, largura_mm,
    # voltagem_v) são usados directamente pela UI. Mantê-los
    # consistentes garante que os objetos enviados pelo cliente
    # correspondem à estrutura persistida na base de dados.
    nome: str = Field(sa_column=Column("nome", String(150), nullable=False, index=True))
    tipo: str = Field(sa_column=Column("tipo", String(120), nullable=False, index=True))
    localizacao: str = Field(
        sa_column=Column("localizacao", String(150), nullable=False, index=True)
    )
    codigo: str = Field(
        sa_column=Column("codigo", String(50), nullable=False, unique=True, index=True)
    )
    numero_serie: Optional[str] = Field(
        default=None,
        sa_column=Column("numero_serie", String(100), index=True),
    )
    # Limites Operacionais
    temp_min: Optional[float] = Field(default=None, sa_column=Column("temp_min", Float))
    temp_max: Optional[float] = Field(default=None, sa_column=Column("temp_max", Float))
    humidade_max: Optional[float] = Field(default=None, sa_column=Column("humidade_max", Float))
    
    fabricante: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    modelo: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    ano_fabrico: Optional[int] = Field(default=None)
    largura_mm: Optional[float] = Field(default=None)
    altura_mm: Optional[float] = Field(default=None)
    profundidade_mm: Optional[float] = Field(default=None)
    volume_l: Optional[float] = Field(default=None)
    potencia_kw: Optional[float] = Field(default=None)
    ligacao_eletrica: Optional[str] = Field(default=None, sa_column=Column(String(80)))
    corrente_a: Optional[float] = Field(default=None)
    voltagem_v: Optional[float] = Field(default=None)
    peso_kg: Optional[float] = Field(default=None)
    peso_max_kg: Optional[float] = Field(default=None)
    notas_tecnicas: Optional[str] = Field(default=None)
    # Armazenamos o estado como string no modelo para garantir que
    # valores vindos de clientes (ex.: 'Ocupado') e dados legados são aceites
    # sem validação estrita por Enum no Pydantic/SQLModel.
    estado_atual: str = Field(
        default=EstadoEquipamento.DISPONIVEL.value,
        sa_column=Column(String(30), nullable=False, index=True),
    )
    foto_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )
    atualizado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
    )

    # Porque: as relacoes nomeadas simplificam joins coerentes entre API,
    # exportacoes e futuras dashboards analiticas.
    sessoes: list["SessaoUso"] = Relationship(back_populates="equipamento")
    reservas: list["Reserva"] = Relationship(back_populates="equipamento")
    avarias: list["Avaria"] = Relationship(back_populates="equipamento")
    manutencoes: list["Manutencao"] = Relationship(back_populates="equipamento")
    calibracoes: list["Calibracao"] = Relationship(back_populates="equipamento")
    documentos: list["DocumentacaoEquipamento"] = Relationship(back_populates="equipamento")


class Utilizador(UTCModel, table=True):
    """Representa um utilizador autenticavel e rastreavel.

    Notes:
        Alguns nomes de campo mantem compatibilidade com o MVP. O campo
        ``numero_colaborador`` continua presente e pode ser usado como numero
        mecanografico durante a migracao do legado.
    """

    __tablename__ = "Utilizadores"
    __table_args__ = (
        Index("ix_utilizador_nome_role", "nome", "role"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(sa_column=Column("nome", String(150), nullable=False, index=True))
    iniciais: Optional[str] = Field(default=None, sa_column=Column(String(10)))
    numero_colaborador: str = Field(
        sa_column=Column("numero_colaborador", String(50), nullable=False, unique=True, index=True)
    )
    email: Optional[str] = Field(default=None, sa_column=Column(String(180), index=True))
    cargo: Optional[str] = Field(default=None, sa_column=Column(String(100), index=True))
    departamento: str = Field(sa_column=Column("departamento", String(120), nullable=False))
    pin_hash: str = Field(default="", sa_column=Column(String(255), nullable=False))
    role: RoleUtilizador = Field(
        default=RoleUtilizador.USER,
        sa_column=Column(String(20), nullable=False, index=True),
    )
    ativo: bool = Field(default=True, index=True)
    forcar_troca_pin: bool = Field(default=True)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False))

    reservas: list["Reserva"] = Relationship(back_populates="utilizador_rel")
    sessoes: list["SessaoUso"] = Relationship(back_populates="utilizador_rel")
    sessoes_auth: list["SessaoAuth"] = Relationship(back_populates="utilizador")
    avarias_reportadas: list["Avaria"] = Relationship(back_populates="reportado_por")
    manutencoes_executadas: list["Manutencao"] = Relationship(back_populates="executado_por")
    calibracoes_executadas: list["Calibracao"] = Relationship(back_populates="executado_por")
    documentos_carregados: list["DocumentacaoEquipamento"] = Relationship(back_populates="carregado_por")


class Avaria(UTCModel, table=True):
    """Registo de avaria de um equipamento."""

    __tablename__ = "Avarias"
    __table_args__ = (
        Index("ix_avaria_equipamento_resolvida", "equipamento_id", "resolvida"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    utilizador_id: Optional[int] = Field(
        default=None,
        sa_column=Column("utilizador_id", Integer, ForeignKey("Utilizadores.id"), nullable=True, index=True),
    )
    descricao: str = Field(sa_column=Column("descricao", String, nullable=False))
    data_registo: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False, index=True))
    resolvida: bool = Field(default=False, index=True)
    data_resolucao: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    notas_resolucao: Optional[str] = Field(default=None)
    custo_reparacao: Optional[float] = Field(default=None, sa_column=Column("custo_reparacao", Float, nullable=True))

    equipamento: Optional[Equipamento] = Relationship(back_populates="avarias")
    reportado_por: Optional[Utilizador] = Relationship(back_populates="avarias_reportadas")

class Manutencao(UTCModel, table=True):
    """Historico de manutencao preventiva ou corretiva."""

    __tablename__ = "Manutencoes"
    __table_args__ = (
        Index("ix_manutencao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    descricao: str = Field(sa_column=Column("descricao", String, nullable=False))
    data_realizada: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="manutencoes")
    executado_por: Optional[Utilizador] = Relationship(back_populates="manutencoes_executadas")


class Calibracao(UTCModel, table=True):
    """Historico de calibracao com suporte a certificado e planeamento."""

    __tablename__ = "Calibracoes"
    __table_args__ = (
        Index("ix_calibracao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    data_realizada: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    certificado_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    observacoes: Optional[str] = Field(default=None)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="calibracoes")
    executado_por: Optional[Utilizador] = Relationship(back_populates="calibracoes_executadas")


class DocumentacaoEquipamento(UTCModel, table=True):
    """Metadados de documentos externos ligados ao equipamento.

    Notes:
        O ficheiro binario nao e guardado na base de dados. Apenas se persiste
        o caminho local ou URL, reduzindo o tamanho da BD e simplificando
        backup, partilha e governanca documental.
    """

    __tablename__ = "DocumentacaoEquipamento"
    __table_args__ = (
        Index("ix_documentacao_equipamento_tipo", "equipamento_id", "tipo_documento"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    carregado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    titulo: str = Field(sa_column=Column("titulo", String(180), nullable=False))
    tipo_documento: TipoDocumento = Field(
        default=TipoDocumento.OUTRO,
        sa_column=Column(String(30), nullable=False, index=True),
    )
    caminho_ficheiro: str = Field(sa_column=Column("caminho_ficheiro", String(1000), nullable=False))
    descricao: Optional[str] = Field(default=None)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False, index=True))

    equipamento: Optional[Equipamento] = Relationship(back_populates="documentos")
    carregado_por: Optional[Utilizador] = Relationship(back_populates="documentos_carregados")


class Reserva(UTCModel, table=True):
    """Reserva planeada para utilizacao futura de um equipamento."""

    __tablename__ = "Reservas"
    __table_args__ = (
        Index("ix_reserva_equipamento_periodo", "equipamento_id", "data_inicio", "data_fim"),
        Index("ix_reserva_utilizador_periodo", "utilizador_id", "data_inicio", "data_fim"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    utilizador_id: int = Field(foreign_key="Utilizadores.id", index=True)
    projeto: Optional[str] = Field(default=None, sa_column=Column(String(150), index=True))
    # Porque: o método de ensaio liga a reserva à norma/protocolo usado no laboratório
    # e melhora a rastreabilidade documental e técnica.
    metodo: Optional[str] = Field(default=None, sa_column=Column(String(180), index=True))
    data_inicio: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    data_fim: datetime = Field(sa_column=Column(UTCDateTime(), nullable=False, index=True))
    # Duração estimada do ensaio em minutos (preenchida quando inicia o check-in)
    duracao_prevista_minutos: Optional[int] = Field(default=None, sa_column=Column("duracao_prevista_minutos", nullable=True, index=True))
    # Indica se o ensaio foi concluído com sucesso (usado para cálculo de OEE)
    concluido_com_sucesso: Optional[bool] = Field(default=None, sa_column=Column("concluido_com_sucesso", nullable=True, index=True))
    # Data/hora de conclusão automática (calculada como data_inicio + duracao_prevista_minutos)
    fim_automatico: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), nullable=True, index=True))
    notas: Optional[str] = Field(default=None)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="reservas")
    utilizador_rel: Optional[Utilizador] = Relationship(back_populates="reservas")
    sessoes: list["SessaoUso"] = Relationship(back_populates="reserva")


class SessaoUso(UTCModel, table=True):
    """Sessao real de check-in/check-out para auditoria operacional."""

    __tablename__ = "SessoesUso"
    __table_args__ = (
        Index("ix_sessaouso_equipamento_inicio", "equipamento_id", "inicio"),
        Index("ix_sessaouso_utilizador_inicio", "utilizador_id", "inicio"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    reserva_id: Optional[int] = Field(default=None, foreign_key="Reservas.id", index=True)
    utilizador_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    utilizador: str = Field(sa_column=Column("utilizador", String(150), nullable=False))
    inicio: datetime = Field(default_factory=utc_now, sa_column=Column(UTCDateTime(), nullable=False, index=True))
    fim: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    duracao_prevista_minutos: Optional[int] = Field(default=None)
    fim_automatico: Optional[datetime] = Field(default=None, sa_column=Column(UTCDateTime(), index=True))
    termino_forcado: bool = Field(default=False, index=True)
    # False se duracao < 300s ou termino_forcado=True; exclui sessões inválidas do OEE
    valida_para_stats: bool = Field(default=True, index=True)
    projeto: Optional[str] = Field(default=None, sa_column=Column(String(150), nullable=True))
    metodo: Optional[str] = Field(default=None, sa_column=Column(String(180), nullable=True))

    equipamento: Optional[Equipamento] = Relationship(back_populates="sessoes")
    reserva: Optional[Reserva] = Relationship(back_populates="sessoes")
    utilizador_rel: Optional[Utilizador] = Relationship(back_populates="sessoes")


class SessaoAuth(UTCModel, table=True):
    """Sessão de autenticação com persistência em base de dados.

    Garante que as sessões são resilientes a reinícios de servidor, permitindo
    auditoria centralizada de acesso ao sistema e invalidação de sessões quando
    o utilizador é desativado.

    Atributos:
        token: Identificador único da sessão (chave primária).
        utilizador_id: Referência ao utilizador proprietário da sessão.
        role: Papel do utilizador no momento de autenticação (cópia para eficiência).
        expira_em: Data/hora de expiração da sessão.
        criado_em: Data/hora de criação da sessão.
    """

    __tablename__ = "SessoesAuth"
    __table_args__ = (
        Index("ix_sessaoauth_utilizador_expira", "utilizador_id", "expira_em"),
    )

    token: str = Field(
        primary_key=True,
        max_length=255,
    )
    utilizador_id: int = Field(
        foreign_key="Utilizadores.id",
        index=True,
    )
    role: RoleUtilizador = Field(
        sa_column=Column(String(20), nullable=False),
    )
    expira_em: datetime = Field(
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
    )

    utilizador: Optional[Utilizador] = Relationship(back_populates="sessoes_auth")


class Log(UTCModel, table=True):
    """Registo persistente de auditoria de acções de utilizadores e administradores.

    Porque: a rastreabilidade é um requisito industrial crítico. Persistir logs na BD
    garante que o histórico de acções sobrevive a reinícios de servidor e permite
    auditorias forenses sem depender de logs de aplicação voláteis em memória.
    """

    __tablename__ = "Logs"
    __table_args__ = (
        Index("ix_log_utilizador_criado", "utilizador_id", "criado_em"),
        Index("ix_log_acao_criado", "acao", "criado_em"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    utilizador_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    utilizador_nome: Optional[str] = Field(default=None, sa_column=Column(String(150)))
    role: Optional[str] = Field(default=None, sa_column=Column(String(20)))
    acao: str = Field(sa_column=Column("acao", String(100), nullable=False, index=True))
    entidade: Optional[str] = Field(default=None, sa_column=Column(String(100)))
    entidade_id: Optional[int] = Field(default=None)
    detalhe: Optional[str] = Field(default=None)
    sucesso: bool = Field(default=True, index=True)
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
    )


@event.listens_for(Equipamento, "before_update")
def sincronizar_timestamp_equipamento(mapper, connection, target) -> None:
    """Atualiza o carimbo temporal de alteracao do equipamento.

    Porque: manter ``atualizado_em`` no servidor evita inconsistencias quando
    diferentes clientes ou scripts escrevem no mesmo registo.
    """

    del mapper, connection
    target.atualizado_em = utc_now()


@event.listens_for(Equipamento, "before_insert")
@event.listens_for(Equipamento, "before_update")
def normalizar_estado_equipamento_model(mapper, connection, target) -> None:
    """Normaliza estados antigos antes de persistir o equipamento."""

    del mapper, connection
    target.estado_atual = normalizar_estado_equipamento(target.estado_atual)


@event.listens_for(Manutencao, "before_insert")
@event.listens_for(Manutencao, "before_update")
def calcular_proxima_data_manutencao(mapper, connection, target) -> None:
    """Calcula automaticamente a proxima manutencao planeada."""

    del mapper, connection
    if target.proxima_data is None:
        target.proxima_data = calcular_proxima_data(
            data_realizada=target.data_realizada,
            periodicidade_dias=target.periodicidade_dias,
        )


@event.listens_for(Calibracao, "before_insert")
@event.listens_for(Calibracao, "before_update")
def calcular_proxima_data_calibracao(mapper, connection, target) -> None:
    """Calcula automaticamente a proxima calibracao planeada."""

    del mapper, connection
    if target.proxima_data is None:
        target.proxima_data = calcular_proxima_data(
            data_realizada=target.data_realizada,
            periodicidade_dias=target.periodicidade_dias,
        )


@event.listens_for(Avaria, "after_insert")
def marcar_equipamento_como_avariado(mapper, connection, target) -> None:
    """Força o estado do equipamento para Avariado após registo de avaria.

    Porque: a atualizacao no proprio evento ORM garante consistencia mesmo
    quando a avaria e criada por script, API ou futuras tarefas agendadas.
    """

    del mapper
    connection.execute(
        update(Equipamento)
        .where(Equipamento.id == target.equipamento_id)
        .values(
            estado_atual=EstadoEquipamento.AVARIADO.value,
            atualizado_em=utc_now(),
        )
    )


@event.listens_for(Reserva, "after_insert")
def marcar_equipamento_como_ocupado_por_reserva(mapper, connection, target) -> None:
    """Força o estado do equipamento para Ocupado quando a reserva é criada."""

    del mapper
    connection.execute(
        update(Equipamento)
        .where(Equipamento.id == target.equipamento_id)
        .values(
            estado_atual=EstadoEquipamento.OCUPADO.value,
            atualizado_em=utc_now(),
        )
    )


@event.listens_for(SessaoUso, "after_insert")
def marcar_equipamento_como_ocupado_por_ensaio(mapper, connection, target) -> None:
    """Força o estado do equipamento para Ocupado quando o ensaio começa."""

    del mapper
    connection.execute(
        update(Equipamento)
        .where(Equipamento.id == target.equipamento_id)
        .values(
            estado_atual=EstadoEquipamento.OCUPADO.value,
            atualizado_em=utc_now(),
        )
    )


@event.listens_for(Equipamento, "after_update")
def criar_avaria_se_transitou_para_avariado(mapper, connection, target) -> None:
    """Cria automaticamente registo de Avaria quando o estado passa para 'Avariado'.

    Porque: assegura rastreabilidade industrial — qualquer transição para
    'Avariado' é capturada como um registo de avaria sem depender apenas da
    ação do utilizador noutras interfaces. Evita duplicados verificando a
    transição efetiva (antigo != novo).
    """

    del mapper
    try:
        hist = sa_inspect(target).attrs.estado_atual.history
        antigo = hist.deleted[0] if hist.deleted else None
        novo = hist.added[0] if hist.added else getattr(target, 'estado_atual', None)
    except Exception:
        antigo = None
        novo = getattr(target, 'estado_atual', None)

    antigo_norm = normalizar_estado_equipamento(antigo)
    novo_norm = normalizar_estado_equipamento(novo)

    # Criar AVARIA apenas quando houver uma transição para 'Avariado'
    if novo_norm == EstadoEquipamento.AVARIADO.value and antigo_norm != EstadoEquipamento.AVARIADO.value:
        # Se já foi registada manualmente uma avaria nesta mesma transação, não duplicar
        if getattr(target, "_avaria_manual_registada", False):
            return
        
        # Se o código que iniciou a alteração definiu uma descrição customizada
        # no objecto (ex: atributo privado `_avaria_descricao`), usa-a.
        descricao = getattr(target, "_avaria_descricao", None) or "Avaria detetada via alteração de estado"

        # Verificar se já existe uma avaria aberta para este equipamento
        try:
            consulta = Avaria.__table__.select().where(
                Avaria.__table__.c.equipamento_id == target.id,
                Avaria.__table__.c.resolvida == False,
            )
            existente = connection.execute(consulta).first()
        except Exception:
            existente = None

        if existente:
            # Já existe uma avaria aberta — não criar duplicado.
            return

        # Inserção direta via connection para garantir que a operação faz parte
        # da mesma transacção SQL em curso (se suportado pelo engine).
        connection.execute(
            Avaria.__table__.insert().values(
                equipamento_id=target.id,
                descricao=descricao,
                data_registo=utc_now(),
                resolvida=False,
            )
        )
