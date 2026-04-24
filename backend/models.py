"""Modelos relacionais do dominio de gestao de laboratorio.

Este modulo consolida a camada de persistencia com SQLModel a pensar em
SQL Server 2022 Express, mantendo ao mesmo tempo compatibilidade suficiente
com o MVP atual durante a transicao a partir do Excel.
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

from sqlalchemy import Column, DateTime, Index, String, Float, event, update
from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    """Devolve a data/hora UTC atual.

    Returns:
        datetime: Instante UTC sem timezone explicito, alinhado com o
        comportamento atual do projeto.
    """

    return datetime.utcnow()


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
    """Estados operacionais possiveis para um equipamento."""

    DISPONIVEL = "Disponível"
    OCUPADO = "Ocupado"
    AVARIADO = "Avariado"
    MANUTENCAO = "Em manutenção"
    CALIBRACAO = "Em calibração"


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


class PrioridadeAvaria(str, Enum):
    """Niveis de severidade para apoiar triagem e SLA."""

    BAIXA = "Baixa"
    MEDIA = "Media"
    ALTA = "Alta"
    CRITICA = "Critica"


class Equipamento(SQLModel, table=True):
    """Representa um ativo fisico gerido pelo laboratorio.

    Notes:
        O equipamento e o pivot central do dominio. A maioria das entidades
        historicas depende desta tabela para garantir rastreabilidade
        operacional, tecnica e documental.
    """

    __tablename__ = "Equipamentos"
    __table_args__ = (
        Index("ix_equipamento_nome_localizacao", "nome", "localizacao"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
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
    temp_min: Optional[float] = Field(default=None, sa_column=Column("temp_min", Float))
    temp_max: Optional[float] = Field(default=None, sa_column=Column("temp_max", Float))
    humidade_max: Optional[float] = Field(default=None, sa_column=Column("humidade_max", Float))
    fabricante: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    modelo: Optional[str] = Field(default=None, sa_column=Column(String(120), index=True))
    ano_fabrico: Optional[int] = Field(default=None)
    potencia_kw: Optional[float] = Field(default=None)
    ligacao_eletrica: Optional[str] = Field(default=None, sa_column=Column(String(80)))
    corrente_a: Optional[float] = Field(default=None)
    voltagem_v: Optional[float] = Field(default=None)
    peso_kg: Optional[float] = Field(default=None)
    peso_max_kg: Optional[float] = Field(default=None)
    notas_tecnicas: Optional[str] = Field(default=None)
    # Armazenamos o estado como string no modelo para garantir que
    # valores vindos de clientes (ex.: 'Ocupado') são aceites sem
    # validação estrita por Enum no Pydantic/SQLModel.
    estado_atual: str = Field(
        default=EstadoEquipamento.DISPONIVEL.value,
        sa_column=Column(String(30), nullable=False, index=True),
    )
    foto_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    criado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime, nullable=False, index=True),
    )
    atualizado_em: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime, nullable=False),
    )

    # Porque: as relacoes nomeadas simplificam joins coerentes entre API,
    # exportacoes e futuras dashboards analiticas.
    sessoes: list["SessaoUso"] = Relationship(back_populates="equipamento")
    reservas: list["Reserva"] = Relationship(back_populates="equipamento")
    avarias: list["Avaria"] = Relationship(back_populates="equipamento")
    manutencoes: list["Manutencao"] = Relationship(back_populates="equipamento")
    calibracoes: list["Calibracao"] = Relationship(back_populates="equipamento")
    documentos: list["DocumentacaoEquipamento"] = Relationship(back_populates="equipamento")


class Utilizador(SQLModel, table=True):
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
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False))

    reservas: list["Reserva"] = Relationship(back_populates="utilizador_rel")
    sessoes: list["SessaoUso"] = Relationship(back_populates="utilizador_rel")
    avarias_reportadas: list["Avaria"] = Relationship(back_populates="reportado_por")
    manutencoes_executadas: list["Manutencao"] = Relationship(back_populates="executado_por")
    calibracoes_executadas: list["Calibracao"] = Relationship(back_populates="executado_por")
    documentos_carregados: list["DocumentacaoEquipamento"] = Relationship(back_populates="carregado_por")


class Avaria(SQLModel, table=True):
    """Regista falhas e o respetivo ciclo de vida tecnico."""

    __tablename__ = "Avarias"
    __table_args__ = (
        Index("ix_avaria_equipamento_resolvida", "equipamento_id", "resolvida"),
        Index("ix_avaria_data_prioridade", "data_registo", "prioridade"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    reportado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    descricao: str = Field(sa_column=Column("descricao", String, nullable=False))
    prioridade: PrioridadeAvaria = Field(
        default=PrioridadeAvaria.MEDIA,
        sa_column=Column(String(20), nullable=False, index=True),
    )
    data_registo: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False, index=True))
    resolvida: bool = Field(default=False, index=True)
    data_resolucao: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, index=True))
    notas_resolucao: Optional[str] = Field(default=None)

    equipamento: Optional[Equipamento] = Relationship(back_populates="avarias")
    reportado_por: Optional[Utilizador] = Relationship(back_populates="avarias_reportadas")


class Manutencao(SQLModel, table=True):
    """Historico de manutencao preventiva ou corretiva."""

    __tablename__ = "Manutencoes"
    __table_args__ = (
        Index("ix_manutencao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    descricao: str = Field(sa_column=Column("descricao", String, nullable=False))
    data_realizada: datetime = Field(sa_column=Column(DateTime, nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, index=True))
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="manutencoes")
    executado_por: Optional[Utilizador] = Relationship(back_populates="manutencoes_executadas")


class Calibracao(SQLModel, table=True):
    """Historico de calibracao com suporte a certificado e planeamento."""

    __tablename__ = "Calibracoes"
    __table_args__ = (
        Index("ix_calibracao_equipamento_data", "equipamento_id", "data_realizada"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    equipamento_id: int = Field(foreign_key="Equipamentos.id", index=True)
    executado_por_id: Optional[int] = Field(default=None, foreign_key="Utilizadores.id", index=True)
    data_realizada: datetime = Field(sa_column=Column(DateTime, nullable=False, index=True))
    periodicidade_dias: Optional[int] = Field(default=None, index=True)
    proxima_data: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, index=True))
    certificado_url: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    observacoes: Optional[str] = Field(default=None)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="calibracoes")
    executado_por: Optional[Utilizador] = Relationship(back_populates="calibracoes_executadas")


class DocumentacaoEquipamento(SQLModel, table=True):
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
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False, index=True))

    equipamento: Optional[Equipamento] = Relationship(back_populates="documentos")
    carregado_por: Optional[Utilizador] = Relationship(back_populates="documentos_carregados")


class Reserva(SQLModel, table=True):
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
    data_inicio: datetime = Field(sa_column=Column(DateTime, nullable=False, index=True))
    data_fim: datetime = Field(sa_column=Column(DateTime, nullable=False, index=True))
    notas: Optional[str] = Field(default=None)
    criado_em: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False))

    equipamento: Optional[Equipamento] = Relationship(back_populates="reservas")
    utilizador_rel: Optional[Utilizador] = Relationship(back_populates="reservas")
    sessoes: list["SessaoUso"] = Relationship(back_populates="reserva")


class SessaoUso(SQLModel, table=True):
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
    inicio: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime, nullable=False, index=True))
    fim: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, index=True))

    equipamento: Optional[Equipamento] = Relationship(back_populates="sessoes")
    reserva: Optional[Reserva] = Relationship(back_populates="sessoes")
    utilizador_rel: Optional[Utilizador] = Relationship(back_populates="sessoes")


@event.listens_for(Equipamento, "before_update")
def sincronizar_timestamp_equipamento(mapper, connection, target) -> None:
    """Atualiza o carimbo temporal de alteracao do equipamento.

    Porque: manter ``atualizado_em`` no servidor evita inconsistencias quando
    diferentes clientes ou scripts escrevem no mesmo registo.
    """

    del mapper, connection
    target.atualizado_em = utc_now()


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
def marcar_equipamento_como_nok(mapper, connection, target) -> None:
    """Forca o estado do equipamento para Avariado apos registo de avaria.

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
