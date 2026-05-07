import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptLocale from '@fullcalendar/core/locales/pt'
import { History } from 'lucide-react'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import styles from './Reservas.module.css'
import { useReservas } from '../hooks/useReservas.js'
import { corDoUtilizador } from '../utils/coresUtilizadores.js'



export default function Reservas({startOpenModal = false}) {
  const toast = useToast()
  const { user } = useAuth()
  const { eventos, reservas, equipamentos, utilizadores, loading, reload, createReserva, reservasPorDia, exportPdf } = useReservas(user?.role)

  // Dropdown ao clicar num dia
  const [dropdown, setDropdown] = useState(null) // { data, x, y, reservas[] }

  // Modal nova reserva
  const [modal, setModal] = useState(startOpenModal)
  const [form, setForm] = useState({ equipamento_id: '', utilizador_id: '', projeto: '', data_inicio: '', data_fim: '', notas: '' })
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const calendarRef = useRef(null)

  // Pré-preencher form quando startOpenModal é true (vindo de /equipamentos/:id/reserva)
  useEffect(() => {
    if (startOpenModal && user && String(user.role).toLowerCase() !== 'admin' && user.id) {
      setForm(f => ({ ...f, utilizador_id: String(user.id) }))
    }
  }, [startOpenModal, user])

  const formatLocalInput = useCallback((date) => {
    const d = new Date(date)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }, [])

  const setDuracaoHoras = useCallback((horas) => {
    if (!form.data_inicio) return
    const inicio = new Date(form.data_inicio)
    const fim = new Date(inicio.getTime() + horas * 60 * 60 * 1000)
    setForm((f) => ({ ...f, data_fim: formatLocalInput(fim) }))
  }, [form.data_inicio, formatLocalInput])

  const reservasLista = useMemo(() => {
    const agora = Date.now()
    const base = mostrarHistorico
      ? reservas
      : reservas.filter((reserva) => new Date(reserva.data_fim).getTime() >= agora)

    return [...base].sort((a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime())
  }, [mostrarHistorico, reservas])

  // Pré-preencher o formulário com o utilizador logado se for um user
  const abrirModalNovaReserva = useCallback((preenchimento = {}) => {
    const novoForm = {
      equipamento_id: preenchimento.equipamento_id || '',
      utilizador_id: '',
      projeto: '',
      data_inicio: preenchimento.data_inicio || '',
      data_fim: preenchimento.data_fim || '',
      notas: ''
    }

    if (user && String(user.role).toLowerCase() !== 'admin' && user.id) {
      novoForm.utilizador_id = String(user.id)
    } else if (preenchimento.utilizador_id) {
      novoForm.utilizador_id = String(preenchimento.utilizador_id)
    }

    setForm(novoForm)
    setFormErro('')
    setModal(true)
  }, [user])

  // Clique num dia — abre dropdown com utilizadores reservados nesse dia
  const handleDateClick = useCallback(async (info) => {
    const rect = info.jsEvent.target.getBoundingClientRect()
    const data = info.dateStr // YYYY-MM-DD
    try {
      const reservasDia = await reservasPorDia(data)
      setDropdown({
        data,
        x: rect.left,
        y: rect.bottom + window.scrollY + 4,
        reservas: reservasDia,
      })
    } catch {
      toast.error('Não foi possível carregar as reservas desse dia.')
      setDropdown({ data, x: rect.left, y: rect.bottom + window.scrollY + 4, reservas: [] })
    }
  }, [reservasPorDia, toast])

  // Seleção direta no calendário (vista semanal/diária) para reservas por hora
  const handleTimeSelect = (info) => {
    abrirModalNovaReserva({
      data_inicio: formatLocalInput(info.start),
      data_fim: formatLocalInput(info.end),
    })
  }

  const handleSubmit = useCallback(async () => {
    if (!form.equipamento_id || !form.utilizador_id || !form.data_inicio || !form.data_fim) {
      setFormErro('Preenche os campos obrigatórios.')
      toast.error('Faltam campos obrigatórios na reserva.')
      return
    }

    const inicio = new Date(form.data_inicio)
    const fim = new Date(form.data_fim)
    const duracaoMs = fim.getTime() - inicio.getTime()

    const horaCheia = (d) => d.getMinutes() === 0 && d.getSeconds() === 0
    if (!horaCheia(inicio) || !horaCheia(fim)) {
      setFormErro('As reservas devem iniciar e terminar em hora cheia (ex: 09:00).')
      toast.error('Usa apenas horas cheias para reservar.')
      return
    }

    if (duracaoMs < 60 * 60 * 1000 || duracaoMs % (60 * 60 * 1000) !== 0) {
      setFormErro('A duração da reserva deve ser em horas inteiras (mínimo 1h).')
      toast.error('A reserva deve ter duração mínima de 1 hora e em horas inteiras.')
      return
    }

    setSaving(true)
    setFormErro('')
    try {
      await createReserva({
        equipamento_id: parseInt(form.equipamento_id),
        utilizador_id:  parseInt(form.utilizador_id),
        projeto:        form.projeto || null,
        data_inicio:    new Date(form.data_inicio).toISOString(),
        data_fim:       new Date(form.data_fim).toISOString(),
        notas:          form.notas || null,
      })
      toast.success('Reserva criada com sucesso.')
      setModal(false)
      setForm({ equipamento_id: '', utilizador_id: '', projeto: '', data_inicio: '', data_fim: '', notas: '' })
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar a reserva.')
    } finally {
      setSaving(false)
    }
  }, [createReserva, form, toast])

  const handleExportPdf = useCallback(async () => {
    setExporting(true)
    try {
      const blob = await exportPdf()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
      a.href = url
      a.download = `reservas-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('PDF de reservas exportado com sucesso.')
    } catch (e) {
      toast.error(e.message || 'Não foi possível exportar o PDF de reservas.')
    } finally {
      setExporting(false)
    }
  }, [exportPdf, toast])

  return (
    <div className="fade-up" onClick={() => setDropdown(null)}>
      <div className={styles.header}>
        <div>
          <div className="label">Calendário</div>
          <h1 className={styles.title}>Reservas</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.btnSecondary}
            onClick={e => { e.stopPropagation(); handleExportPdf() }}
            disabled={exporting}
          >
            {exporting ? 'A exportar…' : 'Exportar PDF'}
          </button>
          <button className={styles.btnPrimary} onClick={e => { e.stopPropagation(); abrirModalNovaReserva() }}>
            + Nova Reserva
          </button>
        </div>
      </div>

      {loading && <div className={styles.loading}>A carregar calendário…</div>}

      <div className={styles.calendarWrap} onClick={e => e.stopPropagation()}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={ptLocale}
          events={eventos}
          dateClick={handleDateClick}
          selectable
          select={handleTimeSelect}
          selectMirror
          slotDuration="01:00:00"
          snapDuration="01:00:00"
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth',
          }}
          height="auto"
          eventDisplay="block"
          dayMaxEvents={3}
          eventContent={(arg) => {
            const ev = arg.event.extendedProps
            const iniciais = ev.utilizador_iniciais || (ev.utilizador_nome ? ev.utilizador_nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : '??')
            return (
              <div
                className={`${styles.reservaBadge}${ev.esta_ativa ? ` ${styles.reservaBadgeAtiva}` : ''}`}
                style={{ backgroundColor: corDoUtilizador(ev.utilizador_id) }}
              >
                {iniciais}
              </div>
            )
          }}
          eventDidMount={(info) => {
            const ev = info.event.extendedProps
            const start = new Date(info.event.start)
            const end = new Date(info.event.end)
            const pad = (n) => String(n).padStart(2, '0')
            const periodo = `${pad(start.getHours())}:${pad(start.getMinutes())} - ${pad(end.getHours())}:${pad(end.getMinutes())}`
            info.el.style.overflow = 'visible'
            if (ev.tipo === 'planeado') {
              info.el.style.opacity = '0.45'
              info.el.setAttribute('title', `[PLANEADO] ${ev.utilizador_nome}\n${ev.equipamento_nome}\n${periodo}`)
            } else if (ev.tipo === 'real') {
              info.el.style.borderWidth = '2px'
              info.el.style.borderStyle = 'solid'
              const inicioPlaneado = ev.data_inicio ? new Date(ev.data_inicio) : null
              const desvioMin = inicioPlaneado ? Math.round((start.getTime() - inicioPlaneado.getTime()) / 60000) : null
              const desvioTexto = desvioMin === null ? '' : desvioMin === 0 ? '\nSem desvio de início' : desvioMin > 0 ? `\nInício real +${desvioMin}min vs planeado` : `\nInício real ${desvioMin}min vs planeado`
              const estadoTexto = ev.emCurso ? '\n[EM CURSO]' : '\n[CONCLUÍDO]'
              info.el.setAttribute('title', `[REAL] ${ev.utilizador_nome}\n${ev.equipamento_nome}\n${periodo}${desvioTexto}${estadoTexto}`)
            } else {
              info.el.setAttribute('title', `${ev.utilizador_nome}\n${ev.equipamento_nome}\n${periodo}`)
            }
          }}
        />
      </div>

      <div className={styles.legenda}>
        <span className={styles.legendaItem}>
          <span className={styles.legendaDot} data-tipo="planeado" />
          Planeado
        </span>
        <span className={styles.legendaItem}>
          <span className={styles.legendaDot} data-tipo="ativo" />
          Em curso / Realizado
        </span>
      </div>

      <div className={styles.listaContainer} onClick={e => e.stopPropagation()}>
        <div className={styles.listaHeader}>
          <div>
            <div className="label">Reservas</div>
            <h2 className={styles.listaTitle}>Lista de Reservas</h2>
            <p className={styles.listaSubtitle}>
              {mostrarHistorico
                ? 'Mostra todas as reservas registadas, da mais recente para a mais antiga.'
                : 'Mostra apenas as reservas com fim igual ou posterior ao momento actual.'}
            </p>
          </div>

          <button
            type="button"
            className={styles.historyButton}
            onClick={() => setMostrarHistorico((atual) => !atual)}
          >
            <History size={14} />
            {mostrarHistorico ? 'Ocultar Histórico' : 'Mostrar Histórico'}
          </button>
        </div>

        <div className={styles.tabelaWrap}>
          <table className={styles.tabelaReservas}>
            <thead>
              <tr>
                <th>Equipamento</th>
                <th>Utilizador</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {reservasLista.map((reserva) => {
                const terminou = new Date(reserva.data_fim).getTime() < Date.now()
                const emCurso = new Date(reserva.data_inicio).getTime() <= Date.now() && !terminou
                const estado = terminou ? 'Concluída' : emCurso ? 'Em curso' : 'Planeada'

                return (
                  <tr key={reserva.id} className={terminou ? styles.rowConcluida : emCurso ? styles.rowEmCurso : styles.rowPlaneada}>
                    <td>
                      <strong>{reserva.equipamento_nome || '—'}</strong>
                    </td>
                    <td>
                      <span className={styles.userCell}>
                        <span
                          className={styles.badgeIniciaisPequena}
                          style={{ backgroundColor: corDoUtilizador(reserva.utilizador_id) }}
                        >
                          {(reserva.utilizador_iniciais || reserva.utilizador_nome || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                        <span>{reserva.utilizador_nome || '—'}</span>
                      </span>
                    </td>
                    <td>{new Date(reserva.data_inicio).toLocaleString('pt-PT', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}</td>
                    <td>{new Date(reserva.data_fim).toLocaleString('pt-PT', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}</td>
                    <td>
                      <span className={styles.estadoBadge} data-state={estado.toLowerCase()}>
                        {estado}
                      </span>
                    </td>
                  </tr>
                )
              })}

              {reservasLista.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.tabelaVazia}>
                    Sem reservas para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dropdown — utilizadores reservados num dia */}
      {dropdown && (
        <div
          className={styles.dropdown}
          style={{ top: dropdown.y, left: Math.min(dropdown.x, window.innerWidth - 280) }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.dropdownHeader}>
            <span className="label">{new Date(dropdown.data + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
            <button className={styles.dropdownClose} onClick={() => setDropdown(null)}>✕</button>
          </div>

          {dropdown.reservas.length === 0 ? (
            <div className={styles.dropdownEmpty}>Nenhuma reserva neste dia</div>
          ) : (
            <ul className={styles.dropdownList}>
              {dropdown.reservas.map(r => (
                <li key={r.reserva_id} className={styles.dropdownItem}>
                  <div className={styles.dropdownEq}>{r.equipamento_nome}</div>
                  <div className={styles.dropdownUser}>
                    <span
                      className={styles.badgeIniciaisPequena}
                      style={{ backgroundColor: corDoUtilizador(r.utilizador_id) }}
                    >
                      {(r.utilizador_iniciais || r.utilizador_nome || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    {r.utilizador_nome}
                    {r.projeto && <span className={styles.dropdownProjeto}> — {r.projeto}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            className={styles.dropdownAdd}
            onClick={() => {
              abrirModalNovaReserva({
                data_inicio: `${dropdown.data}T08:00`,
                data_fim: `${dropdown.data}T09:00`,
              })
              setDropdown(null)
            }}
          >
            + Reservar neste dia
          </button>
        </div>
      )}

      {/* Modal Nova Reserva */}
      {modal && (
        <div className={styles.overlay} onClick={() => setModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Reservas</div>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Nova Reserva</h2>
              <div className={styles.infoWrap}>
                <span className={styles.infoIcon}>i</span>
                <div className={styles.infoTooltip}>Reservas em blocos de 1 hora. Usa os botões de duração rápida para preencher a hora de fim.</div>
              </div>
            </div>
            <div className={styles.hourRule}>Reservas em blocos de 1 hora (hora cheia).</div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className="label">Equipamento *</span>
                <select className={styles.input} value={form.equipamento_id} onChange={e => setForm(f => ({ ...f, equipamento_id: e.target.value }))}>
                  <option value="">Selecionar equipamento…</option>
                  {equipamentos.map(eq => (
                    <option key={eq.id} value={eq.id} disabled={eq.estado_atual === 'Avariado'}>
                      {eq.codigo} — {eq.nome}
                      {eq.estado_atual === 'Avariado' ? ' (Interdito)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className="label">Utilizador *</span>
                <select
                  className={styles.input}
                  value={form.utilizador_id}
                  onChange={e => setForm(f => ({ ...f, utilizador_id: e.target.value }))}
                  disabled={user && String(user.role).toLowerCase() !== 'admin'}
                  title={user && String(user.role).toLowerCase() !== 'admin' ? 'Operadores reservam apenas em seu próprio nome' : 'Seleciona um utilizador para a reserva'}
                >
                  <option value="">Selecionar utilizador…</option>
                  {utilizadores.map(ut => (
                    <option key={ut.id} value={ut.id}>{ut.nome} ({ut.departamento})</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className="label">Projeto (opcional)</span>
                <input className={styles.input} value={form.projeto} onChange={e => setForm(f => ({ ...f, projeto: e.target.value }))} placeholder="ex: Projeto X — Lote 42" />
              </label>

              <div className={styles.row}>
                <label className={styles.field}>
                  <span className="label">Data Início *</span>
                  <input
                    type="datetime-local"
                    step="3600"
                    className={styles.input}
                    value={form.data_inicio}
                    onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                  />
                </label>
                <label className={styles.field}>
                  <span className="label">Data Fim *</span>
                  <input
                    type="datetime-local"
                    step="3600"
                    className={styles.input}
                    value={form.data_fim}
                    onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                  />
                </label>
              </div>

              <div className={styles.quickHours}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="label">Duração rápida</span>
                  <div className={styles.infoWrapSmall}>
                    <span className={styles.infoIconSmall}>i</span>
                    <div className={styles.infoTooltip}>Adiciona horas à data de início (ex: 4h = +4 horas).</div>
                  </div>
                </div>
                <div className={styles.quickHoursButtons}>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(4)}>4h</button>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(8)}>8h</button>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(16)}>16h</button>
                </div>
              </div>

              <label className={styles.field}>
                <span className="label">Notas (opcional)</span>
                <textarea className={styles.textarea} rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </label>
            </div>

            {formErro && <div className={styles.formErro}>{formErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setModal(false); setFormErro('') }}>✕ Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
                {saving ? 'A guardar…' : '✓ Criar Reserva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}