import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge from '../components/StatusBadge.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Dashboard.module.css'
import FullCalendar from '@fullcalendar/react'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import interactionPlugin from '@fullcalendar/interaction'

const ESTADOS = ['Em funcionamento', 'NOK', 'Ocupado', 'Em calibração', 'Em manutenção']

export default function Dashboard() {
  const toast = useToast()
  const navigate = useNavigate()
  const [equipamentos, setEquipamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [reservas, setReservas] = useState([])
  const [erro, setErro] = useState(null)
  const [utilizadores, setUtilizadores] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectionInfo, setSelectionInfo] = useState(null)
  const [reservaForm, setReservaForm] = useState({ utilizador_id: '', projeto: '', notas: '' })
  const [exportingPlaneamento, setExportingPlaneamento] = useState(false)

  const handleDateSelect = (selectInfo) => {
    setSelectionInfo(selectInfo)
    setIsModalOpen(true)
  }

  const carregarDados = async () => {
    setLoading(true)
    try {
      const [eqs, ress, utils] = await Promise.all([
        api.listarEquipamentos(),
        api.listarReservas(),
        api.listarUtilizadores(),
      ])
      setEquipamentos(eqs || [])
      setReservas(ress || [])
      setUtilizadores(utils || [])
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

  useEffect(() => { carregarDados() }, [])

  const { total, nok, ok, calib, manut, ocupados, recentes } = useMemo(() => {
    const list = equipamentos || []
    return {
      total: list.length,
      nok: list.filter(e => e.estado_atual === 'NOK').length,
      ok: list.filter(e => e.estado_atual === 'Em funcionamento').length,
      calib: list.filter(e => e.estado_atual === 'Em calibração').length,
      manut: list.filter(e => e.estado_atual === 'Em manutenção').length,
      ocupados: list.filter(e => e.estado_atual === 'Ocupado').length,
      recentes: [...list].sort((a, b) => b.id - a.id).slice(0, 6),
    }
  }, [equipamentos])

  const proximasReservas = useMemo(() => {
    const agora = Date.now()
    return [...reservas]
      .filter(r => new Date(r.data_inicio).getTime() >= agora)
      .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
      .slice(0, 4)
  }, [reservas])

  const taxaDisponibilidade = total ? Math.round((ok / total) * 100) : 0
  const taxaNok = total ? Math.round((nok / total) * 100) : 0
  const semAlertasCriticos = nok === 0 && manut === 0 && calib === 0
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
          <button className={styles.quickAction} onClick={() => navigate('/reservas')}>
            + Registo Rápido
          </button>
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
            <span>{ok} em funcionamento</span>
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
                <div><strong>{nok}</strong> NOK</div>
                <div><strong>{manut}</strong> manutenção</div>
                <div><strong>{calib}</strong> calibração</div>
                <div><strong>{ocupados}</strong> ocupado</div>
              </div>
              <div className={styles.alertFoot}>{taxaNok > 0 ? `${taxaNok}% da frota com avaria.` : 'Monitorização ativa em curso.'}</div>
            </>
          )}
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
              const count = equipamentos.filter((e) => e.estado_atual === estado).length
              const pct = total ? (count / total) * 100 : 0
              return (
                <div key={estado} className={styles.barItem}>
                  <StatusBadge estado={estado} />
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${pct}%` }} />
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
              {exportingPlaneamento ? 'A exportar…' : 'Exportar PDF'}
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
                events={(reservas || []).map((res) => ({
                  id: String(res.id),
                  resourceId: String(res.equipamento_id),
                  title: `${res.projeto || 'Reserva'} - ${res.utilizador_nome || 'Utilizador'}`,
                  start: res.data_inicio,
                  end: res.data_fim,
                  color: '#c8102e',
                }))}
                eventTextColor="#ffffff"
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className="label">Últimos Equipamentos Registados</div>
          <Link to="/equipamentos" className={styles.seeAll}>Ver todos →</Link>
        </div>

        {loading && <div className={styles.empty}>A carregar...</div>}
        {erro    && <div className={styles.erro}>Erro: {erro}</div>}

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
                  placeholder="Ex: Yazaki-EV-Phase2"
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