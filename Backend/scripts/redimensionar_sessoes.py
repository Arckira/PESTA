"""
redimensionar_sessoes.py — Redimensiona SessoesUso concluídas para a escala
real de ensaios ambientais (semanas, não horas) na cópia de demonstração.

PASSO 0 (confirmado por leitura de código antes de escrever este script,
ver Backend/app/routers/stats.py:21,63,131,208,331 e
Backend/app/services/oee_service.py:41,108):

  O dashboard (/stats/oee_summary, /dashboard/oee, /stats/oee_historico) e o
  detalhe de equipamento usam SEMPRE calcular_tempo_disponivel_s() —
  janela_total menos downtime de avarias. Reservas NÃO entram nesta conta.
  Existe uma segunda função, calcular_metricas_uso() (oee_service.py:27),
  usada apenas em routers/sessoes.py:352 (endpoint /equipamentos/{id}/eficiencia)
  para uma métrica diferente (eficiencia_pct/taxa_sucesso_planeamento,
  baseada em reservas). Não é código morto, mas não é o motor de OEE do
  dashboard. Logo: as Reservas só precisam de CONTER a sessão em termos de
  calendário — não afectam oee_pct.

⚠️ ALVO EXCLUSIVO: lab_assets_demo.db — mesma verificação de abspath
   bloqueante da versão anterior. Backend/lab_assets.db nunca é tocado.

Toda a escrita via ORM. Transacção única, validação obrigatória antes do
commit, rollback total em qualquer falha.

Modos: --dry-run (omissão, mostra tabela antes/depois) | --aplicar
"""

from __future__ import annotations

import argparse
import logging
import random
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import create_engine  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.models import Avaria, Equipamento, Reserva, SessaoUso, utc_now  # noqa: E402
from app.services.oee_service import (  # noqa: E402
    calcular_mtbf_mttr,
    calcular_oee_temporal,
    calcular_tempo_disponivel_s,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("redimensionar_sessoes")

DB_DEMO_DEFAULT = BACKEND_ROOT / "lab_assets_demo.db"
NOME_FICHEIRO_PERMITIDO = "lab_assets_demo.db"

BANDAS_HORAS = {
    "Salina": (96, 720),
    "Câmara Choque Térmico": (200, 500),
    "Câmara Climática": (240, 600),
    "Forno": (300, 800),
}
TETO_DURACAO_H = 720
DURACAO_SATURADA_H = 700
JANELA_DIAS = 30
CATEGORIAS_TRACKADAS_DASHBOARD = set(BANDAS_HORAS.keys())

OEE_GLOBAL_MINIMO = 28.0
CATEGORIA_MINIMA_MAIS_FRACA = 12.0
MIN_EQUIP_OPERACIONAIS_A_ZERO = 3
ESTADOS_EXCLUIDOS_DE_NOVA_COBERTURA = {"Avariado", "Em calibração"}
FRACCAO_ALVO_COBERTURA_OPERACIONAL = 0.70


class PlanoAlteracoes:
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


def posicionar_sessao(
    inicio_original: datetime, duracao: timedelta, agora: datetime, rng: random.Random
) -> tuple[datetime, datetime, bool]:
    """Mantém inicio_original sempre que possível; caso contrário recua para
    que o fim caia em [now-2d, now-1d]; garante em último recurso que a
    sessão fica dentro de [now-30d, now] mesmo que isso trunque a duração.
    Devolve (novo_inicio, novo_fim, foi_reposicionada)."""
    janela_min = agora - timedelta(days=JANELA_DIAS)
    janela_max = agora

    fim_mantendo = inicio_original + duracao
    if inicio_original >= janela_min and fim_mantendo <= janela_max:
        return inicio_original, fim_mantendo, False

    fim_alvo = agora - timedelta(days=rng.uniform(1, 2))
    inicio_novo = fim_alvo - duracao
    if inicio_novo < janela_min:
        inicio_novo = janela_min
        fim_alvo = inicio_novo + duracao
        if fim_alvo > janela_max:
            fim_alvo = janela_max  # duração efectiva fica truncada pela janela
    return inicio_novo, fim_alvo, True


def passo1_redimensionar(
    sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool
) -> list[SessaoUso]:
    concluidas = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_not(None))).all()
    concluidas.sort(key=lambda s: (s.equipamento_id, s.id))

    print("\n===== PASSO 1: durações antes/depois =====")
    print(f"{'id':<5}{'equip':<7}{'tipo':<22}{'antes(h)':<12}{'depois(h)':<12}{'reposicionada'}")

    resultado: list[SessaoUso] = []
    for s in concluidas:
        eq = sess.get(Equipamento, s.equipamento_id)
        banda = BANDAS_HORAS.get(eq.tipo)
        antes_h = (s.fim - s.inicio).total_seconds() / 3600
        if banda is None:
            plano.registar("1", f"SessaoUso id={s.id} equip={eq.id} tipo='{eq.tipo}': sem banda definida — mantida sem alteração ({antes_h:.1f}h).")
            print(f"{s.id:<5}{eq.id:<7}{str(eq.tipo):<22}{antes_h:<12.1f}{antes_h:<12.1f}{'não'}")
            resultado.append(s)
            continue

        duracao_h = rng.uniform(*banda)
        if duracao_h > TETO_DURACAO_H:
            duracao_h = DURACAO_SATURADA_H

        # O tecto genérico de 720h ignora avarias do próprio equipamento: um
        # equipamento com downtime na janela tem MENOS tempo disponível do que
        # a janela inteira, e uma duração perto do tecto genérico satura o
        # oee_pct a 100% (min(real/disponivel,1)). Capa a 85% do tempo
        # realmente disponível para este equipamento específico.
        limite = agora - timedelta(days=JANELA_DIAS)
        avarias_equip = sess.exec(select(Avaria).where(Avaria.equipamento_id == eq.id)).all()
        disponivel_h = calcular_tempo_disponivel_s(eq.id, avarias_equip, limite, agora, agora) / 3600
        teto_seguro_h = disponivel_h * 0.85
        limitada_por_avaria = duracao_h > teto_seguro_h
        if limitada_por_avaria:
            duracao_h = max(teto_seguro_h, 1.0)

        duracao = timedelta(hours=duracao_h)

        novo_inicio, novo_fim, reposicionada = posicionar_sessao(s.inicio, duracao, agora, rng)
        depois_h = (novo_fim - novo_inicio).total_seconds() / 3600

        print(f"{s.id:<5}{eq.id:<7}{str(eq.tipo):<22}{antes_h:<12.1f}{depois_h:<12.1f}{'sim' if reposicionada else 'não'}")
        plano.registar(
            "1",
            f"SessaoUso id={s.id} equip={eq.id} ({eq.tipo}): duração {antes_h:.1f}h -> {depois_h:.1f}h | "
            f"inicio {s.inicio} -> {novo_inicio} | fim {s.fim} -> {novo_fim}"
            + (" [reposicionada]" if reposicionada else " [inicio mantido]")
            + (" [TRUNCADA pela janela de 30d]" if abs(depois_h - duracao_h) > 0.5 else "")
            + (f" [limitada a 85% do tempo disponível deste equipamento ({disponivel_h:.1f}h) por downtime de avaria própria]" if limitada_por_avaria else ""),
        )
        s.inicio = novo_inicio
        s.fim = novo_fim
        sess.add(s)
        resultado.append(s)

    sess.flush()
    return resultado


def passo1b_expandir_cobertura(
    sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool
) -> list[SessaoUso]:
    """Expande cobertura parcialmente: ~70% dos equipamentos operacionais (exclui
    'Avariado' e 'Em calibração') ficam com pelo menos 1 sessão na janela.
    Deixa deliberadamente 3-4 equipamentos operacionais sem sessão, espalhados
    por mais do que uma categoria — não é uma falha de cobertura, é o cenário
    realista de um laboratório onde algum equipamento fica parado.
    """
    equipamentos = sess.exec(select(Equipamento)).all()
    sessoes_existentes = sess.exec(select(SessaoUso)).all()
    equip_com_sessao = {s.equipamento_id for s in sessoes_existentes}

    operacionais = [e for e in equipamentos if e.estado_atual not in ESTADOS_EXCLUIDOS_DE_NOVA_COBERTURA]
    # Candidatos a NOVA cobertura só dentro das 4 categorias trackadas do dashboard
    # (prioridade à Câmara Climática, a maior). Equipamentos fora dessas categorias
    # (ex.: 'Outro') ficam naturalmente no lote "deixados a zero", garantindo que
    # esse lote nunca é 100% de uma só categoria sem esforço extra.
    sem_sessao_elegiveis = [
        e for e in operacionais if e.id not in equip_com_sessao and e.tipo in CATEGORIAS_TRACKADAS_DASHBOARD
    ]

    alvo_cobertos = round(len(operacionais) * FRACCAO_ALVO_COBERTURA_OPERACIONAL)
    ja_cobertos = len([e for e in operacionais if e.id in equip_com_sessao])
    n_a_adicionar = max(0, alvo_cobertos - ja_cobertos)
    # Preserva sempre pelo menos MIN_EQUIP_OPERACIONAIS_A_ZERO por cobrir.
    n_a_adicionar = min(n_a_adicionar, max(0, len(sem_sessao_elegiveis) - MIN_EQUIP_OPERACIONAIS_A_ZERO))

    rng.shuffle(sem_sessao_elegiveis)
    escolhidos = sem_sessao_elegiveis[:n_a_adicionar]
    escolhidos_ids = {e.id for e in escolhidos}
    # Reporta TODOS os operacionais que ficam sem sessão, não só o subconjunto
    # elegível para nova cobertura (inclui categorias fora das 4 trackadas, ex. 'Outro').
    deixados_a_zero = [
        e for e in operacionais if e.id not in equip_com_sessao and e.id not in escolhidos_ids
    ]

    plano.registar(
        "1b",
        f"{len(operacionais)} equipamentos operacionais (exclui Avariado/Em calibração); "
        f"{ja_cobertos} já cobertos; alvo ~{FRACCAO_ALVO_COBERTURA_OPERACIONAL*100:.0f}% = {alvo_cobertos}; "
        f"a adicionar cobertura a {len(escolhidos)}: {[(e.id, e.codigo, e.tipo) for e in escolhidos]}",
    )
    plano.registar(
        "1b",
        f"Deixados deliberadamente sem sessão ({len(deixados_a_zero)}, "
        f"categorias: {sorted({e.tipo for e in deixados_a_zero})}): "
        f"{[(e.id, e.codigo, e.tipo) for e in deixados_a_zero]}",
    )

    from app.models.utilizador import Utilizador

    user = sess.exec(select(Utilizador).where(Utilizador.ativo == True)).first()  # noqa: E712
    limite = agora - timedelta(days=JANELA_DIAS)

    novas_sessoes: list[SessaoUso] = []
    for eq in escolhidos:
        banda = BANDAS_HORAS.get(eq.tipo, (96, 600))
        avarias_equip = sess.exec(select(Avaria).where(Avaria.equipamento_id == eq.id)).all()
        disponivel_h = calcular_tempo_disponivel_s(eq.id, avarias_equip, limite, agora, agora) / 3600

        duracao_h = rng.uniform(*banda)
        if duracao_h > TETO_DURACAO_H:
            duracao_h = DURACAO_SATURADA_H
        teto_seguro_h = disponivel_h * 0.85
        if duracao_h > teto_seguro_h:
            duracao_h = max(teto_seguro_h, 1.0)
        duracao = timedelta(hours=duracao_h)

        fim_alvo = agora - timedelta(days=rng.uniform(1, 2))
        inicio_alvo = fim_alvo - duracao
        if inicio_alvo < limite:
            inicio_alvo = limite
            fim_alvo = inicio_alvo + duracao

        plano.registar(
            "1b",
            f"Equipamento id={eq.id} codigo={eq.codigo} tipo={eq.tipo}: criar Reserva+SessaoUso "
            f"({inicio_alvo} -> {fim_alvo}, {duracao_h:.1f}h) | estado_atual será forçado a 'Ocupado' "
            f"pelo listener — reposto a '{eq.estado_atual}' no fim da etapa",
        )

        reserva = Reserva(
            equipamento_id=eq.id,
            utilizador_id=user.id,
            projeto="Cobertura-Categoria",
            metodo="Ensaio",
            data_inicio=inicio_alvo,
            data_fim=fim_alvo,
            notas="Reserva gerada para expansão parcial de cobertura de OEE (redimensionar_sessoes.py Passo 1b).",
            concluido_com_sucesso=True,
        )
        sess.add(reserva)
        sess.flush()

        estado_original = eq.estado_atual
        sessao = SessaoUso(
            equipamento_id=eq.id,
            reserva_id=reserva.id,
            utilizador_id=user.id,
            utilizador=user.nome,
            inicio=inicio_alvo,
            fim=fim_alvo,
            projeto="Cobertura-Categoria",
            metodo="Ensaio",
        )
        sess.add(sessao)
        sess.flush()  # after_insert força 'Ocupado' via Core update

        sess.refresh(eq)  # sincroniza o identity map antes de repor (ver Passo 3 da tarefa anterior)
        eq.estado_atual = estado_original
        sess.add(eq)
        sess.flush()

        novas_sessoes.append(sessao)

    return novas_sessoes


def passo3_eliminar_sobreposicoes(
    sess: Session, sessoes: list[SessaoUso], plano: PlanoAlteracoes, aplicar: bool
) -> list[SessaoUso]:
    """Reduz a UMA sessão por equipamento quando múltiplas sessões longas não
    cabem sem sobreposição — mantém a de inicio mais recente, apaga as outras."""
    por_equip: dict[int, list[SessaoUso]] = defaultdict(list)
    for s in sessoes:
        por_equip[s.equipamento_id].append(s)

    mantidas: list[SessaoUso] = []
    for equip_id, lista in por_equip.items():
        if len(lista) == 1:
            mantidas.append(lista[0])
            continue
        lista.sort(key=lambda s: s.inicio)
        manter = lista[-1]  # a mais recente
        apagar = lista[:-1]
        plano.registar(
            "3",
            f"Equipamento id={equip_id}: {len(lista)} sessões longas não cabem sem sobreposição — "
            f"mantida SessaoUso id={manter.id} ({manter.inicio} -> {manter.fim}); "
            f"apagadas: {[s.id for s in apagar]}",
        )
        for s in apagar:
            sess.delete(s)
        mantidas.append(manter)

    sess.flush()

    # Verificação defensiva: sessão sobreposta ao downtime de avaria aberta do mesmo equipamento.
    abertas = sess.exec(select(Avaria).where(Avaria.resolvida == False)).all()  # noqa: E712
    agora = utc_now()
    downtime_por_equip = {a.equipamento_id: (a.data_registo, agora) for a in abertas}
    for s in mantidas:
        janela_avaria = downtime_por_equip.get(s.equipamento_id)
        if janela_avaria and s.inicio < janela_avaria[1] and janela_avaria[0] < s.fim:
            plano.registar(
                "3",
                f"AVISO: SessaoUso id={s.id} equip={s.equipamento_id} sobrepõe-se ao downtime de avaria "
                f"aberta [{janela_avaria[0]} -> agora] — recuar manualmente se isto ocorrer.",
            )

    return mantidas


def passo2_ajustar_reservas(
    sess: Session, sessoes: list[SessaoUso], plano: PlanoAlteracoes, aplicar: bool
) -> None:
    """Motor de OEE confirmado no Passo 0 como janela-menos-downtime: reservas
    não afectam oee_pct. Ajusta-as apenas para conterem a sessão no calendário."""
    for s in sessoes:
        reservas_equip = sess.exec(select(Reserva).where(Reserva.equipamento_id == s.equipamento_id)).all()
        candidata = next(
            (r for r in reservas_equip if r.data_inicio <= s.fim and r.data_fim >= s.inicio), None
        )
        if candidata is None and reservas_equip:
            candidata = min(reservas_equip, key=lambda r: abs((r.data_inicio - s.inicio).total_seconds()))

        if candidata is None:
            plano.registar(
                "2",
                f"SessaoUso id={s.id} equip={s.equipamento_id}: sem nenhuma Reserva para este equipamento — "
                f"a criar Reserva de cobertura mínima.",
            )
            reserva_nova = Reserva(
                equipamento_id=s.equipamento_id,
                utilizador_id=s.utilizador_id or 1,
                projeto="Cobertura-Categoria",
                metodo="Ensaio",
                data_inicio=s.inicio,
                data_fim=s.fim,
                notas="Reserva gerada para conter sessão redimensionada (redimensionar_sessoes.py).",
                concluido_com_sucesso=True,
            )
            sess.add(reserva_nova)
            sess.flush()
            continue

        antes_inicio, antes_fim = candidata.data_inicio, candidata.data_fim
        alterado = False
        if candidata.data_inicio > s.inicio:
            candidata.data_inicio = s.inicio
            alterado = True
        if candidata.data_fim < s.fim:
            candidata.data_fim = s.fim
            alterado = True

        if alterado:
            plano.registar(
                "2",
                f"Reserva id={candidata.id} equip={s.equipamento_id} ajustada para conter SessaoUso id={s.id}: "
                f"data_inicio {antes_inicio} -> {candidata.data_inicio} | data_fim {antes_fim} -> {candidata.data_fim}",
            )
            sess.add(candidata)

        # Remove reservas irmãs do mesmo equipamento que a extensão tenha passado a sobrepor.
        for outra in reservas_equip:
            if outra.id == candidata.id:
                continue
            if outra.data_inicio < candidata.data_fim and candidata.data_inicio < outra.data_fim:
                plano.registar(
                    "2",
                    f"Reserva id={outra.id} equip={s.equipamento_id}: passou a sobrepor-se à Reserva id={candidata.id} "
                    f"ajustada — apagada por redundância.",
                )
                sess.delete(outra)

    sess.flush()


def passo4_sessao_ativa(sess: Session, agora: datetime, rng: random.Random, plano: PlanoAlteracoes, aplicar: bool) -> None:
    ativa = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_(None))).first()
    if ativa is None:
        plano.registar("4", "Nenhuma sessão activa encontrada — nada a fazer.")
        return
    horas_atras = rng.uniform(60, 180)
    novo_inicio = agora - timedelta(hours=horas_atras)
    plano.registar(
        "4",
        f"SessaoUso id={ativa.id} equip={ativa.equipamento_id} (activa): "
        f"inicio {ativa.inicio} -> {novo_inicio} (~{horas_atras:.1f}h atrás), fim mantido NULL",
    )
    ativa.inicio = novo_inicio
    sess.add(ativa)
    sess.flush()


# ───────────────────────── Validação ─────────────────────────


def validar_invariantes(sess: Session) -> dict[str, list]:
    resultados: dict[str, list] = {}

    avariados = sess.exec(select(Equipamento).where(Equipamento.estado_atual == "Avariado")).all()
    resultados["a) Avariado sem avaria aberta"] = [
        e for e in avariados
        if not sess.exec(select(Avaria).where(Avaria.equipamento_id == e.id, Avaria.resolvida == False)).first()  # noqa: E712
    ]

    abertas = sess.exec(select(Avaria).where(Avaria.resolvida == False)).all()  # noqa: E712
    resultados["b) avaria aberta sem Avariado"] = [
        a for a in abertas if sess.get(Equipamento, a.equipamento_id).estado_atual != "Avariado"
    ]

    ocupados = sess.exec(select(Equipamento).where(Equipamento.estado_atual == "Ocupado")).all()
    resultados["c) Ocupado sem sessao activa"] = [
        e for e in ocupados
        if not sess.exec(select(SessaoUso).where(SessaoUso.equipamento_id == e.id, SessaoUso.fim.is_(None))).first()
    ]

    ativas = sess.exec(select(SessaoUso).where(SessaoUso.fim.is_(None))).all()
    resultados["d) sessao activa sem Ocupado"] = [
        s for s in ativas if sess.get(Equipamento, s.equipamento_id).estado_atual != "Ocupado"
    ]

    todas_sessoes = sess.exec(select(SessaoUso)).all()
    resultados["e) sessoes com inicio > fim"] = [
        s for s in todas_sessoes if s.fim is not None and s.inicio > s.fim
    ]

    sobrepostas_sessoes = []
    por_equip_s: dict[int, list[SessaoUso]] = defaultdict(list)
    for s in todas_sessoes:
        por_equip_s[s.equipamento_id].append(s)
    for equip_id, lista in por_equip_s.items():
        lista.sort(key=lambda s: s.inicio)
        for i in range(len(lista) - 1):
            for j in range(i + 1, len(lista)):
                fim_i = lista[i].fim if lista[i].fim is not None else datetime.max.replace(tzinfo=lista[i].inicio.tzinfo)
                fim_j = lista[j].fim if lista[j].fim is not None else datetime.max.replace(tzinfo=lista[j].inicio.tzinfo)
                if lista[i].inicio < fim_j and lista[j].inicio < fim_i:
                    sobrepostas_sessoes.append((lista[i].id, lista[j].id))
    resultados["c2) sessoes sobrepostas no mesmo equipamento"] = sobrepostas_sessoes

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

    limite = agora - timedelta(days=30)
    equipamentos = sess.exec(select(Equipamento)).all()
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
        individual.append(
            {
                "id": eq.id,
                "codigo": eq.codigo,
                "tipo": eq.tipo,
                "estado_atual": eq.estado_atual,
                "oee_pct": oee_pct,
            }
        )

    oee_global = round(sum(oee_com_dados) / len(oee_com_dados), 1) if oee_com_dados else None

    equip_operacionais_a_zero = [
        i for i in individual
        if i["estado_atual"] not in ESTADOS_EXCLUIDOS_DE_NOVA_COBERTURA and i["oee_pct"] == 0.0
    ]

    por_categoria: dict[str, list] = defaultdict(list)
    for item in individual:
        if item["tipo"] in CATEGORIAS_TRACKADAS_DASHBOARD and item["oee_pct"] is not None:
            por_categoria[item["tipo"]].append(item["oee_pct"])
    media_por_categoria = {tipo: round(sum(v) / len(v), 1) for tipo, v in por_categoria.items()}

    return {
        "mtbf_h": mtbf_mttr["mtbf_h"],
        "mttr_h": mtbf_mttr["mttr_h"],
        "n_avarias_periodo": mtbf_mttr["n_avarias_periodo"],
        "n_avarias_resolvidas": mtbf_mttr["n_avarias_resolvidas"],
        "oee_global": oee_global,
        "individual": individual,
        "media_por_categoria": media_por_categoria,
        "oee_max": max((i["oee_pct"] for i in individual if i["oee_pct"] is not None), default=None),
        "oee_min": min((i["oee_pct"] for i in individual if i["oee_pct"] is not None), default=None),
        "equip_operacionais_a_zero": equip_operacionais_a_zero,
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
    print(f"calcular_mtbf_mttr(session, 30) completo: mtbf_h={metricas['mtbf_h']}, mttr_h={metricas['mttr_h']}, "
          f"n_avarias_periodo={metricas['n_avarias_periodo']}, n_avarias_resolvidas={metricas['n_avarias_resolvidas']}")
    print(f"oee_global = {metricas['oee_global']}")
    print(f"oee_pct individuais: min={metricas['oee_min']}  max={metricas['oee_max']}")
    print("media_por_categoria =")
    for cat in sorted(CATEGORIAS_TRACKADAS_DASHBOARD):
        print(f"   {cat}: {metricas['media_por_categoria'].get(cat)}")
    zeros = metricas["equip_operacionais_a_zero"]
    print(f"equipamentos operacionais a 0.0% ({len(zeros)}): "
          f"{[(i['id'], i['codigo'], i['tipo']) for i in zeros]}")

    if metricas["oee_global"] is None or metricas["oee_global"] < OEE_GLOBAL_MINIMO:
        print(f"FALHA: oee_global tem de ser >= {OEE_GLOBAL_MINIMO} — obtido {metricas['oee_global']}")
        ok_geral = False

    for cat in CATEGORIAS_TRACKADAS_DASHBOARD:
        val = metricas["media_por_categoria"].get(cat)
        if val is None or val == 0.0:
            print(f"FALHA: categoria '{cat}' a 0.0%/sem dados — obtido {val}")
            ok_geral = False
    valores_categoria = [v for v in metricas["media_por_categoria"].values() if v is not None]
    if valores_categoria and min(valores_categoria) < CATEGORIA_MINIMA_MAIS_FRACA:
        print(f"FALHA: categoria mais fraca ({min(valores_categoria)}) tem de ser >= {CATEGORIA_MINIMA_MAIS_FRACA}")
        ok_geral = False

    if len(zeros) < MIN_EQUIP_OPERACIONAIS_A_ZERO:
        print(f"FALHA: precisam de existir pelo menos {MIN_EQUIP_OPERACIONAIS_A_ZERO} equipamentos operacionais "
              f"a 0.0% (realismo) — obtidos {len(zeros)}")
        ok_geral = False

    if any(i["oee_pct"] == 100.0 for i in metricas["individual"]):
        saturados = [(i["id"], i["codigo"]) for i in metricas["individual"] if i["oee_pct"] == 100.0]
        print(f"FALHA: existe oee_pct = 100.0 (saturação): {saturados}")
        ok_geral = False

    if metricas["mtbf_h"] is None or metricas["mttr_h"] is None or not (metricas["mtbf_h"] > metricas["mttr_h"]):
        print(f"FALHA: mtbf_h ({metricas['mtbf_h']}) tem de ser > mttr_h ({metricas['mttr_h']})")
        ok_geral = False

    print(f"\n===== RESULTADO GERAL: {'SUCESSO' if ok_geral else 'FALHA — ROLLBACK OBRIGATÓRIO'} =====\n")
    return ok_geral


# ───────────────────────── Backup ─────────────────────────


def checkpoint_e_backup(db_path: Path) -> Path:
    logger.warning("Confirma que a aplicação está parada antes de continuar.")
    engine_tmp = create_engine(f"sqlite:///{db_path}")
    with engine_tmp.connect() as conn:
        conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    engine_tmp.dispose()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
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
    parser = argparse.ArgumentParser(description="Redimensiona SessoesUso para a escala real de ensaios.")
    parser.add_argument("--aplicar", action="store_true", help="Aplica as alterações (omissão: dry-run).")
    parser.add_argument("--db", type=Path, default=DB_DEMO_DEFAULT, help="Caminho da BD alvo.")
    parser.add_argument("--seed", type=int, default=42, help="Seed do RNG.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.db.name != NOME_FICHEIRO_PERMITIDO:
        logger.error("Recusa a correr contra '%s' — só aceita '%s'.", args.db.name, NOME_FICHEIRO_PERMITIDO)
        sys.exit(1)
    if not args.db.exists():
        logger.error("BD não encontrada em %s", args.db)
        sys.exit(1)

    rng = random.Random(args.seed)
    agora = utc_now()
    plano = PlanoAlteracoes()

    if args.aplicar:
        checkpoint_e_backup(args.db)

    engine = create_engine(f"sqlite:///{args.db}", connect_args={"check_same_thread": False})

    with Session(engine) as sess:
        try:
            sessoes_redimensionadas = passo1_redimensionar(sess, agora, rng, plano, args.aplicar)
            novas_sessoes_cobertura = passo1b_expandir_cobertura(sess, agora, rng, plano, args.aplicar)
            sessoes_mantidas = passo3_eliminar_sobreposicoes(
                sess, sessoes_redimensionadas + novas_sessoes_cobertura, plano, args.aplicar
            )
            passo2_ajustar_reservas(sess, sessoes_mantidas, plano, args.aplicar)
            passo4_sessao_ativa(sess, agora, rng, plano, args.aplicar)

            plano.imprimir()

            # A validação corre sempre (também em --dry-run) sobre o estado real
            # pós-mutação da transacção — nunca sobre valores pré-mutação stale —
            # para que a pré-visualização seja fiel ao que --aplicar faria.
            sess.flush()
            invariantes = validar_invariantes(sess)
            metricas = validar_metricas(sess, agora)
            sucesso = relatar_validacao(invariantes, metricas)

            if not args.aplicar:
                print("Modo --dry-run: validação acima é uma pré-visualização fiel; nenhuma escrita foi persistida.")
                sess.rollback()
                return

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
