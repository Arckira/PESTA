import { useEffect, useState, useMemo } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { FileDown } from 'lucide-react'
import { BsMicrosoftTeams } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge, { normalizarEstadoEquipamento } from '../components/StatusBadge.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Dashboard.module.css'

const corOEE = (pct) =>
  pct < 50 ? '#c8102e' : pct <= 85 ? '#f59e0b' : '#10b981'

// Gauge radial SVG — anel de progresso circular
// Circunferência = 2 × π × 48 ≈ 301.59px; offset move o ponto de corte
function RadialGauge({ value }) {
  const R = 48
  const circ = 2 * Math.PI * R
  const pct = value !== null && value !== undefined ? Math.min(100, Math.max(0, value)) : 0
  const offset = circ * (1 - pct / 100)
  const cor = value !== null && value !== undefined ? corOEE(value) : '#d1d5db'
  return (
    <svg width="110" height="110" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r={R} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={R}
        fill="none"
        stroke={cor}
        strokeWidth="10"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
      />
      <text
        x="50%" y="50%"
        textAnchor="middle" dominantBaseline="middle"
        style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, fill: cor }}
      >
        {value !== null && value !== undefined ? `${Math.round(value)}%` : '—'}
      </text>
    </svg>
  )
}

const ESTADOS = ['Disponível', 'Ocupado', 'Avariado', 'Em manutenção', 'Em calibração']

const COR_POR_ESTADO = {
  'Disponível': '#10b981',
  'Ocupado': '#f59e0b',
  'Avariado': '#c8102e',
  'Em manutenção': '#a855f7',
  'Em calibração': '#3b82f6',
}

export default function Dashboard() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const [equipamentos, setEquipamentos] = useState([])
  const [reservas, setReservas] = useState([])
  const [utilizadores, setUtilizadores] = useState([])
  const [exportingPdf, setExportingPdf] = useState(false)
  const [oeeData, setOeeData] = useState(null)
  const [oeeHistorico, setOeeHistorico] = useState([])
  const [calibProximas, setCalibProximas] = useState([])
  const [agora, setAgora] = useState(Date.now())

  const carregarDados = async () => {
    try {
      const [eqs, ress] = await Promise.all([
        api.listarEquipamentos(),
        api.listarReservas(),
      ])
      setEquipamentos(eqs || [])
      setReservas(ress || [])
      if (user?.role === 'admin') {
        const utils = await api.listarUtilizadores()
        setUtilizadores(utils || [])
      } else {
        setUtilizadores([])
      }
      api.oeeGlobalSummary(30).then(setOeeData).catch(() => {})
      api.oeeHistorico(30).then(setOeeHistorico).catch(() => {})
      api.calibracoesProximas(30).then(setCalibProximas).catch(() => {})
    } catch (e) {
      toast.error(t('dashboard.erroCarregarDashboard', { msg: e.message }))
    }
  }

  const handleShareTeams = () => {
    const url = window.location.href
    const teamsUrl = `https://teams.microsoft.com/l/chat/0/0?users=&message=${encodeURIComponent('Segue o relatório do Dashboard do Laboratório: ' + url)}`
    window.open(teamsUrl, '_blank')
  }

  const handleExportarPlaneamentoPdf = async () => {
    setExportingPdf(true)
    try {
      const blob = await api.exportarPlaneamentoPdf()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
      a.href = url
      a.download = `Lab_Status_Global_${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('dashboard.sucessoPdfExportado'))
    } catch (error) {
      toast.error(error.message || t('dashboard.erroPdfExportar'))
    } finally {
      setExportingPdf(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [user?.role])

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const { total, avariados, disponiveis, calib, manut, ocupados } = useMemo(() => {
    const list = equipamentos || []
    const estadosNormalizados = list.map((e) => normalizarEstadoEquipamento(e.estado_atual))
    return {
      total: list.length,
      avariados: estadosNormalizados.filter((e) => e === 'Avariado').length,
      disponiveis: estadosNormalizados.filter((e) => e === 'Disponível').length,
      calib: estadosNormalizados.filter((e) => e === 'Em calibração').length,
      manut: estadosNormalizados.filter((e) => e === 'Em manutenção').length,
      ocupados: estadosNormalizados.filter((e) => e === 'Ocupado').length,
    }
  }, [equipamentos])

  const proximasReservas = useMemo(() => {
    const agora = Date.now()
    return [...reservas]
      .filter((r) => new Date(r.data_inicio).getTime() >= agora)
      .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
      .slice(0, 4)
  }, [reservas])

  const sessoesAExpirar = useMemo(() => {
    const HORA_MS = 3_600_000
    return reservas
      .filter(r =>
        r.esta_ativa === true &&
        new Date(r.data_fim).getTime() > agora &&
        new Date(r.data_fim).getTime() - agora <= HORA_MS * 2
      )
      .map(r => ({
        ...r,
        msRestantes: new Date(r.data_fim).getTime() - agora,
      }))
      .sort((a, b) => a.msRestantes - b.msRestantes)
  }, [reservas, agora])

  // OEE por equipamento calculado pelo backend (denominador = tempo disponível − downtime avarias).
  const { oeeMapDinamico, oeeGlobalDinamico } = useMemo(() => {
    if (!oeeData?.individual) return { oeeMapDinamico: {}, oeeGlobalDinamico: null }

    const map = {}
    const oeesValidos = []

    for (const item of oeeData.individual) {
      map[item.id] = {
        ...item,
        tempo_disponivel_h: item.tempo_disponivel_h ?? 0,
        oee_dinamico_pct: item.oee_pct,
        desvio_dinamico_pct: item.desvio_planeamento_pct,
      }
      if (item.oee_pct !== null) oeesValidos.push(item.oee_pct)
    }

    const global = oeesValidos.length > 0
      ? Math.round(oeesValidos.reduce((a, b) => a + b, 0) / oeesValidos.length * 10) / 10
      : null

    return { oeeMapDinamico: map, oeeGlobalDinamico: global }
  }, [oeeData])

  const oeeDataPorTipo = useMemo(() => {
    if (!oeeData?.individual) return []
    const ORDEM = ['Câmara Climática', 'Câmara Choque Térmico', 'Forno', 'Salina', 'Outros']
    const mapa = {}
    for (const item of oeeData.individual) {
      const tipo = item.tipo || 'Outros'
      if (!mapa[tipo]) mapa[tipo] = { valores: [], hReal: 0, hDisp: 0 }
      if (item.oee_pct !== null && item.oee_pct !== undefined) {
        mapa[tipo].valores.push(item.oee_pct)
      }
      mapa[tipo].hReal += item.tempo_real_h || 0
      mapa[tipo].hDisp += item.tempo_disponivel_h || 0
    }
    return ORDEM
      .filter(tipo => mapa[tipo])
      .map(tipo => ({
        tipo,
        oee_pct: mapa[tipo].valores.length
          ? Math.min(100, parseFloat((mapa[tipo].valores.reduce((a, b) => a + b, 0)
              / mapa[tipo].valores.length).toFixed(1)))
          : null,
        n_equipamentos: (mapa[tipo].valores.length),
        tempo_real_h: parseFloat(mapa[tipo].hReal.toFixed(1)),
        tempo_disponivel_h: parseFloat(mapa[tipo].hDisp.toFixed(1)),
      }))
  }, [oeeData])

  const oeeMediaHistorico = useMemo(() => {
    if (!oeeHistorico.length) return null
    return Math.round(oeeHistorico.reduce((acc, d) => acc + d.oee_pct, 0) / oeeHistorico.length)
  }, [oeeHistorico])

  // Alertas proativos: avariados, OEE 0% com horas planeadas,
  // calibrações próximas/vencidas, e reservas em curso sem check-in.
  const alertas = useMemo(() => {
    const lista = []
    const agora = Date.now()

    for (const eq of equipamentos) {
      if (normalizarEstadoEquipamento(eq.estado_atual) === 'Avariado') {
        lista.push({ tipo: 'critico', mensagem: `${eq.nome} — em estado Avariado`, link: '/avarias' })
      }
    }

    for (const cal of calibProximas) {
      if (!cal.proxima_data) continue
      const eq = equipamentos.find((e) => e.id === cal.equipamento_id)
      const nome = eq?.nome || `Equipamento #${cal.equipamento_id}`
      const diasRestantes = Math.ceil((new Date(cal.proxima_data).getTime() - agora) / 86_400_000)
      if (diasRestantes <= 0) {
        lista.push({ tipo: 'critico', mensagem: `${nome} — calibração vencida`, link: '/calibracoes' })
      } else if (diasRestantes <= 7) {
        lista.push({ tipo: 'aviso', mensagem: `${nome} — calibração expira em ${diasRestantes} dia(s)`, link: '/calibracoes' })
      }
    }

    for (const r of reservas) {
      const inicio = new Date(r.data_inicio).getTime()
      const fim = new Date(r.data_fim).getTime()
      if (inicio <= agora && fim > agora && r.esta_ativa !== true) {
        lista.push({
          tipo: 'aviso',
          mensagem: `${r.equipamento_nome || `Equipamento #${r.equipamento_id}`} — reserva em curso sem check-in`,
          link: '/reservas',
        })
      }
    }

    return lista.sort((a, b) => (a.tipo === 'critico' && b.tipo !== 'critico' ? -1 : b.tipo === 'critico' && a.tipo !== 'critico' ? 1 : 0))
  }, [equipamentos, calibProximas, reservas])

  const reservasKpiCount = useMemo(() => {
    const agora = Date.now()
    return reservas.filter((r) =>
      r.esta_ativa === true || new Date(r.data_fim).getTime() >= agora
    ).length
  }, [reservas])

  const ocupacaoPorTipo = useMemo(() => {
    const map = {}
    for (const eq of equipamentos) {
      const tipo = eq.tipo || 'Sem tipo'
      if (!map[tipo]) map[tipo] = { total: 0, disponivel: 0, ocupado: 0, avariado: 0, outros: 0 }
      map[tipo].total++
      const estado = normalizarEstadoEquipamento(eq.estado_atual)
      if (estado === 'Disponível') map[tipo].disponivel++
      else if (estado === 'Ocupado') map[tipo].ocupado++
      else if (estado === 'Avariado') map[tipo].avariado++
      else map[tipo].outros++
    }
    const TIPO_ORDEM = { 'Câmara Climática': 0, 'Câmara Choque Térmico': 1, 'Forno': 2, 'Salina': 3 }
    const ordemTipo = (tipo) => TIPO_ORDEM[tipo] ?? 99
    return Object.entries(map).sort((a, b) => {
      const oa = ordemTipo(a[0])
      const ob = ordemTipo(b[0])
      return oa !== ob ? oa - ob : a[0].localeCompare(b[0])
    })
  }, [equipamentos])

  const taxaDisponibilidade = total ? Math.round((disponiveis / total) * 100) : 0
  const taxaAvarias = total ? Math.round((avariados / total) * 100) : 0
  const semAlertasCriticos = avariados === 0 && manut === 0 && calib === 0
  const statusVisual = total === 0 ? 'neutral' : taxaDisponibilidade < 50 ? 'critical' : 'healthy'

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <PageHeader titulo={t('dashboard.titleLab')} isDashboard={true} />
        <div className={styles.headerRight}>
          <span className="badge badge-ok">{t('dashboard.sistemaOnline')}</span>
          <div className={styles.actionGroup}>
            <button
              className={styles.btnExportPdf}
              onClick={handleExportarPlaneamentoPdf}
              disabled={exportingPdf}
            >
              <FileDown size={15} strokeWidth={2} />
              {exportingPdf ? t('dashboard.aExportar') : t('dashboard.exportarPdf')}
            </button>
            <button
              className={styles.btnShare}
              onClick={handleShareTeams}
              title={t('dashboard.partilharTeams')}
              aria-label={t('dashboard.partilharTeams')}
            >
              <BsMicrosoftTeams size={18} color="#6264A7" />
            </button>
          </div>
        </div>
      </div>

      <section className={styles.heroGrid}>
        <article className={`${styles.heroCard} ${styles[`heroCard_${statusVisual}`]}`}>
          <div className={styles.heroTop}>
            <h3 className={styles.cardTitle}>{t('dashboard.estadoOperacional')}</h3>
            <span className={`${styles.heroValue} ${styles[`heroValue_${statusVisual}`]}`}>{taxaDisponibilidade}%</span>
          </div>
          <div className={styles.heroTrack}>
            <div className={`${styles.heroTrackFill} ${styles[`heroTrackFill_${statusVisual}`]}`} style={{ width: `${taxaDisponibilidade}%` }} />
          </div>
          <div className={styles.heroMeta}>
            <span>{disponiveis} {t('dashboard.disponiveis')}</span>
            <span>{total} total</span>
          </div>
        </article>

        <article className={styles.alertCard}>
          <h3 className={styles.cardTitle}>{t('dashboard.atencaoNecessaria')}</h3>
          {semAlertasCriticos ? (
            <div className={styles.goodNews}>{t('dashboard.semFalhasCriticas')}</div>
          ) : (
            <>
              <div className={styles.alertNumbers}>
                <Link to="/avarias" className={styles.alertLink}>
                  <strong>{avariados}</strong> {t('dashboard.avariados')}
                </Link>
                <Link to="/manutencoes" className={styles.alertLink}>
                  <strong>{manut}</strong> {t('dashboard.manutencao')}
                </Link>
                <Link to="/calibracoes" className={styles.alertLink}>
                  <strong>{calib}</strong> {t('dashboard.calibracao')}
                </Link>
                <div><strong>{ocupados}</strong> {t('dashboard.ocupados')}</div>
              </div>
              <div className={styles.alertFoot}>{taxaAvarias > 0 ? t('dashboard.frotaAvaria', { percent: taxaAvarias }) : t('dashboard.monitorizacaoAtiva')}</div>
            </>
          )}
        </article>
      </section>

      <section className={styles.oeeSection}>
        <article className={styles.oeeCard}>
          <h3 className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('dashboard.oee')}
            <span
              title={t('dashboard.oeeTooltip')}
              style={{ cursor: 'help', fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              ?
            </span>
          </h3>
          <div className={styles.oeeCardMain}>
            <RadialGauge value={oeeGlobalDinamico ?? null} />
            <div>
              <div
                className={styles.oeeCardValue}
                style={{ color: oeeGlobalDinamico !== null ? corOEE(oeeGlobalDinamico) : 'var(--text-dim)' }}
              >
                {oeeGlobalDinamico !== null ? `${oeeGlobalDinamico.toFixed(1)}%` : '—'}
              </div>
              <div className={styles.oeeCardSub}>{t('dashboard.mediaEquipamentos')}</div>
            </div>
          </div>
          {oeeDataPorTipo.length > 0 && (
            <>
              <div className={styles.oeeCategoriaDivider} />
              <div className={styles.oeeCategoriasGrid}>
                {oeeDataPorTipo.map(({ tipo, oee_pct, n_equipamentos }) => {
                  const cor = oee_pct === null ? 'var(--text-dim)'
                    : oee_pct >= 85 ? 'var(--green)'
                    : oee_pct >= 50 ? 'var(--amber)'
                    : 'var(--red)'
                  return (
                    <div key={tipo} className={styles.oeeCategoriaCard}>
                      <span className={styles.oeeCategoriaLabel}>
                        {t(`categorias.${tipo}`) || tipo}
                      </span>
                      <span className={styles.oeeCategoriaValor} style={{ color: cor }}>
                        {oee_pct !== null ? `${oee_pct}%` : '—'}
                      </span>
                      <span className={styles.oeeCategoriaDetalhe}>
                        {n_equipamentos} equip.
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </article>

        <article className={styles.oeeCard}>
          <h3 className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            MTBF
            <span
              title="Tempo médio entre avarias (IEC 60050-192)"
              style={{ cursor: 'help', fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              ?
            </span>
          </h3>
          <div className={styles.oeeCardValue} style={{ color: 'var(--text-primary)', marginTop: 10 }}>
            {oeeData?.mtbf_h != null ? oeeData.mtbf_h.toFixed(1) : '—'}
            {oeeData?.mtbf_h != null && <span style={{ fontSize: '0.9rem', fontWeight: 400, marginLeft: 4, color: 'var(--text-secondary)' }}>h</span>}
          </div>
          <div className={styles.oeeCardSub} style={{ marginTop: 8 }}>
            {oeeData?.n_avarias_periodo != null ? `${oeeData.n_avarias_periodo} avaria(s) em 30 dias` : 'Sem avarias no período'}
          </div>
        </article>

        <article className={styles.oeeCard}>
          <h3 className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            MTTR
            <span
              title="Tempo médio de reparação"
              style={{ cursor: 'help', fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              ?
            </span>
          </h3>
          <div className={styles.oeeCardValue} style={{ color: 'var(--text-primary)', marginTop: 10 }}>
            {oeeData?.mttr_h != null ? oeeData.mttr_h.toFixed(1) : '—'}
            {oeeData?.mttr_h != null && <span style={{ fontSize: '0.9rem', fontWeight: 400, marginLeft: 4, color: 'var(--text-secondary)' }}>h</span>}
          </div>
          <div className={styles.oeeCardSub} style={{ marginTop: 8 }}>
            {oeeData?.n_avarias_resolvidas != null ? `${oeeData.n_avarias_resolvidas} avaria(s) resolvida(s)` : 'Sem resoluções no período'}
          </div>
        </article>
      </section>

      <section className={styles.kpiRow}>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t('equipamentos.title')}</span>
          <strong>{total}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t('dashboard.reservasAtivas')}</span>
          <strong>{reservasKpiCount}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t('utilizadores.title')}</span>
          <strong>{utilizadores.length}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t('dashboard.availability')}</span>
          <strong>{taxaDisponibilidade}%</strong>
        </div>
      </section>

      <section className={styles.dualGrid}>
        <div className={styles.section}>
          <div className={styles.alertasBannerTitle}>{t('dashboard.acoesPendentes')}</div>
          {alertas.length === 0 ? (
            <div className={styles.empty}>{t('dashboard.semAcoesPendentes')}</div>
          ) : (
            <ul className={styles.alertasList}>
              {alertas.slice(0, 5).map((alerta, idx) => (
                <li key={idx} className={alerta.tipo === 'critico' ? styles.alertaItemCritico : styles.alertaItemAviso}>
                  <span className={styles.alertaIcon}>{alerta.tipo === 'critico' ? '🔴' : '🟡'}</span>
                  <span className={styles.alertaMensagem}>{alerta.mensagem}</span>
                  <Link to={alerta.link} className={styles.alertaLink}>{t('dashboard.ver')} →</Link>
                </li>
              ))}
              {alertas.length > 5 && (
                <li className={styles.alertasVerMais}>
                  +{alertas.length - 5} {t('dashboard.maisAlertas')} — <Link to="/avarias">{t('dashboard.ver')}</Link>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.cardTitle} style={{ marginBottom: 14 }}>
            ⏱ {t('dashboard.sessoesAExpirar')}
          </div>
          {sessoesAExpirar.length === 0 ? (
            <div className={styles.empty}>{t('dashboard.semSessoesAExpirar')}</div>
          ) : (
            <ul className={styles.timeline}>
              {sessoesAExpirar.map(r => {
                const minutos = Math.ceil(r.msRestantes / 60_000)
                const critico = minutos <= 15
                const aviso = minutos <= 60
                const cor = critico ? '#c8102e' : aviso ? '#f59e0b' : '#10b981'
                return (
                  <li key={r.id} className={styles.timelineItem}>
                    <div>
                      <div className={styles.timelineTitle} style={{ fontWeight: 600 }}>
                        {r.equipamento_nome || `Equipamento #${r.equipamento_id}`}
                      </div>
                      <div className={styles.timelineMeta}>
                        {r.utilizador_nome || ''}{r.projeto ? ` • ${r.projeto}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ color: cor, fontSize: '0.9rem' }}>
                        {minutos < 60 ? `${minutos}min` : `${Math.floor(minutos / 60)}h ${minutos % 60}min`}
                      </strong>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        {new Date(r.data_fim).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section className={styles.dualGrid}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.cardTitle}>{t('dashboard.proximasReservas')}</div>
            <Link to="/reservas" className={styles.seeAll}>{t('dashboard.verCalendario')}</Link>
          </div>
          {proximasReservas.length === 0 ? (
            <div className={styles.empty}>{t('dashboard.semReservas')}</div>
          ) : (
            <ul className={styles.timeline}>
              {proximasReservas.map((r) => (
                <li key={r.id} className={styles.timelineItem}>
                  <div>
                    <div className={styles.timelineTitle}>{r.equipamento_nome || `Equipamento #${r.equipamento_id}`}</div>
                    <div className={styles.timelineMeta}>{r.utilizador_nome || t('dashboard.utilizadorNaoDefinido')} {r.projeto ? `• ${r.projeto}` : ''}</div>
                  </div>
                  <div className={styles.timelineDate}>
                    {new Date(r.data_inicio).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.cardTitle} style={{ marginBottom: 14 }}>{t('dashboard.distribuicaoEstado')}</div>
          <div className={styles.barRow}>
            {ESTADOS.map((estado) => {
              const count = equipamentos.filter((e) => normalizarEstadoEquipamento(e.estado_atual) === estado).length
              const pct = total ? (count / total) * 100 : 0
              const corEstado = COR_POR_ESTADO[estado] || '#9ca3af'
              return (
                <div key={estado} className={styles.barItem}>
                  <StatusBadge estado={estado} />
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${pct}%`, background: corEstado }} />
                  </div>
                  <span className={`${styles.barCount} mono`}>{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">{t('dashboard.ocupacaoAtual')}</div>
          <span className={styles.hintSmall}>{t('dashboard.ocupacaoSubtitle')}</span>
        </div>
        {ocupacaoPorTipo.length === 0 ? (
          <div className={styles.empty}>{t('dashboard.nenhumEquipamento')}</div>
        ) : (
          <div className={styles.ocupacaoGrid}>
            {ocupacaoPorTipo.map(([tipo, counts]) => {
              const pctDisp = counts.total ? Math.round((counts.disponivel / counts.total) * 100) : 0
              const pctOcup = counts.total ? Math.round((counts.ocupado / counts.total) * 100) : 0
              const pctAvar = counts.total ? Math.round((counts.avariado / counts.total) * 100) : 0
              return (
                <div key={tipo} className={styles.ocupacaoRow}>
                  <div className={styles.ocupacaoTipo}>{tipo}</div>
                  <div className={styles.ocupacaoBar}>
                    {pctDisp > 0 && <div style={{ width: `${pctDisp}%`, background: '#10b981' }} title={`Disponível: ${counts.disponivel}`} />}
                    {pctOcup > 0 && <div style={{ width: `${pctOcup}%`, background: '#f59e0b' }} title={`Ocupado: ${counts.ocupado}`} />}
                    {pctAvar > 0 && <div style={{ width: `${pctAvar}%`, background: '#c8102e' }} title={`Avariado: ${counts.avariado}`} />}
                    {counts.outros > 0 && <div style={{ width: `${100 - pctDisp - pctOcup - pctAvar}%`, background: '#a855f7' }} title={`Outros: ${counts.outros}`} />}
                  </div>
                  <div className={styles.ocupacaoStats}>
                    <span style={{ color: '#10b981' }}>{counts.disponivel}</span>
                    <span style={{ color: 'var(--text-dim)' }}>/</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{counts.total}</span>
                  </div>
                </div>
              )
            })}
            <div className={styles.ocupacaoLegenda}>
              <span style={{ color: '#10b981' }}>● {t('dashboard.disponivel')}</span>
              <span style={{ color: '#f59e0b' }}>● {t('dashboard.ocupado')}</span>
              <span style={{ color: '#c8102e' }}>● {t('dashboard.avariado')}</span>
              <span style={{ color: '#a855f7' }}>● {t('dashboard.outrosEstados')}</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">{t('dashboard.performanceOEE')}</div>
        </div>
        <div className={styles.oeeTableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('common.equipment')}</th>
                <th>{t('common.type')}</th>
                <th>{t('dashboard.planeadoAteAgora')}</th>
                <th>{t('dashboard.tempoReal')}</th>
                <th>{t('dashboard.performanceOEE')}</th>
              </tr>
            </thead>
            <tbody>
              {equipamentos.length > 0 ? equipamentos.map((eq) => {
                const oeeItem = oeeMapDinamico[eq.id]
                const oeePct = oeeItem?.oee_dinamico_pct
                const desvio = oeeItem?.desvio_dinamico_pct ?? 0
                const temDesvio = desvio > 0
                // Laranja quando o tempo real excedeu o planeado até agora
                const corBarra = temDesvio ? '#f97316' : (oeePct !== null && oeePct !== undefined ? corOEE(oeePct) : '#d1d5db')
                return (
                  <tr key={eq.id} onClick={() => navigate(`/equipamentos/${eq.id}`)} className={styles.tableRow}>
                    <td style={{ fontWeight: 500 }}>{eq.nome}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>
                    <td className="mono">
                      {oeeItem && oeeItem.tempo_disponivel_h > 0
                        ? oeeItem.tempo_disponivel_h.toFixed(1)
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td className="mono">{oeeItem ? (oeeItem.tempo_real_h ?? 0).toFixed(1) : '—'}</td>
                    <td>
                      {oeePct !== null && oeePct !== undefined ? (
                        <>
                          <strong style={{ color: corBarra }}>
                            {temDesvio ? `100% (+${desvio.toFixed(0)}%)` : `${oeePct.toFixed(1)}%`}
                          </strong>
                          <div className={styles.miniMeter} style={{ marginTop: 4 }}>
                            <div className={styles.miniMeterFill} style={{ width: `${oeePct}%`, background: corBarra }} />
                          </div>
                        </>
                      ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={5} className={styles.empty}>{t('dashboard.nenhumEquipamentoOEE')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">{t('dashboard.tendenciaOEE')}</div>
          {oeeMediaHistorico !== null && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('dashboard.media')}: <strong style={{ color: corOEE(oeeMediaHistorico) }}>{oeeMediaHistorico}%</strong>
            </span>
          )}
        </div>
        {oeeHistorico.length < 2 ? (
          <div className={styles.empty}>{t('dashboard.dadosInsuficientes')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={oeeHistorico} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="data"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={(v) => {
                  const [, m, d] = v.split('-')
                  return `${d}/${m}`
                }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                formatter={(value) => [`${value.toFixed(1)}%`, 'OEE']}
                labelFormatter={(label) => {
                  const [y, m, d] = label.split('-')
                  return `${d}/${m}/${y}`
                }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                }}
              />
              {oeeMediaHistorico !== null && (
                <ReferenceLine
                  y={oeeMediaHistorico}
                  stroke={corOEE(oeeMediaHistorico)}
                  strokeDasharray="4 4"
                  label={{ value: t('dashboard.mediaOee', { value: oeeMediaHistorico }), position: 'insideTopRight', fontSize: 10, fill: corOEE(oeeMediaHistorico) }}
                />
              )}
              <Line
                type="monotone"
                dataKey="oee_pct"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
