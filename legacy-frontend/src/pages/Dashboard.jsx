import { useEffect, useState, useMemo } from 'react'
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
import styles from './Dashboard.module.css'
import { corDoUtilizador, hexToRgba } from '../utils/coresUtilizadores.js'

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
      // OEE summary é carregado em paralelo sem bloquear o resto do dashboard
      api.oeeGlobalSummary(30).then(setOeeData).catch(() => {})
    } catch (e) {
      setErro(e.message)
      toast.error(`Falha ao carregar dashboard: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveReservation = async (e) => {
    e.preventDefault()
    if (!selectionInfo || !reservaForm.utilizador_id) {
      toast.error('Seleciona um utilizador para criar a reserva.')
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
      toast.success('Reserva criada com sucesso no calendário.')
      setIsModalOpen(false)
      setReservaForm({ utilizador_id: '', projeto: '', notas: '' })
      await carregarDados()
    } catch (error) {
      toast.error(`Erro ao gravar reserva: ${error.message}`)
    }
  }

  const handleExportPDF = () => {
    // Reutiliza a rotina de exportar planeamento em PDF (download via API)
    handleExportarPlaneamentoPdf()
  }

  const handleShareTeams = () => {
    const url = window.location.href
    const teamsUrl = `https://teams.microsoft.com/l/chat/0/0?users=&message=Segue o relatório do Dashboard do Laboratório: ${url}`
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
      a.download = `planeamento-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('PDF do planeamento exportado com sucesso.')
    } catch (error) {
      toast.error(error.message || 'Não foi possível exportar o PDF do planeamento.')
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

  const oeeIndividualMap = useMemo(() => {
    if (!oeeData?.individual) return {}
    return Object.fromEntries(oeeData.individual.map(item => [item.id, item]))
  }, [oeeData])

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
        <div>
          <h1 className={styles.title}>Dashboard do Laboratório</h1>
        </div>
        <div className={styles.headerRight}>
          <span className="badge badge-ok">Sistema online</span>
          <div className={styles.actionGroup}>
            <button className={styles.btnExportPdf} onClick={handleExportPDF}>
              <FileDown size={15} strokeWidth={2} />
              Exportar PDF
            </button>
            <button
              className={styles.btnShare}
              onClick={handleShareTeams}
              title="Partilhar no Microsoft Teams"
              aria-label="Partilhar no Microsoft Teams"
            >
              <BsMicrosoftTeams size={18} color="#6264A7" />
            </button>
          </div>
        </div>
      </div>

      <section className={styles.heroGrid}>
        <article className={`${styles.heroCard} ${styles[`heroCard_${statusVisual}`]}`}>
          <div className={styles.heroTop}>
            <span className={styles.heroLabel}>Estado operacional</span>
            <span className={`${styles.heroValue} ${styles[`heroValue_${statusVisual}`]}`}>{taxaDisponibilidade}%</span>
          </div>
          <div className={styles.heroTrack}>
            <div className={`${styles.heroTrackFill} ${styles[`heroTrackFill_${statusVisual}`]}`} style={{ width: `${taxaDisponibilidade}%` }} />
          </div>
          <div className={styles.heroMeta}>
            <span>{disponiveis} disponíveis</span>
            <span>{total} total</span>
          </div>
        </article>

        <article className={styles.alertCard}>
          <div className={styles.alertTitle}>Atenção necessária</div>
          {semAlertasCriticos ? (
            <div className={styles.goodNews}>Sem falhas críticas no momento.</div>
          ) : (
            <>
              <div className={styles.alertNumbers}>
                <div><strong>{avariados}</strong> avariados</div>
                <div><strong>{manut}</strong> manutenção</div>
                <div><strong>{calib}</strong> calibração</div>
                <div><strong>{ocupados}</strong> ocupados</div>
              </div>
              <div className={styles.alertFoot}>{taxaAvarias > 0 ? `${taxaAvarias}% da frota com avaria.` : 'Monitorização ativa em curso.'}</div>
            </>
          )}
        </article>
      </section>

      {/* ── OEE Global – 3 Cards proeminentes ── */}
      <section className={styles.oeeSection}>
        <article className={styles.oeeCard}>
          <div className={styles.oeeCardLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            OEE Global
            <span
              title="OEE baseado na relação entre tempo de uso real e tempo reservado. Equipamentos sem reservas são excluídos da média."
              style={{ cursor: 'help', fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              ?
            </span>
          </div>
          <div className={styles.oeeCardMain}>
            <RadialGauge value={oeeData?.oee_global ?? null} />
            <div>
              <div
                className={styles.oeeCardValue}
                style={{ color: oeeData?.oee_global !== null && oeeData?.oee_global !== undefined ? corOEE(oeeData.oee_global) : 'var(--text-dim)' }}
              >
                {oeeData?.oee_global !== null && oeeData?.oee_global !== undefined ? `${oeeData.oee_global.toFixed(1)}%` : '—'}
              </div>
              <div className={styles.oeeCardSub}>Média dos equipamentos com reservas</div>
            </div>
          </div>
        </article>

        <article className={styles.oeeCard}>
          <div className={styles.oeeCardLabel}>Disponibilidade Global</div>
          <div
            className={styles.oeeCardValue}
            style={{ color: oeeData?.disponibilidade_global !== null && oeeData?.disponibilidade_global !== undefined ? corOEE(oeeData.disponibilidade_global) : 'var(--text-dim)', marginTop: 10 }}
          >
            {oeeData?.disponibilidade_global !== null && oeeData?.disponibilidade_global !== undefined ? `${oeeData.disponibilidade_global.toFixed(1)}%` : '—'}
          </div>
          <div className={styles.miniMeter} style={{ marginTop: 12 }}>
            <div
              className={styles.miniMeterFill}
              style={{
                width: `${Math.min(100, oeeData?.disponibilidade_global ?? 0)}%`,
                backgroundColor: corOEE(oeeData?.disponibilidade_global ?? 0),
              }}
            />
          </div>
          <div className={styles.oeeCardSub} style={{ marginTop: 8 }}>Tempo Real / Tempo Planeado</div>
        </article>

        <article className={styles.oeeCard}>
          <div className={styles.oeeCardLabel}>Performance Global</div>
          <div
            className={styles.oeeCardValue}
            style={{ color: corOEE(oeeData?.performance_global ?? 100), marginTop: 10 }}
          >
            {oeeData ? `${(oeeData.performance_global ?? 100).toFixed(0)}%` : '—'}
          </div>
          <div className={styles.miniMeter} style={{ marginTop: 12 }}>
            <div
              className={styles.miniMeterFill}
              style={{
                width: `${oeeData?.performance_global ?? 0}%`,
                backgroundColor: corOEE(oeeData?.performance_global ?? 100),
              }}
            />
          </div>
          <div className={styles.oeeCardSub} style={{ marginTop: 8 }}>Qualidade e Cadência assumidas = 100%</div>
        </article>
      </section>

      <section className={styles.kpiRow}>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Equipamentos</span>
          <strong>{total}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Reservas ativas</span>
          <strong>{reservas.length}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Utilizadores</span>
          <strong>{utilizadores.length}</strong>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Disponibilidade</span>
          <strong>{taxaDisponibilidade}%</strong>
        </div>
      </section>

      <section className={styles.dualGrid}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className="label">Próximas Reservas</div>
            <Link to="/reservas" className={styles.seeAll}>Ver calendário →</Link>
          </div>

          {proximasReservas.length === 0 ? (
            <div className={styles.empty}>Sem reservas futuras.</div>
          ) : (
            <ul className={styles.timeline}>
              {proximasReservas.map((r) => (
                <li key={r.id} className={styles.timelineItem}>
                  <div>
                    <div className={styles.timelineTitle}>{r.equipamento_nome || `Equipamento #${r.equipamento_id}`}</div>
                    <div className={styles.timelineMeta}>{r.utilizador_nome || 'Utilizador não definido'} {r.projeto ? `• ${r.projeto}` : ''}</div>
                  </div>
                  <div className={styles.timelineDate}>
                    {new Date(r.data_inicio).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.section}>
          <div className="label" style={{ marginBottom: 14 }}>Distribuição por Estado</div>
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
          <div className="label">Planeamento Global</div>
          <div className={styles.sectionActions}>
            <button
              className={styles.exportBtn}
              onClick={handleExportarPlaneamentoPdf}
              disabled={exportingPlaneamento}
            >
              {exportingPlaneamento ? 'A exportar...' : 'Exportar PDF'}
            </button>
            <span className={styles.hint}>Seleciona no calendário para criar reserva</span>
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
                resourceAreaHeaderContent="Equipamentos"
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
                    title: `${res.projeto || 'Reserva'} - ${res.utilizador_nome || 'Utilizador'}`,
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
          <div className="label">Performance OEE</div>
        </div>
        <div className={styles.oeeTableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Equipamento</th>
                <th>Tipo</th>
                <th>Tempo Planeado (h)</th>
                <th>Tempo Real (h)</th>
                <th>Performance OEE</th>
              </tr>
            </thead>
            <tbody>
              {recentes.length > 0 ? recentes.map((eq) => {
                const oeeItem = oeeIndividualMap[eq.id]
                const oeePct = oeeItem?.oee_pct          // sempre ≤ 100% (capped no backend)
                const desvio = oeeItem?.desvio_planeamento_pct ?? 0
                const temDesvio = desvio > 0
                // Cor de aviso laranja quando o tempo real excedeu o planeado
                const corBarra = temDesvio ? '#f97316' : (oeePct !== null && oeePct !== undefined ? corOEE(oeePct) : '#d1d5db')
                return (
                  <tr key={eq.id} onClick={() => navigate(`/equipamentos/${eq.id}`)} className={styles.tableRow}>
                    <td style={{ fontWeight: 500 }}>{eq.nome}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>
                    <td className="mono">{oeeItem ? oeeItem.tempo_planeado_h.toFixed(1) : '—'}</td>
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
                <tr><td colSpan={5} className={styles.empty}>Nenhum equipamento com dados de OEE.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">Últimos Equipamentos Registados</div>
          <Link to="/equipamentos" className={styles.seeAll}>Ver todos →</Link>
        </div>

        {loading && <div className={styles.empty}>A carregar...</div>}
        {erro && <div className={styles.erro}>Erro: {erro}</div>}

        {!loading && !erro && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Localização</th>
                <th>Estado</th>
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
                <tr><td colSpan={5} className={styles.empty}>Nenhum equipamento registado ainda.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>Nova Reserva de Equipamento</h3>
            <form onSubmit={handleSaveReservation} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>Operador Responsável</label>
                <select
                  value={reservaForm.utilizador_id}
                  onChange={(ev) => setReservaForm((s) => ({ ...s, utilizador_id: ev.target.value }))}
                  required
                >
                  <option value="">Selecionar utilizador...</option>
                  {utilizadores.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} ({u.departamento})</option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Projeto / ID do Ensaio</label>
                <input
                  type="text"
                  value={reservaForm.projeto}
                  placeholder="Ex: Lab-EV-Phase2"
                  onChange={(ev) => setReservaForm((s) => ({ ...s, projeto: ev.target.value }))}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Notas (opcional)</label>
                <input
                  type="text"
                  value={reservaForm.notas}
                  placeholder="Detalhes rápidos da reserva"
                  onChange={(ev) => setReservaForm((s) => ({ ...s, notas: ev.target.value }))}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className={styles.btnSave}>
                  Confirmar Reserva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
