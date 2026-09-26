"""
reancorar_dataset.py — Re-ancoragem temporal do dataset de demonstração.

⚠️ ALVO EXCLUSIVO: lab_assets_demo.db (cópia de teste, sem valor operacional).
   O script recusa-se a correr contra qualquer ficheiro cujo nome não seja
   literalmente 'lab_assets_demo.db' — Backend/lab_assets.db é a BD resolvida
   em runtime pela aplicação (confirmado por auditoria: utilizadores reais,
   sem marcadores de demo, reservas recentes criadas pela app) e não deve ser
   tocada por este script.

Toda a escrita é feita via ORM (session.add / setattr), nunca via update()
Core, para que os listeners registados em app/models/*.py (incluindo
app/models/events.py) disparem exactamente como disparariam em produção.

Modos:
  --dry-run   (omissão) Mostra o plano linha a linha. Não escreve nada.
  --aplicar   Faz checkpoint do WAL + cópia de segurança timestamped,
              aplica as etapas A–H numa única transacção, valida os
              invariantes e as métricas, e só então dá commit. Qualquer
              falha de validação despoleta rollback total.

Etapa I (activa por omissão, --no-reconciliar-orfaos desliga):
  Equipamentos 'Avariado' sem avaria aberta pré-existentes nesta cópia (ex.:
  T1C-0026) não estão fisicamente avariados — o estado é resíduo de importação
  anterior ao listener de app/models/events.py. Corrige-se via ORM
  (eq.estado_atual = 'Disponível'), sem criar nenhuma Avaria.

Etapa D/E — ligação Reserva↔SessaoUso:
  SessaoUso não tem reserva_id por desenho (Reserva=planeado, SessaoUso=real,
  independentes, para medir desvio planeado-vs-real). O emparelhamento para
  garantir cobertura de OEE é feito por equipamento_id + sobreposição
  temporal, nunca por FK, com ocupação (Σ duração sessões / duração decorrida
  da reserva) mantida em [60%, 85%] para evitar oee_pct=0% ou saturação a 100%.
"""

from __future__ import annotations

import argparse
import logging
import random
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import create_engine  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.models import (  # noqa: E402
    Avaria,
    Calibracao,
    Equipamento,
    EstadoEquipamento,
    Manutencao,
    Reserva,
    SessaoUso,
    calcular_proxima_data,
    utc_now,
)
from app.services.oee_service import (  # noqa: E402
    calcular_mtbf_mttr,
    calcular_oee_temporal,
    calcular_tempo_disponivel_s,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("reancorar_dataset")

DB_DEMO_DEFAULT = BACKEND_ROOT / "lab_assets_demo.db"
NOME_FICHEIRO_PERMITIDO = "lab_assets_demo.db"

DELTA_CLUSTER_DIAS = 50
RESERVA_ID_EXCLUIR = 10  # não existe nesta cópia demo; mantido por fidelidade à spec
JANELA_REDISTRIBUICAO_DIAS_MIN = 28
JANELA_REDISTRIBUICAO_DIAS_MAX = 1
CATEGORIAS_A_COBRIR = {"Câmara Choque Térmico", "Forno", "Salina"}
CATEGORIAS_TRACKADAS_DASHBOARD = {"Câmara Climática", "Câmara Choque Térmico", "Forno", "Salina"}
RATIO_OCUPACAO_MIN = 0.60
RATIO_OCUPACAO_MAX = 0.85


class PlanoAlteracoes:
    """Acumula uma descrição textual do que cada etapa faz — usado no --dry-run."""

    def __init__(self) -> None:
        self.linhas: list[str] = []

    def registar(self, etapa: str, descricao: str) -> None:
        self.linhas.append(f"[{etapa}] {descricao}")
        logger.info("[%s] %s", etapa, descricao)

    def imprimir(self) -> None:
        print("\n===== PLANO DE ALTERAÇÕES =====")
        for linha in self.linhas:
            print(linha)
        print(f"===== FIM DO PLANO ({len(self.linhas)} linhas) =====\n")


def etapa_a_deslocar_cluster(sess: Session, delta: timedelta, plano: PlanoAlteracoes, aplicar: bool) -> None:
    """Desloca +delta o cluster antigo: SessoesUso, Avarias, Manutencoes, Reservas (exceto id=RESERVA_ID_EXCLUIR)."""

    sessoes = sess.exec(select(SessaoUso)).all()
    for s in sessoes:
        novo_inicio = s.inicio + delta
        novo_fim = s.fim + delta if s.fim is not None else None
        plano.registar(
            "A",
            f"SessaoUso id={s.id} equip={s.equipamento_id}: inicio {s.inicio} -> {novo_inicio}"
            + (f" | fim {s.fim} -> {novo_fim}" if s.fim is not None else " | fim NULL (preservado)"),
        )
        if aplicar:
            s.inicio = novo_inicio
            s.fim = novo_fim
            sess.add(s)

    avarias = sess.exec(select(Avaria)).all()
    for a in avarias:
        novo_registo = a.data_registo + delta
        nova_resolucao = a.data_resolucao + delta if a.data_resolucao is not None else None
        plano.registar(
            "A",
            f"Avaria id={a.id} equip={a.equipamento_id}: data_registo {a.data_registo} -> {novo_registo}"
            + (
                f" | data_resolucao {a.data_resolucao} -> {nova_resolucao}"
                if a.data_resolucao is not None
                else " | data_resolucao NULL (preservado)"
            ),
        )
        if aplicar:
            a.data_registo = novo_registo
            a.data_resolucao = nova_resolucao
            sess.add(a)

    manutencoes = sess.exec(select(Manutencao)).all()
    for m in manutencoes:
        nova_data = m.data_realizada + delta
        plano.registar(
            "A", f"Manutencao id={m.id} equip={m.equipamento_id}: data_realizada {m.data_realizada} -> {nova_data}"
        )
        if aplicar:
            m.data_realizada = nova_data
            sess.add(m)

    reservas = sess.exec(select(Reserva)).all()
    for r in reservas:
        if r.id == RESERVA_ID_EXCLUIR:
            plano.registar("A", f"Reserva id={r.id}: EXCLUÍDA do deslocamento (regra explícita)")
            continue
        novo_inicio = r.data_inicio + delta
        novo_fim = r.data_fim + delta
        plano.registar(
            "A", f"Reserva id={r.id} equip={r.equipamento_id}: data_inicio {r.data_inicio} -> {novo_inicio} | "
            f"data_fim {r.data_fim} -> {novo_fim}"
        )
        if aplicar:
            r.data_inicio = novo_inicio
            r.data_fim = novo_fim
            sess.add(r)

    if aplicar:
        sess.flush()


def etapa_b_recalcular_proxima_data_manutencao(sess: Session, plano: PlanoAlteracoes, aplicar: bool) -> None:
    manutencoes = sess.exec(select(Manutencao)).all()
    for m in manutencoes:
        if m.periodicidade_dias is not None:
            nova_proxima = calcular_proxima_data(
                data_realizada=m.data_realizada, periodicidade_dias=m.periodicidade_dias
            )
            plano.registar(
                "B",
                f"Manutencao id={m.id}: periodicidade_dias={m.periodicidade_dias} -> "
                f"proxima_data {m.proxima_data} -> {nova_proxima}",
            )
            if aplicar:
                m.proxima_data = nova_proxima
                sess.add(m)
        else:
            plano.registar("B", f"Manutencao id={m.id}: periodicidade_dias NULL -> proxima_data mantida ({m.proxima_data})")

    if aplicar:
        sess.flush()


def etapa_c_reposicionar_avarias_abertas(sess: Session, agora: datetime, plano: PlanoAlteracoes, aplicar: bool) -> None:
    abertas = sess.exec(select(Avaria).where(Avaria.resolvida == False)).all()  # noqa: E712
    if len(abertas) != 2:
        plano.registar(
            "C",
            f"AVISO: esperava exactamente 2 avarias abertas, encontrei {len(abertas)} "
            f"(ids={[a.id for a in abertas]}). A repor todas na ordem cronológica disponível.",
        )
    abertas.sort(key=lambda a: a.data_registo)

    alvos = [agora - timedelta(days=11), agora - timedelta(days=4)]
    for idx, a in enumerate(abertas):
        novo_registo = alvos[idx] if idx < len(alvos) else agora - timedelta(days=4)
        plano.registar(
            "C",
            f"Avaria id={a.id} (aberta) equip={a.equipamento_id}: data_registo {a.data_registo} -> {novo_registo}",
        )
        if aplicar:
            a.data_registo = novo_registo
            sess.add(a)

    if aplicar:
        sess.flush()


def etapa_d_redistribuir_sessoes(sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool) -> None:
    """Redistribui SessoesUso concluídas na janela e garante que cada equipamento
    com sessões tem uma Reserva já iniciada (data_inicio < agora) que as cobre.

    Emparelhamento por equipamento_id + sobreposição temporal — NUNCA por FK
    (SessaoUso.reserva_id é, por desenho, independente de Reserva: permite medir
    o desvio planeado-vs-real). A Reserva candidata é ajustada, nunca a sessão
    (cuja duração já foi preservada acima), para que
    Σ duração das sessões do equipamento / duração decorrida da reserva
    caia em [60%, 85%] — evita tanto saturação (100%) como oee_pct=0%.
    """
    concluidas = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_not(None))).all()
    concluidas.sort(key=lambda s: s.inicio)
    n = len(concluidas)
    if n == 0:
        plano.registar("D", "Sem sessões concluídas para redistribuir.")
        return

    janela_inicio = agora - timedelta(days=JANELA_REDISTRIBUICAO_DIAS_MIN)
    janela_fim = agora - timedelta(days=JANELA_REDISTRIBUICAO_DIAS_MAX)
    intervalo_total = (janela_fim - janela_inicio).total_seconds()
    passo = intervalo_total / max(n - 1, 1)

    for idx, s in enumerate(concluidas):
        duracao = s.fim - s.inicio
        jitter_s = rng.uniform(-passo * 0.15, passo * 0.15) if n > 1 else 0.0
        novo_inicio = janela_inicio + timedelta(seconds=idx * passo + jitter_s)
        novo_inicio = max(janela_inicio, min(novo_inicio, janela_fim))
        novo_fim = novo_inicio + duracao

        plano.registar(
            "D",
            f"SessaoUso id={s.id} equip={s.equipamento_id}: inicio {s.inicio} -> {novo_inicio} | "
            f"fim {s.fim} -> {novo_fim} (duração preservada: {duracao})",
        )
        if aplicar:
            s.inicio = novo_inicio
            s.fim = novo_fim
            sess.add(s)

    if aplicar:
        sess.flush()

    # Agrupa por equipamento: uma Reserva por equipamento é ajustada para cobrir
    # o envelope [min(inicio), max(fim)] de todas as suas sessões concluídas,
    # com ocupação (soma das durações / duração decorrida da reserva) em [60%,85%].
    por_equip: dict[int, list[SessaoUso]] = defaultdict(list)
    for s in concluidas:
        por_equip[s.equipamento_id].append(s)

    for equip_id, lista_sessoes in por_equip.items():
        envelope_inicio = min(s.inicio for s in lista_sessoes)
        envelope_fim = max(s.fim for s in lista_sessoes)
        soma_duracao_s = sum((s.fim - s.inicio).total_seconds() for s in lista_sessoes)

        reservas_equip = sess.exec(select(Reserva).where(Reserva.equipamento_id == equip_id)).all()
        candidata = next(
            (r for r in reservas_equip if r.data_inicio <= envelope_fim and r.data_fim >= envelope_inicio),
            None,
        )
        if candidata is None and reservas_equip:
            candidata = min(reservas_equip, key=lambda r: abs((r.data_inicio - envelope_inicio).total_seconds()))
        if candidata is None:
            plano.registar(
                "D",
                f"Equipamento id={equip_id}: {len(lista_sessoes)} sessão(ões) concluída(s) mas SEM nenhuma "
                f"Reserva para este equipamento — sem cobertura possível.",
            )
            continue

        antes_inicio, antes_fim = candidata.data_inicio, candidata.data_fim
        if candidata.data_fim < envelope_fim:
            candidata.data_fim = envelope_fim

        ratio = rng.uniform(RATIO_OCUPACAO_MIN, RATIO_OCUPACAO_MAX)
        elapsed_alvo_s = soma_duracao_s / ratio
        fim_efetivo = min(agora, candidata.data_fim)
        novo_inicio_reserva = fim_efetivo - timedelta(seconds=elapsed_alvo_s)
        novo_inicio_reserva = min(novo_inicio_reserva, envelope_inicio)
        candidata.data_inicio = novo_inicio_reserva

        elapsed_real_s = (fim_efetivo - candidata.data_inicio).total_seconds()
        ratio_real = (soma_duracao_s / elapsed_real_s) if elapsed_real_s > 0 else None

        plano.registar(
            "D",
            f"Reserva id={candidata.id} equip={equip_id} ajustada para cobrir {len(lista_sessoes)} sessão(ões) "
            f"(soma duração={soma_duracao_s / 3600:.1f}h): data_inicio {antes_inicio} -> {candidata.data_inicio} | "
            f"data_fim {antes_fim} -> {candidata.data_fim} | "
            f"ocupação real={'%.1f%%' % (ratio_real * 100) if ratio_real is not None else 'N/D'}",
        )
        if aplicar:
            sess.add(candidata)

    if aplicar:
        sess.flush()


def etapa_e_complementar_cobertura(
    sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool
) -> None:
    """Cria pares Reserva+SessaoUso (nunca sessões isoladas) para equipamentos das
    categorias Câmaras de Choque / Fornos / Salinas ainda sem qualquer sessão.

    Reserva: data_inicio no passado [now-28d, now-2d], duração 8-96h, já
    decorrida (data_fim <= agora). SessaoUso: sobreposta à reserva, com duração
    = [60%,85%] × duração decorrida da reserva — evita tanto oee_pct=0% (sem
    sessão) como saturação a 100% (sessão a preencher toda a reserva).
    """
    equipamentos = sess.exec(select(Equipamento)).all()
    sessoes = sess.exec(select(SessaoUso)).all()
    equip_com_sessao = {s.equipamento_id for s in sessoes}

    from app.models.utilizador import Utilizador

    user = sess.exec(select(Utilizador).where(Utilizador.ativo == True)).first()  # noqa: E712
    if user is None:
        plano.registar("E", "AVISO: sem utilizador activo — etapa E ignorada.")
        return

    alvo = [
        e for e in equipamentos if e.tipo in CATEGORIAS_A_COBRIR and e.id not in equip_com_sessao
    ]
    if not alvo:
        plano.registar("E", "Nenhum equipamento das categorias-alvo sem sessão — nada a complementar.")
        return

    for eq in alvo:
        duracao_reserva_h = rng.uniform(8, 96)
        reserva_inicio = agora - timedelta(
            days=rng.uniform(JANELA_REDISTRIBUICAO_DIAS_MAX + 1, JANELA_REDISTRIBUICAO_DIAS_MIN)
        )
        reserva_fim = reserva_inicio + timedelta(hours=duracao_reserva_h)
        if reserva_fim > agora:
            reserva_fim = agora  # a reserva tem de estar já iniciada e decorrida

        elapsed_s = (reserva_fim - reserva_inicio).total_seconds()
        ratio = rng.uniform(RATIO_OCUPACAO_MIN, RATIO_OCUPACAO_MAX)
        duracao_sessao_s = elapsed_s * ratio
        folga_s = max(elapsed_s - duracao_sessao_s, 0.0)
        offset_s = rng.uniform(0, folga_s)
        sessao_inicio = reserva_inicio + timedelta(seconds=offset_s)
        sessao_fim = sessao_inicio + timedelta(seconds=duracao_sessao_s)

        estado_original = eq.estado_atual
        plano.registar(
            "E",
            f"Equipamento id={eq.id} codigo={eq.codigo} tipo={eq.tipo}: criar Reserva "
            f"({reserva_inicio} -> {reserva_fim}, já iniciada e decorrida) + SessaoUso sobreposta "
            f"({sessao_inicio} -> {sessao_fim}, ocupação {ratio * 100:.1f}% da reserva decorrida) | "
            f"estado_atual será forçado a 'Ocupado' pelo listener SessaoUso.after_insert — "
            f"reposto a '{estado_original}' no fim da etapa",
        )

        if aplicar:
            reserva = Reserva(
                equipamento_id=eq.id,
                utilizador_id=user.id,
                projeto="Cobertura-Categoria",
                metodo="Ensaio",
                data_inicio=reserva_inicio,
                data_fim=reserva_fim,
                notas="Reserva gerada para garantir cobertura de OEE por categoria (reancoragem dataset demo).",
                concluido_com_sucesso=True,
            )
            sess.add(reserva)
            sess.flush()  # obter reserva.id

            sessao = SessaoUso(
                equipamento_id=eq.id,
                reserva_id=reserva.id,
                utilizador_id=user.id,
                utilizador=user.nome,
                inicio=sessao_inicio,
                fim=sessao_fim,
                projeto="Cobertura-Categoria",
                metodo="Ensaio",
            )
            sess.add(sessao)
            sess.flush()  # dispara after_insert -> força estado_atual='Ocupado' via Core update

            # O Core update acima não passa pelo identity map: o objecto `eq` em
            # memória continua com o valor antigo. Sem sess.refresh(), atribuir
            # estado_original (igual ao valor que o ORM pensa já ter) não gera
            # nenhuma alteração dirty e o UPDATE de reposição nunca seria emitido
            # (mesma armadilha documentada em seed_demo_poster.aplicar_estados_finais).
            sess.refresh(eq)
            eq.estado_atual = estado_original
            sess.add(eq)
            sess.flush()

    if aplicar:
        sess.flush()


def etapa_f_sessao_ativa(sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool) -> None:
    ativa = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_(None))).first()
    horas_atras = rng.uniform(6, 10)
    novo_inicio = agora - timedelta(hours=horas_atras)

    if ativa is not None:
        plano.registar(
            "F",
            f"SessaoUso id={ativa.id} equip={ativa.equipamento_id} já activa (fim IS NULL): "
            f"inicio {ativa.inicio} -> {novo_inicio} (~{horas_atras:.1f}h atrás)",
        )
        eq = sess.get(Equipamento, ativa.equipamento_id)
        if eq is not None and eq.estado_atual != EstadoEquipamento.OCUPADO.value:
            plano.registar("F", f"Equipamento id={eq.id} estado_atual '{eq.estado_atual}' -> 'Ocupado' (coerência com sessão activa)")
            if aplicar:
                eq.estado_atual = EstadoEquipamento.OCUPADO.value
                sess.add(eq)
        if aplicar:
            ativa.inicio = novo_inicio
            sess.add(ativa)
            sess.flush()
        return

    # Não existe nenhuma sessão activa — criar uma nova num equipamento disponível.
    from app.models.utilizador import Utilizador

    user = sess.exec(select(Utilizador).where(Utilizador.ativo == True)).first()  # noqa: E712
    candidato = sess.exec(
        select(Equipamento).where(Equipamento.estado_atual == EstadoEquipamento.DISPONIVEL.value)
    ).first()
    if user is None or candidato is None:
        plano.registar("F", "AVISO: sem utilizador activo ou equipamento disponível — não foi possível criar sessão activa.")
        return

    plano.registar(
        "F",
        f"Nenhuma sessão activa encontrada — criar SessaoUso em equip id={candidato.id} "
        f"codigo={candidato.codigo}, inicio={novo_inicio} (~{horas_atras:.1f}h atrás), fim=NULL",
    )
    if aplicar:
        sessao = SessaoUso(
            equipamento_id=candidato.id,
            utilizador_id=user.id,
            utilizador=user.nome,
            inicio=novo_inicio,
            fim=None,
            projeto="Cobertura-Categoria",
            metodo="Ensaio",
        )
        sess.add(sessao)
        sess.flush()  # after_insert força 'Ocupado' — é exactamente o estado desejado aqui


def etapa_g_calibracoes(sess: Session, agora: datetime, plano: PlanoAlteracoes, aplicar: bool) -> None:
    calibracoes = sess.exec(select(Calibracao)).all()
    calibracoes.sort(key=lambda c: c.id)

    alvos = [agora - timedelta(days=5), agora + timedelta(days=9), agora + timedelta(days=21)]
    rotulos = ["vencida (now-5d)", "a vencer (now+9d)", "a vencer (now+21d)"]

    for idx, c in enumerate(calibracoes):
        if idx < len(alvos):
            novo_valor = alvos[idx]
            rotulo = rotulos[idx]
        else:
            novo_valor = agora + timedelta(days=46)
            rotulo = "restante (>now+45d)"
        plano.registar("G", f"Calibracao id={c.id} equip={c.equipamento_id}: proxima_data {c.proxima_data} -> {novo_valor} [{rotulo}]")
        if aplicar:
            c.proxima_data = novo_valor
            sess.add(c)

    if aplicar:
        sess.flush()


def etapa_h_custos_reparacao(sess: Session, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool) -> None:
    resolvidas_sem_custo = sess.exec(
        select(Avaria).where(Avaria.resolvida == True, Avaria.custo_reparacao.is_(None))  # noqa: E712
    ).all()
    if not resolvidas_sem_custo:
        plano.registar("H", "Nenhuma avaria resolvida com custo_reparacao NULL — nada a preencher.")
        return
    for a in resolvidas_sem_custo:
        custo = round(rng.uniform(150, 1800), 2)
        plano.registar("H", f"Avaria id={a.id} equip={a.equipamento_id}: custo_reparacao NULL -> {custo} EUR")
        if aplicar:
            a.custo_reparacao = custo
            sess.add(a)

    if aplicar:
        sess.flush()


def etapa_i_reconciliar_orfaos(sess: Session, plano: PlanoAlteracoes, aplicar: bool) -> None:
    """Corrige equipamentos 'Avariado' sem avaria aberta pré-existentes nesta cópia
    (ex.: T1C-0026). O equipamento não está fisicamente avariado — o estado é
    resíduo de importação anterior à existência do listener em events.py, não
    uma avaria real. Corrige via ORM (setattr + session.add), SEM criar Avaria:
        eq.estado_atual = 'Disponível'
    Não toca em mais nenhum equipamento nem cria qualquer outro registo.
    """
    orfaos = sess.exec(select(Equipamento).where(Equipamento.estado_atual == "Avariado")).all()
    orfaos = [
        e
        for e in orfaos
        if not sess.exec(
            select(Avaria).where(Avaria.equipamento_id == e.id, Avaria.resolvida == False)  # noqa: E712
        ).first()
    ]
    if not orfaos:
        plano.registar("I", "Sem equipamentos órfãos (Avariado sem avaria aberta).")
        return

    for eq in orfaos:
        plano.registar(
            "I",
            f"Equipamento id={eq.id} codigo={eq.codigo}: 'Avariado' sem avaria aberta (resíduo de importação, "
            f"não é avaria real) -> estado_atual = 'Disponível' (via ORM, sem criar Avaria)",
        )
        if aplicar:
            eq.estado_atual = EstadoEquipamento.DISPONIVEL.value
            sess.add(eq)

    if aplicar:
        sess.flush()


# ───────────────────────── Validação ─────────────────────────


def validar_invariantes(sess: Session) -> dict[str, list]:
    resultados: dict[str, list] = {}

    resultados["a) Avariado sem avaria aberta"] = sess.exec(
        select(Equipamento).where(Equipamento.estado_atual == "Avariado")
    ).all()
    resultados["a) Avariado sem avaria aberta"] = [
        e
        for e in resultados["a) Avariado sem avaria aberta"]
        if not sess.exec(
            select(Avaria).where(Avaria.equipamento_id == e.id, Avaria.resolvida == False)  # noqa: E712
        ).first()
    ]

    abertas = sess.exec(select(Avaria).where(Avaria.resolvida == False)).all()  # noqa: E712
    resultados["b) avaria aberta sem Avariado"] = [
        a for a in abertas if (sess.get(Equipamento, a.equipamento_id).estado_atual != "Avariado")
    ]

    ocupados = sess.exec(select(Equipamento).where(Equipamento.estado_atual == "Ocupado")).all()
    resultados["c) Ocupado sem sessao activa"] = [
        e
        for e in ocupados
        if not sess.exec(
            select(SessaoUso).where(SessaoUso.equipamento_id == e.id, SessaoUso.fim.is_(None))
        ).first()
    ]

    ativas = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_(None))).all()
    resultados["d) sessao activa sem Ocupado"] = [
        s for s in ativas if sess.get(Equipamento, s.equipamento_id).estado_atual != "Ocupado"
    ]

    todas_sessoes = sess.exec(select(SessaoUso)).all()
    resultados["e) sessoes com inicio > fim"] = [
        s for s in todas_sessoes if s.fim is not None and s.inicio > s.fim
    ]

    # (f) removido por decisão: SessaoUso não tem reserva_id por desenho —
    # Reserva (planeado) e SessaoUso (real) são independentes, para permitir
    # medir o desvio planeado-vs-real. Não faz sentido como invariante.

    todas_reservas = sess.exec(select(Reserva)).all()
    sobrepostas = []
    por_equip: dict[int, list[Reserva]] = defaultdict(list)
    for r in todas_reservas:
        por_equip[r.equipamento_id].append(r)
    for equip_id, lista in por_equip.items():
        lista.sort(key=lambda r: r.data_inicio)
        for i in range(len(lista) - 1):
            for j in range(i + 1, len(lista)):
                if lista[i].data_inicio < lista[j].data_fim and lista[j].data_inicio < lista[i].data_fim:
                    sobrepostas.append((lista[i].id, lista[j].id))
    resultados["g) reservas sobrepostas"] = sobrepostas

    todas_avarias = sess.exec(select(Avaria)).all()
    resultados["h) data_resolucao < data_registo"] = [
        a for a in todas_avarias if a.data_resolucao is not None and a.data_resolucao < a.data_registo
    ]

    return resultados


def validar_metricas(sess: Session, agora: datetime) -> dict:
    mtbf_mttr = calcular_mtbf_mttr(sess, 30)

    dias = 30
    limite = agora - timedelta(days=dias)
    equipamentos = sess.exec(select(Equipamento)).all()
    reservas_periodo = sess.exec(select(Reserva).where(Reserva.data_inicio >= limite)).all()
    sessoes_periodo = sess.exec(select(SessaoUso).where(SessaoUso.inicio >= limite)).all()

    sessoes_por_eq: dict[int, list] = defaultdict(list)
    for s in sessoes_periodo:
        sessoes_por_eq[s.equipamento_id].append(s)
    sessoes_ativas_pre = sess.exec(
        select(SessaoUso).where(SessaoUso.fim.is_(None), SessaoUso.inicio < limite)
    ).all()
    for s in sessoes_ativas_pre:
        sessoes_por_eq[s.equipamento_id].append(s)

    avarias_periodo = sess.exec(select(Avaria).where(Avaria.data_registo < agora)).all()

    individual = []
    oee_com_dados = []
    equip_sem_oee_com_sessao = []
    for eq in equipamentos:
        sessoes_eq = sessoes_por_eq.get(eq.id, [])
        tempo_disponivel_s = calcular_tempo_disponivel_s(eq.id, avarias_periodo, limite, agora, agora)
        tempo_real_s = 0.0
        for s in sessoes_eq:
            fim_efetivo = s.fim if s.fim is not None else agora
            tempo_real_s += max(0.0, (fim_efetivo - s.inicio).total_seconds())
        oee_pct = calcular_oee_temporal(tempo_real_s, tempo_disponivel_s)
        if oee_pct is not None:
            oee_com_dados.append(oee_pct)
        elif sessoes_eq:
            equip_sem_oee_com_sessao.append(eq.id)
        individual.append({"id": eq.id, "codigo": eq.codigo, "tipo": eq.tipo, "oee_pct": oee_pct})

    oee_global = round(sum(oee_com_dados) / len(oee_com_dados), 1) if oee_com_dados else None

    por_categoria: dict[str, list] = defaultdict(list)
    for item in individual:
        if item["tipo"] in CATEGORIAS_TRACKADAS_DASHBOARD and item["oee_pct"] is not None:
            por_categoria[item["tipo"]].append(item["oee_pct"])
    media_por_categoria = {
        tipo: round(sum(vals) / len(vals), 1) for tipo, vals in por_categoria.items()
    }

    saturados = [i for i in individual if i["oee_pct"] == 100.0]

    return {
        "mtbf_h": mtbf_mttr["mtbf_h"],
        "mttr_h": mtbf_mttr["mttr_h"],
        "oee_global": oee_global,
        "individual": individual,
        "media_por_categoria": media_por_categoria,
        "oee_max": max((i["oee_pct"] for i in individual if i["oee_pct"] is not None), default=None),
        "oee_min": min((i["oee_pct"] for i in individual if i["oee_pct"] is not None), default=None),
        "oee_mean": round(sum(oee_com_dados) / len(oee_com_dados), 1) if oee_com_dados else None,
        "equip_sem_oee_com_sessao": equip_sem_oee_com_sessao,
        "saturados": saturados,
    }


def relatar_validacao(invariantes: dict[str, list], metricas: dict) -> bool:
    print("\n===== VALIDAÇÃO DE INVARIANTES =====")
    ok_geral = True
    for nome, violacoes in invariantes.items():
        n = len(violacoes)
        estado = "OK" if n == 0 else "FALHA"
        if n != 0:
            ok_geral = False
        print(f"{estado:<6} {nome}: {n} violação(ões)")
        for v in violacoes[:10]:
            print("   ", v)

    print("\n===== VALIDAÇÃO DE MÉTRICAS =====")
    print(f"mtbf_h = {metricas['mtbf_h']}")
    print(f"mttr_h = {metricas['mttr_h']}")
    print(f"oee_global = {metricas['oee_global']}")
    print(f"oee_pct individuais: min={metricas['oee_min']}  max={metricas['oee_max']}  média={metricas['oee_mean']}")
    print("media_por_categoria =")
    for cat in sorted(CATEGORIAS_TRACKADAS_DASHBOARD):
        val = metricas["media_por_categoria"].get(cat)
        print(f"   {cat}: {val}")

    if metricas["mtbf_h"] is None or metricas["mtbf_h"] <= 0:
        print("FALHA: mtbf_h tem de ser não-None e > 0")
        ok_geral = False
    if metricas["mttr_h"] is None or metricas["mttr_h"] <= 0:
        print("FALHA: mttr_h tem de ser não-None e > 0")
        ok_geral = False
    if metricas["oee_global"] is None:
        print("FALHA: oee_global tem de ser não-None")
        ok_geral = False
    for cat in CATEGORIAS_TRACKADAS_DASHBOARD:
        if metricas["media_por_categoria"].get(cat) in (None, 0.0):
            print(f"FALHA: categoria '{cat}' a 0%/sem dados")
            ok_geral = False
    if metricas["oee_max"] is not None and metricas["oee_max"] > 100:
        print("FALHA: existe oee_pct > 100")
        ok_geral = False
    if metricas["equip_sem_oee_com_sessao"]:
        print(f"FALHA: equipamentos com sessão na janela mas oee_pct=None: {metricas['equip_sem_oee_com_sessao']}")
        ok_geral = False
    if metricas["saturados"]:
        print(
            "AVISO (saturação, não bloqueante por si só — ver banda 60-85% da Etapa D/E): "
            f"{[(i['id'], i['codigo']) for i in metricas['saturados']]}"
        )

    print(f"\n===== RESULTADO GERAL: {'SUCESSO' if ok_geral else 'FALHA — ROLLBACK OBRIGATÓRIO'} =====\n")
    return ok_geral


# ───────────────────────── Backup / pré-requisito ─────────────────────────


def checkpoint_e_backup(db_path: Path) -> Path:
    logger.warning(
        "Confirma que a aplicação está parada antes de continuar — este script não a consegue parar por si."
    )
    engine_tmp = create_engine(f"sqlite:///{db_path}")
    with engine_tmp.connect() as conn:
        conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    engine_tmp.dispose()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    backup_path = db_path.with_name(f"{db_path.stem}_{timestamp}.bak")
    try:
        shutil.copy2(db_path, backup_path)
    except OSError as exc:
        logger.error("Cópia de segurança falhou: %s — a abortar sem escrever.", exc)
        sys.exit(1)

    for extensao in ("-wal", "-shm"):
        origem = db_path.with_name(db_path.name + extensao)
        if origem.exists():
            destino = backup_path.with_name(backup_path.name + extensao)
            try:
                shutil.copy2(origem, destino)
            except OSError as exc:
                logger.error("Cópia de %s falhou: %s — a abortar sem escrever.", origem, exc)
                sys.exit(1)

    logger.info("Cópia de segurança criada em %s", backup_path)
    return backup_path


# ───────────────────────── main ─────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Re-ancoragem temporal do dataset de demonstração.")
    parser.add_argument("--aplicar", action="store_true", help="Aplica as alterações (omissão: dry-run).")
    parser.add_argument("--db", type=Path, default=DB_DEMO_DEFAULT, help="Caminho da BD alvo.")
    parser.add_argument("--seed", type=int, default=42, help="Seed do RNG para reprodutibilidade.")
    parser.add_argument(
        "--reconciliar-orfaos",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Etapa I: repõe estado_atual='Disponível' em equipamentos 'Avariado' sem avaria "
        "aberta pré-existentes (sem criar Avaria). Omissão: activo. Usar --no-reconciliar-orfaos para desligar.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.db.name != NOME_FICHEIRO_PERMITIDO:
        logger.error(
            "Recusa a correr contra '%s' — este script só aceita '%s' (cópia de demonstração).",
            args.db.name, NOME_FICHEIRO_PERMITIDO,
        )
        sys.exit(1)
    if not args.db.exists():
        logger.error("BD não encontrada em %s", args.db)
        sys.exit(1)

    rng = random.Random(args.seed)
    agora = utc_now()
    delta = timedelta(days=DELTA_CLUSTER_DIAS)
    plano = PlanoAlteracoes()

    if args.aplicar:
        checkpoint_e_backup(args.db)

    engine = create_engine(f"sqlite:///{args.db}", connect_args={"check_same_thread": False})

    with Session(engine) as sess:
        try:
            etapa_a_deslocar_cluster(sess, delta, plano, args.aplicar)
            etapa_b_recalcular_proxima_data_manutencao(sess, plano, args.aplicar)
            etapa_c_reposicionar_avarias_abertas(sess, agora, plano, args.aplicar)
            etapa_d_redistribuir_sessoes(sess, agora, rng, plano, args.aplicar)
            etapa_e_complementar_cobertura(sess, agora, rng, plano, args.aplicar)
            etapa_f_sessao_ativa(sess, agora, rng, plano, args.aplicar)
            etapa_g_calibracoes(sess, agora, plano, args.aplicar)
            etapa_h_custos_reparacao(sess, rng, plano, args.aplicar)

            if args.reconciliar_orfaos:
                etapa_i_reconciliar_orfaos(sess, plano, args.aplicar)
            else:
                plano.registar(
                    "I (desligada)",
                    "--no-reconciliar-orfaos: equipamento 'Avariado' sem avaria aberta pré-existente "
                    "(T1C-0026 / id=2) não será corrigido — o invariante (a) vai reportar 1 violação.",
                )

            plano.imprimir()

            if not args.aplicar:
                print("Modo --dry-run: nenhuma escrita foi feita. Nada para validar ainda.")
                sess.rollback()
                return

            # Ainda dentro da transacção: validar antes de decidir commit/rollback.
            sess.flush()
            invariantes = validar_invariantes(sess)
            metricas = validar_metricas(sess, agora)
            sucesso = relatar_validacao(invariantes, metricas)

            if sucesso:
                sess.commit()
                print("COMMIT efectuado. Alterações persistidas em", args.db)
            else:
                sess.rollback()
                print("ROLLBACK efectuado — critérios de validação falharam. Nenhuma alteração foi persistida.")
                sys.exit(1)

        except Exception:
            sess.rollback()
            logger.exception("Excepção não tratada — rollback total efectuado.")
            raise


if __name__ == "__main__":
    main()
