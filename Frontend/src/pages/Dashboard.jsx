import { useEffect, useState, useMemo } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { FileDown } from 'lucide-react'
import { BsMicrosoftTeams } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import interactionPlugin from '@fullcalendar/interaction'

import { api } from '../api/index.js'
import StatusBadge, { normalizarEstadoEquipamento } from '../components/StatusBadge.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Dashboard.module.css'
import { corDoUtilizador, hexToRgba } from '../utils/coresUtilizadores.js'
import {
  calcularTotalPlaneadoAteAgoraH,
  calcularOEEDinamico,
  calcularDesvioDinamico,
} from '../utils/calculations.js'

// Cor dinâmica OEE: Vermelho (<50%), Amarelo (50–85%), Verde (>85%)
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
  'Ocupado': '#6b7280',
  'Avariado': '#c8102e',
  'Em manutenção': '#a855f7',
  'Em calibração': '#3b82f6'
}

export default function Dashboard() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const [equipamentos, setEquipamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [reservas, setReservas] = useState([])
  const [erro, setErro] = useState(null)
  const [utilizadores, setUtilizadores] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectionInfo, setSelectionInfo] = useState(null)
  const [reservaForm, setReservaForm] = useState({ utilizador_id: '', projeto: '', notas: '' })
  const [exportingPlaneamento, setExportingPlaneamento] = useState(false)
  const [oeeData, setOeeData] = useState(null)
  const [oeeHistorico, setOeeHistorico] = useState([])

  const handleDateSelect = (selectInfo) => {
    setSelectionInfo(selectInfo)
    setIsModalOpen(true)
  }

  const carregarDados = async () => {
    setLoading(true)
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
      // OEE summary e histórico carregados em paralelo sem bloquear o dashboard
      api.oeeGlobalSummary(30).then(setOeeData).catch(() => {})
      api.oeeHistorico(30).then(setOeeHistorico).catch(() => {})
    } catch (e) {
      setErro(e.message)
      toast.error(t('dashboard.erroCarregarDashboard', { msg: e.message }))
    } finally {
      setLoading(false)
    }
  }

  const handleSaveReservation = async (e) => {
    e.preventDefault()
    if (!selectionInfo || !reservaForm.utilizador_id) {
      toast.error(t('dashboard.erroSelecionarUtilizador'))
      return
    }

    const novaReserva = {
      equipamento_id: Number(selectionInfo.resource.id),
      data_inicio: selectionInfo.startStr,
      data_fim: selectionInfo.endStr,
      utilizador_id: Number(reservaForm.utilizador_id),
      projeto: reservaForm.projeto || null,
      notas: reservaForm.notas || null,
    }

    try {
      await api.criarReserva(novaReserva)
      toast.success(t('dashboard.sucessoReservaCriada'))
      setIsModalOpen(false)
      setReservaForm({ utilizador_id: '', projeto: '', notas: '' })
      await carregarDados()
    } catch (error) {
      toast.error(t('dashboard.erroGravarReserva', { msg: error.message }))
    }
  }

  const handleExportPDF = () => {
    // Reutiliza a rotina de exportar planeamento em PDF (download via API)
    handleExportarPlaneamentoPdf()
  }

  const handleShareTeams = () => {
    const url = window.location.href
    const teamsUrl = `https://teams.microsoft.com/l/chat/0/0?users=&message=${encodeURIComponent('Segue o relatório do Dashboard do Laboratório: ' + url)}`
    window.open(teamsUrl, '_blank')
  }

  const handleExportarPlaneamentoPdf = async () => {
    setExportingPlaneamento(true)
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
      setExportingPlaneamento(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [user?.role])

  const { total, avariados, disponiveis, calib, manut, ocupados, recentes } = useMemo(() => {
    const list = equipamentos || []
    const estadosNormalizados = list.map((e) => normalizarEstadoEquipamento(e.estado_atual))
    return {
      total: list.length,
      avariados: estadosNormalizados.filter((estado) => estado === 'Avariado').length,
      disponiveis: estadosNormalizados.filter((estado) => estado === 'Disponível').length,
      calib: estadosNormalizados.filter((estado) => estado === 'Em calibração').length,
      manut: estadosNormalizados.filter((estado) => estado === 'Em manutenção').length,
      ocupados: estadosNormalizados.filter((estado) => estado === 'Ocupado').length,
      recentes: [...list].sort((a, b) => b.id - a.id).slice(0, 6),
    }
  }, [equipamentos])

  const proximasReservas = useMemo(() => {
    const agora = Date.now()
    return [...reservas]
      .filter((r) => new Date(r.data_inicio).getTime() >= agora)
      .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
      .slice(0, 4)
  }, [reservas])

  const reservasPorEquipamento = useMemo(() => {
    const map = {}
    for (const r of reservas) {
      if (!map[r.equipamento_id]) map[r.equipamento_id] = []
      map[r.equipamento_id].push(r)
    }
    return map
  }, [reservas])

  // Recalcula OEE por equipamento usando janelamento temporal até ao momento atual.
  // Reservas futuras (planeadoAteAgora == 0) são excluídas da média global.
  const { oeeMapDinamico, oeeGlobalDinamico } = useMemo(() => {
    if (!oeeData?.individual) return { oeeMapDinamico: {}, oeeGlobalDinamico: null }

    const map = {}
    const oeesValidos = []

    for (const item of oeeData.individual) {
      const reservasEq = reservasPorEquipamento[item.id] || []
      const planeadoAteAgoraH = calcularTotalPlaneadoAteAgoraH(reservasEq)
      const oeeDinamico = calcularOEEDinamico(item.tempo_real_h, planeadoAteAgoraH)
      const desvioDinamico = calcularDesvioDinamico(item.tempo_real_h, planeadoAteAgoraH)

      map[item.id] = {
        ...item,
        planeado_ate_agora_h: planeadoAteAgoraH,
        oee_dinamico_pct: oeeDinamico,
        desvio_dinamico_pct: desvioDinamico,
      }
      if (oeeDinamico !== null) oeesValidos.push(oeeDinamico)
    }

    const global = oeesValidos.length > 0
      ? Math.round(oeesValidos.reduce((a, b) => a + b, 0) / oeesValidos.length * 10) / 10
      : null

    return { oeeMapDinamico: map, oeeGlobalDinamico: global }
  }, [oeeData, reservasPorEquipamento])

  const oeeMediaHistorico = useMemo(() => {
    if (!oeeHistorico.length) return null
    return Math.round(oeeHistorico.reduce((acc, d) => acc + d.oee_pct, 0) / oeeHistorico.length)
  }, [oeeHistorico])

  const taxaDisponibilidade = total ? Math.round((disponiveis / total) * 100) : 0
  const taxaAvarias = total ? Math.round((avariados / total) * 100) : 0
  const semAlertasCriticos = avariados === 0 && manut === 0 && calib === 0
  const statusVisual = total === 0
    ? 'neutral'
    : taxaDisponibilidade < 50
      ? 'critical'
      : 'healthy'

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <PageHeader titulo={t('dashboard.titleLab')} isDashboard={true} />
        <div className={styles.headerRight}>
          <span className="badge badge-ok">{t('dashboard.sistemaOnline')}</span>
          <div className={styles.actionGroup}>
            <button
              className={styles.btnExportPdf}
              onClick={handleExportPDF}
              disabled={exportingPlaneamento}
            >
              <FileDown size={15} strokeWidth={2} />
              {exportingPlaneamento ? t('dashboard.aExportar') : t('dashboard.exportarPdf')}
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
                <div><strong>{avariados}</strong> {t('dashboard.avariados')}</div>
                <div><strong>{manut}</strong> {t('dashboard.manutencao')}</div>
                <div><strong>{calib}</strong> {t('dashboard.calibracao')}</div>
                <div><strong>{ocupados}</strong> {t('dashboard.ocupados')}</div>
              </div>
              <div className={styles.alertFoot}>{taxaAvarias > 0 ? t('dashboard.frotaAvaria', { percent: taxaAvarias }) : t('dashboard.monitorizacaoAtiva')}</div>
            </>
          )}
        </article>
      </section>

      {/* ── OEE Global – 3 Cards proeminentes ── */}
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
          <strong>{reservas.length}</strong>
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
              const corEstado = COR_POR_ESTADO[estado] || '#9ca3af'  // Cinza padrão se não mapeado
              return (
                <div key={estado} className={styles.barItem}>
                  <StatusBadge estado={estado} />
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${pct}%`, background: corEstado }}
                    />
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
          <div className="label">{t('dashboard.planeamentoGlobal')}</div>
          <div className={styles.sectionActions}>
            <button
              className={styles.exportBtn}
              onClick={handleExportarPlaneamentoPdf}
              disabled={exportingPlaneamento}
            >
              {exportingPlaneamento ? t('dashboard.aExportar') : t('dashboard.exportarPdf')}
            </button>
            <span className={styles.hint}>{t('dashboard.selecionaCalendario')}</span>
          </div>
        </div>
        <div className={styles.calendarWrap}>
          <div className={styles.calendarScroller}>
            {!loading && (
              <FullCalendar
                plugins={[resourceTimelinePlugin, interactionPlugin]}
                schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
                initialView="resourceTimelineDay"
                selectable
                select={handleDateSelect}
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'resourceTimelineDay,resourceTimelineMonth,resourceTimelineYear',
                }}
                locale="pt"
                height="390px"
                resourceAreaWidth="240px"
                resourceAreaHeaderContent={t('equipamentos.title')}
                slotMinWidth={56}
                views={{
                  resourceTimelineDay: {
                    buttonText: 'dia',
                    slotDuration: '01:00:00',
                    slotMinTime: '00:00:00',
                    slotMaxTime: '24:00:00',
                    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
                  },
                  resourceTimelineMonth: {
                    buttonText: 'mês',
                    slotDuration: { days: 1 },
                    slotLabelInterval: { days: 1 },
                    slotLabelFormat: [{ month: 'long', year: 'numeric' }, { day: '2-digit' }],
                  },
                  resourceTimelineYear: {
                    buttonText: 'ano',
                    slotDuration: { months: 1 },
                    slotLabelFormat: { month: 'long' },
                  },
                }}
                resources={(equipamentos || []).map((eq) => ({
                  id: String(eq.id),
                  title: eq.nome,
                }))}
                events={(reservas || []).map((res) => {
                  const agora = Date.now()
                  const emCurso = new Date(res.data_inicio).getTime() <= agora && new Date(res.data_fim).getTime() >= agora
                  const cor = corDoUtilizador(res.utilizador_id)
                  return {
                    id: String(res.id),
                    resourceId: String(res.equipamento_id),
                    title: `${res.projeto || t('reservas.title')} - ${res.utilizador_nome || t('common.user')}`,
                    start: res.data_inicio,
                    end: res.data_fim,
                    backgroundColor: emCurso ? cor : hexToRgba(cor, 0.28),
                    borderColor: cor,
                    textColor: emCurso ? '#ffffff' : cor,
                  }
                })}
              />
            )}
          </div>
        </div>
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
              {recentes.length > 0 ? recentes.map((eq) => {
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
                      {oeeItem && oeeItem.planeado_ate_agora_h > 0
                        ? oeeItem.planeado_ate_agora_h.toFixed(1)
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td className="mono">{oeeItem ? oeeItem.tempo_real_h.toFixed(1) : '—'}</td>
                    <td>
                      {oeePct !== null && oeePct !== undefined ? (
                        <>
                          <strong style={{ color: corBarra }}>
                            {temDesvio ? `100% (+${desvio.toFixed(0)}%)` : `${oeePct.toFixed(1)}%`}
                          </strong>
                          <div className={styles.miniMeter} style={{ marginTop: 4 }}>
                            <div
                              className={styles.miniMeterFill}
                              style={{ width: `${oeePct}%`, background: corBarra }}
                            />
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

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">{t('dashboard.ultimosEquipamentos')}</div>
          <Link to="/equipamentos" className={styles.seeAll}>{t('dashboard.verTodos')}</Link>
        </div>

        {loading && <div className={styles.empty}>{t('common.loading')}</div>}
        {erro && <div className={styles.erro}>Erro: {erro}</div>}

        {!loading && !erro && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('common.name')}</th>
                <th>{t('common.type')}</th>
                <th>{t('common.location')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {recentes.map((eq) => (
                <tr key={eq.id} onClick={() => navigate(`/equipamentos/${eq.id}`)} className={styles.tableRow}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(eq.id).padStart(3, '0')}</td>
                  <td style={{ fontWeight: 500 }}>{eq.nome}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{eq.localizacao}</td>
                  <td><StatusBadge estado={eq.estado_atual} /></td>
                </tr>
              ))}
              {recentes.length === 0 && (
                <tr><td colSpan={5} className={styles.empty}>{t('dashboard.nenhumEquipamento')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>{t('dashboard.novaReserva')}</h3>
            <form onSubmit={handleSaveReservation} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>{t('dashboard.operadorResponsavel')}</label>
                <select
                  value={reservaForm.utilizador_id}
                  onChange={(ev) => setReservaForm((s) => ({ ...s, utilizador_id: ev.target.value }))}
                  required
                >
                  <option value="">{t('dashboard.selecionarUtilizador')}</option>
                  {utilizadores.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} ({u.departamento})</option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>{t('dashboard.projetoEnsaio')}</label>
                <input
                  type="text"
                  value={reservaForm.projeto}
                  placeholder={t('dashboard.projetoPlaceholder')}
                  onChange={(ev) => setReservaForm((s) => ({ ...s, projeto: ev.target.value }))}
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('dashboard.notasOpcional')}</label>
                <input
                  type="text"
                  value={reservaForm.notas}
                  placeholder={t('dashboard.notasPlaceholder')}
                  onChange={(ev) => setReservaForm((s) => ({ ...s, notas: ev.target.value }))}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setIsModalOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className={styles.btnSave}>
                  {t('dashboard.confirmarReserva')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}