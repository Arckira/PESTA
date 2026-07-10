"""
seed_demo_poster.py — Popula a BD com dados demo plausíveis para screenshots do poster.

Objetivo: OEE Global ≈ valor alvo (default 72%), MTBF/MTTR preenchidos e cartões
de estado com distribuição realista, sem expor métricas internas reais da Industrial Testing Lab.

⚠️  EXECUTAR SEMPRE SOBRE UMA CÓPIA DA BASE DE DADOS:
    copy lab_assets.db lab_assets_demo.db
    set DATABASE_URL=sqlite:///lab_assets_demo.db
    python seed_demo_poster.py

Porquê via ORM e não SQL direto: os modelos SQLModel garantem os nomes de tabela/
coluna corretos e o tratamento UTC (UTCDateTime), evitando dessincronização com o
schema real. O helper `kwargs_validos` filtra dinamicamente os campos, tornando o
script resiliente a colunas que existam num ambiente e não noutro.

Como funciona o cálculo real no Dashboard (stats.oee_summary / oee_service):
    Tempo_Disponivel = janela(`dias`) − downtime de avarias com interseção na janela
    OEE por equipamento = min(Σ tempo_real_sessões / Tempo_Disponivel, 1) × 100
    OEE Global = média dos equipamentos com dados
O denominador NÃO é a soma das reservas (isso só alimenta `desvio_planeamento_pct`
e a contagem `total_reservas`) — é janela_total − downtime_avarias. Como o uso real
gerado a partir de reservas plausíveis (poucas sessões de 2-6h) é uma fração ínfima
de uma janela de `dias` dias inteiros, atingir o alvo por essa via exigiria um uso
de equipamento quase contínuo (irreal). Por isso, para cada equipamento, o script
insere uma avaria "de ajuste" adicional cuja duração é calculada para que
Tempo_Disponivel fique alinhado com o alvo. Esta avaria é datada mesmo antes do
início da janela (`limite − 1s`) para não poluir o MTBF/MTTR (que filtra
`data_registo >= limite`), mas ainda assim conta como downtime dentro da janela
(a interseção é sempre recortada a [limite, agora] em `calcular_tempo_disponivel_s`).

Estado dos equipamentos: a inserção de SessaoUso/Avaria dispara eventos
`after_insert` que forçam `estado_atual` (para "Ocupado" ou "Avariado"/"Limitado").
Por isso a distribuição de estados pretendida para os cartões do poster só é
aplicada NO FIM, numa passagem final que sobrepõe esses efeitos colaterais.

Limpeza posterior: todos os registos demo são etiquetados (projeto='DEMO-POSTER',
descrições '[DEMO] '), permitindo remoção com --limpar.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone

# --- Imports do projeto -----------------------------------------------------
# Confirmado: os modelos de tabela (SQLModel, table=True) vivem em app/models/*
# neste repositório — não há monólito main.py com modelos inline. Correr a
# partir da raiz de 'backend/' (onde 'app/' é importável).
try:
    from sqlmodel import Session, select
    from app.db.database import engine
    from app.models.equipamento import Equipamento
    from app.models.reserva import Reserva
    from app.models.sessao import SessaoUso
    from app.models.avaria import Avaria
    from app.models.utilizador import Utilizador
    from app.core.security import _hash_pin
    from app.services.oee_service import calcular_tempo_disponivel_s
except ImportError as exc:  # noqa: BLE001
    sys.exit(
        f"Erro de import: {exc}\n"
        "Executar a partir da raiz do backend (onde 'app/' é importável)."
    )

TAG_PROJETO = "DEMO-POSTER"
TAG_DESC = "[DEMO] "
PIN_DEMO_LOGIN = "1357"  # PIN de conveniência só na cópia demo (4 dígitos) — nunca usar na BD real


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def kwargs_validos(modelo, **kwargs) -> dict:
    """Filtra kwargs para apenas colunas existentes no modelo (robustez a variações de schema)."""
    cols = {c.name for c in modelo.__table__.columns}
    return {k: v for k, v in kwargs.items() if k in cols and v is not None}


def hora_cheia(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def fechar_avarias_abertas_da_bd_copiada(sess: Session, dias: int, rng: random.Random) -> None:
    """Fecha avarias em aberto herdadas da BD real copiada (data_resolucao is None).

    Uma avaria em aberto sem resolução é tratada por `calcular_tempo_disponivel_s`
    como estendendo-se até `agora`, consumindo toda a janela e deixando o
    equipamento com OEE=None. Isso é correto para a operação real, mas inutiliza
    o equipamento para o poster demo. Como isto só corre sobre `lab_assets_demo.db`
    (nunca a BD real), é seguro fechar essas avarias aqui com uma duração plausível.
    """
    agora = utc_now()
    abertas = sess.exec(select(Avaria).where(Avaria.data_resolucao.is_(None))).all()
    for a in abertas:
        a.resolvida = True
        a.data_resolucao = a.data_registo + timedelta(hours=rng.uniform(3, 48))
        if a.data_resolucao > agora:
            a.data_resolucao = agora - timedelta(hours=1)
        sess.add(a)


def gerar_reservas_e_sessoes(
    sess: Session, eq: Equipamento, user: Utilizador, dias: int, alvo: float, rng: random.Random
) -> tuple[float, float]:
    """Cria 4–7 pares reserva+sessão fechada no passado. Devolve (planeado_s, real_s).

    Nota: `real_s` alimenta o numerador do OEE real (tempo de sessões). A fração
    sessão/reserva aqui só torna a relação reserva↔sessão plausível na UI — o
    alinhamento com `alvo` é feito depois, via avaria de ajuste (ver main()).
    """
    agora = utc_now()
    planeado_total, real_total = 0.0, 0.0
    n_reservas = rng.randint(4, 7)
    dias_usados = rng.sample(range(2, dias - 1), k=min(n_reservas, max(dias - 3, 1)))

    for d in dias_usados:
        inicio_r = hora_cheia(agora - timedelta(days=d)).replace(hour=rng.randint(8, 12))
        duracao_h = rng.randint(2, 6)
        fim_r = inicio_r + timedelta(hours=duracao_h)

        reserva = Reserva(**kwargs_validos(
            Reserva,
            equipamento_id=eq.id,
            utilizador_id=user.id,
            data_inicio=inicio_r,
            data_fim=fim_r,
            projeto=TAG_PROJETO,
            metodo="Ensaio demo",
            notas="Registo gerado para demonstração",
            concluido_com_sucesso=True,
        ))
        sess.add(reserva)
        sess.flush()  # obter reserva.id

        fracao = max(0.55, min(0.95, rng.gauss(alvo, 0.07)))
        atraso_min = rng.randint(0, 20)
        inicio_s = inicio_r + timedelta(minutes=atraso_min)
        fim_s = inicio_s + timedelta(seconds=duracao_h * 3600 * fracao)
        fim_s = min(fim_s, fim_r)

        sessao = SessaoUso(**kwargs_validos(
            SessaoUso,
            equipamento_id=eq.id,
            utilizador_id=user.id,
            utilizador=user.nome,
            reserva_id=reserva.id,
            inicio=inicio_s,
            fim=fim_s,
            projeto=TAG_PROJETO,
            metodo="Ensaio demo",
        ))
        sess.add(sessao)

        planeado_total += duracao_h * 3600
        real_total += (fim_s - inicio_s).total_seconds()

    return planeado_total, real_total


def gerar_avarias_cosmeticas(
    sess: Session, equipamentos: list, user: Utilizador, dias: int, rng: random.Random
) -> None:
    """3 avarias resolvidas (MTTR 3–9h) dentro da janela — alimentam o cartão MTBF/MTTR.

    O downtime que introduzem é automaticamente considerado pelo ajuste de OEE
    seguinte, que relê todas as avarias do equipamento via `calcular_tempo_disponivel_s`.
    """
    agora = utc_now()

    for i, eq in enumerate(rng.sample(equipamentos, k=min(3, len(equipamentos)))):
        registo = agora - timedelta(days=rng.randint(2, dias - 3), hours=rng.randint(0, 10))
        resolucao = registo + timedelta(hours=rng.uniform(3, 9))
        sess.add(Avaria(**kwargs_validos(
            Avaria,
            equipamento_id=eq.id,
            descricao=f"{TAG_DESC}Falha de controlo de temperatura #{i + 1}",
            data_registo=registo,
            data_resolucao=resolucao,
            severidade="BLOQUEANTE",
            utilizador_id=user.id,
            relatorio_tecnico="Substituição de sensor PT100 (demo).",
            resolvida=True,
        )))


def gerar_avaria_ajuste_oee(
    sess: Session,
    eq: Equipamento,
    real_total_s: float,
    dias: int,
    alvo: float,
    rng: random.Random,
) -> float:
    """Insere uma avaria 'de ajuste' para que Tempo_Disponivel bata certo com `alvo`.

    Datada para terminar antes de `limite` (fora da janela de MTBF/MTTR, que filtra
    `data_registo >= limite`), mas ainda assim é contabilizada como downtime dentro
    da janela porque `calcular_tempo_disponivel_s` recorta a interseção a
    [limite, agora] independentemente de quando a avaria começou.

    Usa `calcular_tempo_disponivel_s` (a função real da app) sobre as avarias já
    existentes para este equipamento — cosméticas ou herdadas da BD copiada —
    em vez de um contador próprio, para não desalinhar se já houver downtime
    registado por outra via.
    """
    agora = utc_now()
    limite = agora - timedelta(days=dias)
    janela_total_s = dias * 86400

    avarias_eq = sess.exec(
        select(Avaria).where(Avaria.equipamento_id == eq.id, Avaria.data_registo < agora)
    ).all()
    disponivel_atual_s = calcular_tempo_disponivel_s(eq.id, avarias_eq, limite, agora, agora)

    alvo_equipamento = max(0.60, min(0.85, rng.gauss(alvo, 0.05)))
    disponivel_alvo_s = max(real_total_s, 1.0) / alvo_equipamento
    downtime_necessario_s = disponivel_atual_s - disponivel_alvo_s
    downtime_necessario_s = max(0.0, min(downtime_necessario_s, janela_total_s - 1))

    if downtime_necessario_s <= 0:
        return 0.0

    registo = limite - timedelta(seconds=1)
    resolucao = limite + timedelta(seconds=downtime_necessario_s)

    sess.add(Avaria(**kwargs_validos(
        Avaria,
        equipamento_id=eq.id,
        descricao=f"{TAG_DESC}Indisponibilidade programada (ajuste de OEE demo, não é uma avaria real)",
        data_registo=registo,
        data_resolucao=resolucao,
        severidade="ALERTA",
        resolvida=True,
    )))
    return downtime_necessario_s


def aplicar_estados_finais(sess: Session, equipamentos: list, estados_por_id: dict[int, str]) -> None:
    """Sobrepõe, por último, o estado_atual pretendido para os cartões do poster.

    Necessário porque os eventos after_insert de SessaoUso ('Ocupado') e Avaria
    ('Avariado'/'Limitado') já alteraram estado_atual durante a criação dos
    registos acima — via UPDATE core (connection.execute), que não passa pelo
    identity map da sessão. Por isso este pass usa também UPDATE core em vez de
    atribuir o atributo ORM: se o valor pretendido calhar de coincidir com o
    valor já obsoleto em memória (carregado antes desses eventos), o ORM não
    detectaria alteração e não emitiria nenhum UPDATE, deixando o valor errado
    do evento por sobrescrever.
    """
    from sqlalchemy import update

    for eq in equipamentos:
        estado = estados_por_id.get(eq.id)
        if estado is None:
            continue
        sess.execute(
            update(Equipamento).where(Equipamento.id == eq.id).values(estado_atual=estado)
        )


def configurar_login_demo(sess: Session, user: Utilizador) -> None:
    """Define um PIN conhecido no utilizador demo, só para permitir login na cópia.

    Nunca aplicar contra a BD real — o pin_hash é sobrescrito.
    """
    user_bd = sess.get(Utilizador, user.id)
    user_bd.pin_hash = _hash_pin(PIN_DEMO_LOGIN)
    user_bd.forcar_troca_pin = False
    sess.add(user_bd)


def limpar_demo(sess: Session) -> None:
    """Remove todos os registos etiquetados como demo."""
    for r in sess.exec(select(Reserva).where(Reserva.projeto == TAG_PROJETO)).all():
        sess.delete(r)
    if "projeto" in {c.name for c in SessaoUso.__table__.columns}:
        alvo = sess.exec(select(SessaoUso).where(SessaoUso.projeto == TAG_PROJETO)).all()
    else:
        alvo = [s for s in sess.exec(select(SessaoUso)).all() if s.reserva_id is None]
    for s in alvo:
        sess.delete(s)
    for a in sess.exec(select(Avaria)).all():
        if (a.descricao or "").startswith(TAG_DESC):
            sess.delete(a)
    sess.commit()
    print("Registos demo removidos.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed de dados demo para o poster.")
    parser.add_argument("--dias", type=int, default=30, help="Janela temporal (default: 30)")
    parser.add_argument("--oee-alvo", type=float, default=0.72, help="OEE alvo 0–1 (default: 0.72)")
    parser.add_argument("--seed", type=int, default=42, help="Seed RNG para reprodutibilidade")
    parser.add_argument("--limpar", action="store_true", help="Remove os dados demo e sai")
    args = parser.parse_args()

    rng = random.Random(args.seed)

    with Session(engine) as sess:
        if args.limpar:
            limpar_demo(sess)
            return

        equipamentos = sess.exec(select(Equipamento)).all()
        user = sess.exec(select(Utilizador).where(Utilizador.ativo == True)).first()  # noqa: E712
        if not equipamentos or not user:
            sys.exit("BD sem equipamentos ou utilizadores ativos — nada a semear.")

        print(f"{len(equipamentos)} equipamentos | utilizador demo: {user.nome}")

        estados_extra = ["Avariado", "Em calibração", "Em manutenção", "Limitado"]
        rng.shuffle(equipamentos)
        estados_por_id: dict[int, str] = {}
        real_total_por_eq: dict[int, float] = {}

        try:
            fechar_avarias_abertas_da_bd_copiada(sess, args.dias, rng)
            sess.flush()

            for idx, eq in enumerate(equipamentos):
                estados_por_id[eq.id] = estados_extra[idx] if idx < len(estados_extra) else "Disponível"
                _, real_total = gerar_reservas_e_sessoes(sess, eq, user, args.dias, args.oee_alvo, rng)
                real_total_por_eq[eq.id] = real_total

            gerar_avarias_cosmeticas(sess, equipamentos, user, args.dias, rng)
            sess.flush()

            for eq in equipamentos:
                gerar_avaria_ajuste_oee(
                    sess,
                    eq,
                    real_total_por_eq.get(eq.id, 0.0),
                    args.dias,
                    args.oee_alvo,
                    rng,
                )

            sess.flush()
            aplicar_estados_finais(sess, equipamentos, estados_por_id)
            configurar_login_demo(sess, user)
            sess.commit()
        except Exception:  # noqa: BLE001
            sess.rollback()
            raise

        agora = utc_now()
        limite = agora - timedelta(days=args.dias)
        oees_previstos = []
        for eq in equipamentos:
            real_s = real_total_por_eq.get(eq.id, 0.0)
            avarias_eq = sess.exec(
                select(Avaria).where(Avaria.equipamento_id == eq.id, Avaria.data_registo < agora)
            ).all()
            disponivel_s = calcular_tempo_disponivel_s(eq.id, avarias_eq, limite, agora, agora)
            if disponivel_s > 0:
                oees_previstos.append(min(real_s / disponivel_s, 1.0) * 100)

        oee_global = sum(oees_previstos) / len(oees_previstos) if oees_previstos else 0.0
        print(f"OEE Global previsto no Dashboard: {oee_global:.1f}%")
        print("Estados: 1x Avariado, 1x Em calibração, 1x Em manutenção, 1x Limitado, restantes Disponível")
        print(f"Login demo: utilizador '{user.nome}' | PIN = {PIN_DEMO_LOGIN}")
        print(f"Reiniciar o backend e capturar o screenshot com ?dias={args.dias}")


if __name__ == "__main__":
    main()
