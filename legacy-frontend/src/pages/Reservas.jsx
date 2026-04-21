import { useEffect, useState, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptLocale from '@fullcalendar/core/locales/pt'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import styles from './Reservas.module.css'

// Paleta de cores por equipamento (rotativa)
const CORES = [
  { bg: '#1e3a5f', border: '#378ADD' },
  { bg: '#1a3a2a', border: '#1D9E75' },
  { bg: '#3a1a1a', border: '#E24B4A' },
  { bg: '#3a2a0a', border: '#EF9F27' },
  { bg: '#2a1a3a', border: '#7F77DD' },
]

export default function Reservas() {
  const toast = useToast()
  const { user } = useAuth()
  const [eventos, setEventos] = useState([])
  const [equipamentos, setEquipamentos] = useState([])
  const [utilizadores, setUtilizadores] = useState([])
  const [loading, setLoading] = useState(true)

  // Dropdown ao clicar num dia
  const [dropdown, setDropdown] = useState(null) // { data, x, y, reservas[] }

  // Modal nova reserva
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ equipamento_id: '', utilizador_id: '', projeto: '', data_inicio: '', data_fim: '', notas: '' })
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [formErro, setFormErro] = useState('')

  const calendarRef = useRef(null)

  const formatLocalInput = (date) => {
    const d = new Date(date)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const setDuracaoHoras = (horas) => {
    if (!form.data_inicio) return
    const inicio = new Date(form.data_inicio)
    const fim = new Date(inicio.getTime() + horas * 60 * 60 * 1000)
    setForm((f) => ({ ...f, data_fim: formatLocalInput(fim) }))
  }

  const carregar = async () => {
    setLoading(true)
    try {
      const [reservas, eqs, uts] = await Promise.all([
        api.listarReservas(),
        api.listarEquipamentos(),
        user?.role === 'admin' ? api.listarUtilizadores() : Promise.resolve([]),
      ])
      setEquipamentos(eqs)
      setUtilizadores(uts)

      // Mapeia reservas para eventos do FullCalendar
      // Porquê: FullCalendar espera { title, start, end, color, extendedProps }
      const corMap = {}
      eqs.forEach((eq, i) => { corMap[eq.id] = CORES[i % CORES.length] })

      const evs = reservas.map(r => ({
        id: String(r.id),
        title: `${r.equipamento_codigo} — ${r.utilizador_nome}`,
        start: r.data_inicio,
        end: r.data_fim,
        backgroundColor: corMap[r.equipamento_id]?.bg ?? '#1e3a5f',
        borderColor: corMap[r.equipamento_id]?.border ?? '#378ADD',
        textColor: '#e8eaf0',
        extendedProps: { ...r },
      }))
      setEventos(evs)
    } catch (e) {
      toast.error(`Falha ao carregar reservas: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [user?.role])

  useEffect(() => {
    if (modal && utilizadores.length === 0 && user) {
      api.listarUtilizadores()
        .then(setUtilizadores)
        .catch((e) => toast.error(`Falha ao carregar utilizadores: ${e.message}`))
    }
  }, [modal, utilizadores.length, user])

  // Clique num dia — abre dropdown com utilizadores reservados nesse dia
  const handleDateClick = async (info) => {
    const rect = info.jsEvent.target.getBoundingClientRect()
    const data = info.dateStr // YYYY-MM-DD
    try {
      const reservasDia = await api.reservasPorDia(data)
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
  }

  // Seleção direta no calendário (vista semanal/diária) para reservas por hora
  const handleTimeSelect = (info) => {
    setForm((f) => ({
      ...f,
      data_inicio: formatLocalInput(info.start),
      data_fim: formatLocalInput(info.end),
    }))
    setFormErro('')
    setModal(true)
  }

  const handleSubmit = async () => {
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
      await api.criarReserva({
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
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar a reserva.')
    } finally {
      setSaving(false)
    }
  }

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const blob = await api.exportarReservasPdf()
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
  }

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
          <button className={styles.btnPrimary} onClick={e => { e.stopPropagation(); setModal(true) }}>
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
        />
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
                    <span className={styles.userDot} />
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
              setForm(f => ({ ...f, data_inicio: dropdown.data + 'T08:00', data_fim: dropdown.data + 'T09:00' }))
              setDropdown(null)
              setModal(true)
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
            <h2 className={styles.modalTitle}>Nova Reserva</h2>
            <div className={styles.hourRule}>Reservas em blocos de 1 hora (hora cheia).</div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className="label">Equipamento *</span>
                <select className={styles.input} value={form.equipamento_id} onChange={e => setForm(f => ({ ...f, equipamento_id: e.target.value }))}>
                  <option value="">Selecionar equipamento…</option>
                  {equipamentos.map(eq => (
                    <option key={eq.id} value={eq.id}>{eq.codigo} — {eq.nome}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className="label">Utilizador *</span>
                <select className={styles.input} value={form.utilizador_id} onChange={e => setForm(f => ({ ...f, utilizador_id: e.target.value }))}>
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
                <span className="label">Duração rápida</span>
                <div className={styles.quickHoursButtons}>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(1)}>+1h</button>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(2)}>+2h</button>
                  <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(4)}>+4h</button>
                </div>
              </div>

              <label className={styles.field}>
                <span className="label">Notas (opcional)</span>
                <textarea className={styles.textarea} rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </label>
            </div>

            {formErro && <div className={styles.formErro}>{formErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setModal(false); setFormErro('') }}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
                {saving ? 'A guardar…' : 'Criar Reserva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}