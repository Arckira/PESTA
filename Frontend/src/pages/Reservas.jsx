import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import ModalWrapper from '../components/ModalWrapper.jsx'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid'
import ptLocale from '@fullcalendar/core/locales/pt'
import enLocale from '@fullcalendar/core/locales/en-gb'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCalendarDays as faCalendar,
  faClock,
  faFolderOpen,
  faNoteSticky,
  faScrewdriverWrench as faTools,
  faUser,
} from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Reservas.module.css'
import { useReservas } from '../hooks/useReservas.js'
import { corDoUtilizador } from '../utils/coresUtilizadores.js'

const ESTADOS_BLOQUEADOS_RESERVA = ['Avariado', 'Em manutenção', 'Em calibração']

const holidayKeyCache = new Map()

const pad = (value) => String(value).padStart(2, '0')

const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const shiftDays = (date, days) => {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() + days)
  return shifted
}

const getEasterSunday = (year) => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month, day)
}

const getHolidayKeys = (year) => {
  if (holidayKeyCache.has(year)) return holidayKeyCache.get(year)

  const easterSunday = getEasterSunday(year)
  const holidayKeys = new Set([
    dateKey(new Date(year, 0, 1)),
    dateKey(new Date(year, 3, 25)),
    dateKey(new Date(year, 4, 1)),
    dateKey(new Date(year, 5, 10)),
    dateKey(new Date(year, 7, 15)),
    dateKey(new Date(year, 9, 5)),
    dateKey(new Date(year, 10, 1)),
    dateKey(new Date(year, 11, 1)),
    dateKey(new Date(year, 11, 8)),
    dateKey(new Date(year, 11, 25)),
    dateKey(shiftDays(easterSunday, -2)),
    dateKey(shiftDays(easterSunday, 60)),
  ])

  holidayKeyCache.set(year, holidayKeys)
  return holidayKeys
}

const isHolidayDate = (date) => getHolidayKeys(date.getFullYear()).has(dateKey(date))



export default function Reservas({startOpenModal = false}) {
  const toast = useToast()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const {
    eventos,
    reservas,
    equipamentos,
    loading,
    reload,
    createReserva,
    updateReserva,
    cancelReserva,
    reservasPorDia,
    exportPdf,
  } = useReservas(user?.role)

  // Dropdown ao clicar num dia
  const [dropdown, setDropdown] = useState(null) // { data, x, y, reservas[] }

  // Modal nova reserva
  const [modal, setModal] = useState(startOpenModal)
  const [modalModo, setModalModo] = useState('create')
  const [reservaEmEdicao, setReservaEmEdicao] = useState(null)
  const [form, setForm] = useState({ equipamento_id: '', utilizador_id: '', projeto: '', metodo: '', data_inicio: '', data_fim: '', notas: '' })
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const calendarRef = useRef(null)

  // Pré-preencher form quando startOpenModal é true (vindo de /equipamentos/:id/reserva)
  useEffect(() => {
    if (startOpenModal && user?.id) {
      setForm(f => ({ ...f, utilizador_id: String(user.id) }))
    }
  }, [startOpenModal, user])

  const formatLocalInput = useCallback((date) => {
    const d = new Date(date)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }, [])

  const fecharModalReserva = useCallback(() => {
    setModal(false)
    setModalModo('create')
    setReservaEmEdicao(null)
    setFormErro('')
    setForm({ equipamento_id: '', utilizador_id: '', projeto: '', metodo: '', data_inicio: '', data_fim: '', notas: '' })
  }, [])

  const setDuracaoHoras = useCallback((horas) => {
    if (!form.data_inicio) return
    const inicio = new Date(form.data_inicio)
    const fim = new Date(inicio.getTime() + horas * 60 * 60 * 1000)
    setForm((f) => ({ ...f, data_fim: formatLocalInput(fim) }))
  }, [form.data_inicio, formatLocalInput])

  const reservasAtivas = useMemo(() => {
    return reservas
      .filter(r => r.esta_ativa === true)
      .sort((a, b) => new Date(a.sessao_inicio || a.data_inicio) - new Date(b.sessao_inicio || b.data_inicio))
  }, [reservas])

  const reservasPlaneadas = useMemo(() => {
    const agora = Date.now()
    return reservas
      .filter(r => !r.esta_ativa && new Date(r.data_fim).getTime() >= agora)
      .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
  }, [reservas])

  const reservasHistorico = useMemo(() => {
    const agora = Date.now()
    return reservas
      .filter(r => new Date(r.data_fim).getTime() < agora)
      .sort((a, b) => new Date(b.data_fim) - new Date(a.data_fim))
  }, [reservas])

  const tipoLabel = useCallback((tipo) => {
    const mapa = {
      'Câmara Climática':      lang === 'en' ? 'Climatic Chamber'      : 'Câmara Climática',
      'Câmara Choque Térmico': lang === 'en' ? 'Thermal Shock Chamber' : 'Câmara Choque Térmico',
      'Forno':                 lang === 'en' ? 'Oven'                  : 'Forno',
      'Salina':                lang === 'en' ? 'Salt Spray'            : 'Salina',
      'Shaker':                lang === 'en' ? 'Vibration Table'       : 'Shaker',
    }
    return mapa[tipo] || tipo
  }, [lang])

  const resources = useMemo(() => {
    return [...equipamentos]
      .sort((a, b) => {
        const ta = a.tipo || 'Outros', tb = b.tipo || 'Outros'
        if (ta < tb) return -1
        if (ta > tb) return 1
        const ca = a.codigo || '', cb = b.codigo || ''
        if (ca < cb) return -1
        if (ca > cb) return 1
        return 0
      })
      .map(eq => ({
        id: String(eq.id),
        title: eq.codigo ? `${eq.codigo} — ${eq.nome}` : eq.nome,
        tipo: tipoLabel(eq.tipo || 'Outros'),
        estadoBloqueado: ESTADOS_BLOQUEADOS_RESERVA.includes(eq.estado_atual),
      }))
  }, [equipamentos, lang, tipoLabel])

  const abrirModalNovaReserva = useCallback((preenchimento = {}) => {
    setModalModo('create')
    setReservaEmEdicao(null)
    setForm({
      equipamento_id: preenchimento.equipamento_id || '',
      utilizador_id: user?.id ? String(user.id) : (preenchimento.utilizador_id ? String(preenchimento.utilizador_id) : ''),
      projeto: '',
      metodo: '',
      data_inicio: preenchimento.data_inicio || '',
      data_fim: preenchimento.data_fim || '',
      notas: '',
    })
    setFormErro('')
    setModal(true)
  }, [user])

  const abrirModalEdicaoReserva = useCallback((reserva) => {
    setModalModo('edit')
    setReservaEmEdicao(reserva)
    setForm({
      equipamento_id: String(reserva.equipamento_id || ''),
      utilizador_id: user?.id ? String(user.id) : String(reserva.utilizador_id || ''),
      projeto: reserva.projeto || '',
      metodo: reserva.metodo || '',
      data_inicio: formatLocalInput(reserva.data_inicio),
      data_fim: formatLocalInput(reserva.data_fim),
      notas: reserva.notas || '',
    })
    setFormErro('')
    setModal(true)
  }, [formatLocalInput, user])

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
      toast.error(t('reservas_page.erroCarregarDia'))
      setDropdown({ data, x: rect.left, y: rect.bottom + window.scrollY + 4, reservas: [] })
    }
  }, [reservasPorDia, toast])

  // Seleção direta no calendário (vista semanal/diária) para reservas por hora
  const handleTimeSelect = (info) => {
    const resourceId = info.resource ? info.resource.id : (info.resources ? Object.keys(info.resources)[0] : null)
    abrirModalNovaReserva({
      equipamento_id: resourceId ? String(resourceId) : undefined,
      data_inicio: formatLocalInput(info.start),
      data_fim: formatLocalInput(info.end),
    })
  }

  const handleSubmit = useCallback(async () => {
    if (!form.equipamento_id || !form.utilizador_id || !form.data_inicio || !form.data_fim) {
      setFormErro(t('reservas_page.erroCamposObrigatorios'))
      toast.error(t('reservas_page.erroCamposObrigatoriosToast'))
      return
    }

    const inicio = new Date(form.data_inicio)
    const fim = new Date(form.data_fim)
    const duracaoMs = fim.getTime() - inicio.getTime()

    const horaCheia = (d) => d.getMinutes() === 0 && d.getSeconds() === 0
    if (!horaCheia(inicio) || !horaCheia(fim)) {
      setFormErro(t('reservas_page.erroHoraCheia'))
      toast.error(t('reservas_page.erroHoraCheiaToast'))
      return
    }

    if (duracaoMs < 60 * 60 * 1000 || duracaoMs % (60 * 60 * 1000) !== 0) {
      setFormErro(t('reservas_page.erroDuracao'))
      toast.error(t('reservas_page.erroDuracaoToast'))
      return
    }

    setSaving(true)
    setFormErro('')
    try {
      const payload = {
        equipamento_id: parseInt(form.equipamento_id),
        utilizador_id: parseInt(form.utilizador_id),
        projeto: form.projeto || null,
        metodo: form.metodo || null,
        data_inicio: new Date(form.data_inicio).toISOString(),
        data_fim: new Date(form.data_fim).toISOString(),
        notas: form.notas || null,
      }

      if (modalModo === 'edit' && reservaEmEdicao) {
        await updateReserva(reservaEmEdicao.id, payload)
        toast.success(t('reservas.successCreate'))
      } else {
        await createReserva(payload)
        toast.success(t('reservas_page.reservaCriada'))
      }

      fecharModalReserva()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || t('reservas_page.erroReserva'))
    } finally {
      setSaving(false)
    }
  }, [createReserva, fecharModalReserva, form, modalModo, reservaEmEdicao, toast, updateReserva, t])

  const handleTerminarReserva = useCallback(async (reserva) => {
    if (!window.confirm('Terminar esta sessão em curso?')) return
    try {
      await cancelReserva(reserva.id)
      toast.success('Reserva terminada com sucesso')
    } catch (e) {
      toast.error(e.message || 'Não foi possível terminar a reserva')
    }
  }, [cancelReserva, toast])

  const handleEliminarReserva = useCallback(async (reserva) => {
    if (!window.confirm('Eliminar esta reserva planeada?')) return
    try {
      await cancelReserva(reserva.id)
      toast.success('Reserva eliminada com sucesso')
    } catch (e) {
      toast.error(e.message || 'Não foi possível eliminar a reserva')
    }
  }, [cancelReserva, toast])

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
      toast.success(t('reservas_page.pdfExportado'))
    } catch (e) {
      toast.error(e.message || t('reservas_page.erroPdf'))
    } finally {
      setExporting(false)
    }
  }, [exportPdf, toast])

  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const fcLocale = lang === 'en' ? enLocale : ptLocale
  const fcButtonText = {
    month: lang === 'en' ? 'Month' : 'Mês',
    week:  lang === 'en' ? 'Week'  : 'Semana',
  }
  const getCalendarDayTone = useCallback((date) => {
    const dayOfWeek = date.getDay()
    if (isHolidayDate(date)) {
      return {
        className: styles.calendarHoliday,
        background: 'rgba(120, 120, 128, 0.26)',
        borderColor: 'rgba(90, 90, 96, 0.32)',
      }
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        className: styles.calendarWeekend,
        background: 'rgba(120, 120, 128, 0.14)',
        borderColor: 'rgba(90, 90, 96, 0.18)',
      }
    }
    return null
  }, [])
  const calendarDayClasses = useCallback(({ date }) => {
    const classes = []
    const tone = getCalendarDayTone(date)

    if (tone) classes.push(tone.className)

    return classes
  }, [getCalendarDayTone])
  const fmtDt = (iso) => new Date(iso).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  const iniciais = (r) =>
    (r.utilizador_iniciais || r.utilizador_nome || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <>
    <div className="fade-up" onClick={() => setDropdown(null)}>
      <PageHeader
        categoria={t('reservas_page.calendario')}
        titulo={t('reservas.title')}
        secondaryActionText={exporting ? t('reservas_page.aExportar') : t('reservas_page.exportarPdf')}
        onSecondaryActionClick={e => { e.stopPropagation(); handleExportPdf() }}
        actionText={t('reservas.new')}
        onActionClick={e => { e.stopPropagation(); abrirModalNovaReserva() }}
      />

      {loading && <div className={styles.loading}>{t('common.loading')}</div>}

      <div className={styles.calendarWrap} onClick={e => e.stopPropagation()}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimelinePlugin, resourceTimeGridPlugin]}
          initialView="resourceTimelineMonth"
          schedulerLicenseKey="GPL-My-Project-Is-Open-Source"
          locale={fcLocale}
          resources={resources}
          resourceGroupField="tipo"
          resourceAreaWidth="200px"
          resourceAreaHeaderContent={t('reservas_page.cabecalhos.equipamento')}
          events={eventos}
          dateClick={handleDateClick}
          selectable
          selectAllow={(selectInfo) => !selectInfo.resource?.extendedProps?.estadoBloqueado}
          select={handleTimeSelect}
          selectMirror
          resourceLaneClassNames={(arg) => arg.resource.extendedProps.estadoBloqueado ? [styles.resourceBloqueado] : []}
          resourceLabelClassNames={(arg) => arg.resource.extendedProps.estadoBloqueado ? [styles.resourceBloqueado] : []}
          resourceLabelDidMount={(arg) => {
            if (arg.resource.extendedProps.estadoBloqueado) arg.el.title = 'Equipamento indisponível para reserva'
          }}
          slotDuration="01:00:00"
          snapDuration="01:00:00"
          slotMinWidth={28}
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
          views={{
            resourceTimelineMonth: {
              slotDuration: { days: 1 },
              slotMinWidth: 28,
              slotLabelFormat: [
                { week: 'short' },
                { weekday: 'short' },
                { day: 'numeric' },
              ],
              buttonText: fcButtonText.month,
            },
            resourceTimelineWeek: {
              slotDuration: '08:00:00',
              slotMinWidth: 80,
              slotLabelFormat: [
                { weekday: 'short', day: 'numeric', month: 'short' },
                { hour: '2-digit', minute: '2-digit', hour12: false },
              ],
              buttonText: fcButtonText.week,
            },
          }}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'resourceTimelineMonth,resourceTimelineWeek',
          }}
          slotLabelContent={(arg) => {
            if (arg.level === 1) {
              const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
              const letra = dias[arg.date.getDay()]
              return letra + '​'.repeat(arg.date.getDate())
            }
            return arg.text
          }}
          slotLaneClassNames={calendarDayClasses}
          slotLabelClassNames={calendarDayClasses}
          slotLaneDidMount={(arg) => {
            const tone = getCalendarDayTone(arg.date)
            if (!tone) return
            arg.el.style.backgroundColor = tone.background
            arg.el.style.borderColor = tone.borderColor
            arg.el.style.backgroundClip = 'padding-box'
            arg.el.style.boxShadow = tone.className === styles.calendarHoliday
              ? 'inset 0 0 0 1px rgba(239, 159, 39, 0.24)'
              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.04)'
          }}
          slotLabelDidMount={(arg) => {
            const tone = getCalendarDayTone(arg.date)
            if (!tone) return
            arg.el.style.backgroundColor = tone.background
            arg.el.style.borderColor = tone.borderColor
            arg.el.style.backgroundClip = 'padding-box'
            arg.el.style.boxShadow = tone.className === styles.calendarHoliday
              ? 'inset 0 0 0 1px rgba(239, 159, 39, 0.24)'
              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.04)'
          }}
          height="auto"
          eventDisplay="block"
          eventOrder="-esta_ativa,start"
          eventContent={(arg) => {
            const ev = arg.event.extendedProps
            const ini = ev.utilizador_iniciais || (ev.utilizador_nome
              ? ev.utilizador_nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
              : '??')

            if (arg.view.type === 'resourceTimelineMonth') {
              return (
                <div
                  className={`${styles.reservaBadge}${ev.esta_ativa ? ` ${styles.reservaBadgeAtiva}` : ''}`}
                  style={{ background: 'none', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 4px', overflow: 'hidden' }}
                >
                  {ev.esta_ativa && <span className={styles.pulseDot} style={{ width: '5px', height: '5px', flexShrink: 0 }} />}
                  <span style={{ fontSize: '11px', fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {ev.utilizador_nome || ini}
                  </span>
                </div>
              )
            }

            // resourceTimeGridWeek
            return (
              <div
                className={`${styles.reservaBadge}${ev.esta_ativa ? ` ${styles.reservaBadgeAtiva}` : ''}`}
                style={{ background: 'none', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', gap: '1px', padding: '2px 4px', lineHeight: 1.3 }}
              >
                <span style={{ fontSize: '10px', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {ev.esta_ativa && <span className={styles.pulseDot} style={{ width: '5px', height: '5px', marginRight: '3px' }} />}
                  {ev.utilizador_nome || ini}
                </span>
                {ev.projeto && (
                  <span style={{ fontSize: '9px', opacity: 0.8, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {ev.projeto}
                  </span>
                )}
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
          <span className={styles.legendaDotFaded} />
          {t('reservas_page.legendaPlaneada')}
        </span>
        <span className={styles.legendaItem}>
          <span className={styles.legendaDotSolid} />
          {t('reservas_page.legendaAtivo')}
        </span>
      </div>

      <div className={styles.listaContainer} onClick={e => e.stopPropagation()}>
        <div className={styles.listaHeader}>
          <div>
            <div className="label">{t('reservas_page.subtituloGestao')}</div>
            <h2 className={styles.listaTitle}>{t('reservas_page.titulo')}</h2>
            <p className={styles.listaSubtitle}>{t('reservas_page.subtitulo')}</p>
          </div>
        </div>

        {/* Grupo A — Em curso */}
        <div className={`${styles.grupoHeader} ${styles.grupoHeaderAtivo}`}>
          <span className={styles.pulseDot} />
          {t('reservas_page.emCursoSeccao')}
        </div>
        <div className={styles.tabelaWrap}>
          <table className={styles.tabelaReservas}>
            <thead>
              <tr>
                <th>{t('reservas_page.cabecalhos.equipamento')}</th>
                <th>{t('reservas_page.cabecalhos.utilizador')}</th>
                <th>{t('reservas_page.cabecalhos.inicioSessao')}</th>
                <th>{t('reservas_page.cabecalhos.fimPrevisto')}</th>
                <th>{t('reservas_page.cabecalhos.estado')}</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {reservasAtivas.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.tabelaVazia}>{t('reservas_page.semSessoesAtivas')}</td>
                </tr>
              ) : reservasAtivas.map((reserva) => (
                <tr key={reserva.id} className={styles.rowEmCurso}>
                  <td><strong>{reserva.equipamento_nome || '—'}</strong></td>
                  <td>
                    <span className={styles.userCell}>
                      <span className={styles.badgeIniciaisPequena} style={{ backgroundColor: corDoUtilizador(reserva.utilizador_id) }}>
                        {iniciais(reserva)}
                      </span>
                      <span>{reserva.utilizador_nome || '—'}</span>
                    </span>
                  </td>
                  <td>{reserva.sessao_inicio ? fmtDt(reserva.sessao_inicio) : '—'}</td>
                  <td>{fmtDt(reserva.data_fim)}</td>
                  <td>
                    <span className={styles.badgeAtivo}>
                      <span className={styles.pulseDot} />
                      {t('reservas_page.estados.emCurso')}
                    </span>
                  </td>
                  <td>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={styles.tableBtnEnd}
                        onClick={() => handleTerminarReserva(reserva)}
                      >
                        Terminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grupo B — Planeadas */}
        <div className={styles.grupoHeader}>
          {t('reservas_page.planeadasSeccao')}
        </div>
        <div className={styles.tabelaWrap}>
          <table className={styles.tabelaReservas}>
            <thead>
              <tr>
                <th>{t('reservas_page.cabecalhos.equipamento')}</th>
                <th>{t('reservas_page.cabecalhos.utilizador')}</th>
                <th>{t('reservas_page.cabecalhos.inicio')}</th>
                <th>{t('reservas_page.cabecalhos.fim')}</th>
                <th>{t('reservas_page.cabecalhos.estado')}</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {reservasPlaneadas.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.tabelaVazia}>{t('reservas_page.semReservasPlaneadas')}</td>
                </tr>
              ) : reservasPlaneadas.map((reserva) => (
                <tr key={reserva.id} className={styles.rowPlaneada}>
                  <td><strong>{reserva.equipamento_nome || '—'}</strong></td>
                  <td>
                    <span className={styles.userCell}>
                      <span className={styles.badgeIniciaisPequena} style={{ backgroundColor: corDoUtilizador(reserva.utilizador_id) }}>
                        {iniciais(reserva)}
                      </span>
                      <span>{reserva.utilizador_nome || '—'}</span>
                    </span>
                  </td>
                  <td>{fmtDt(reserva.data_inicio)}</td>
                  <td>{fmtDt(reserva.data_fim)}</td>
                  <td><span className={styles.badgePlaneada}>{t('reservas_page.estados.agendada')}</span></td>
                  <td>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={styles.tableBtnEdit}
                        onClick={() => abrirModalEdicaoReserva(reserva)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className={styles.tableBtnDelete}
                        onClick={() => handleEliminarReserva(reserva)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grupo C — Histórico (condicional) */}
        {mostrarHistorico && (
          <>
            <div className={styles.grupoHeader}>
              {t('reservas_page.historicoSeccao')}
            </div>
            <div className={styles.tabelaWrap}>
              <table className={styles.tabelaReservas}>
                <thead>
                  <tr>
                    <th>{t('reservas_page.cabecalhos.equipamento')}</th>
                    <th>{t('reservas_page.cabecalhos.utilizador')}</th>
                    <th>{t('reservas_page.cabecalhos.inicio')}</th>
                    <th>{t('reservas_page.cabecalhos.fim')}</th>
                    <th>{t('reservas_page.cabecalhos.estado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reservasHistorico.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.tabelaVazia}>{t('reservas_page.semHistorico')}</td>
                    </tr>
                  ) : reservasHistorico.map((reserva) => (
                    <tr key={reserva.id} className={styles.rowConcluida}>
                      <td><strong>{reserva.equipamento_nome || '—'}</strong></td>
                      <td>
                        <span className={styles.userCell}>
                          <span className={styles.badgeIniciaisPequena} style={{ backgroundColor: corDoUtilizador(reserva.utilizador_id) }}>
                            {iniciais(reserva)}
                          </span>
                          <span>{reserva.utilizador_nome || '—'}</span>
                        </span>
                      </td>
                      <td>{fmtDt(reserva.data_inicio)}</td>
                      <td>{fmtDt(reserva.data_fim)}</td>
                      <td><span className={styles.estadoBadge} data-state="concluída">{t('reservas_page.estados.concluida')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <button
          type="button"
          className={styles.btnHistorico}
          onClick={() => setMostrarHistorico(v => !v)}
        >
          {mostrarHistorico ? t('reservas_page.ocultarHistorico') : t('reservas_page.verHistorico')}
        </button>
      </div>

      {/* Dropdown — utilizadores reservados num dia */}
      {dropdown && (
        <div
          className={styles.dropdown}
          style={{ top: dropdown.y, left: Math.min(dropdown.x, window.innerWidth - 280) }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.dropdownHeader}>
            <span className="label">{new Date(dropdown.data + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' })}</span>
            <button className={styles.dropdownClose} onClick={() => setDropdown(null)}>✕</button>
          </div>

          {dropdown.reservas.length === 0 ? (
            <div className={styles.dropdownEmpty}>{t('reservas_page.nenhumaReservaDia')}</div>
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
            {t('reservas_page.reservarNesteDia')}
          </button>
        </div>
      )}

    </div>

      {/* Modal Nova Reserva — fora do fade-up para evitar corrupção do position:fixed por transforms */}
      <ModalWrapper
        isOpen={modal}
        onClose={fecharModalReserva}
        categoria={t('reservas_page.modalLabel')}
        titulo={modalModo === 'edit' ? 'Editar Reserva' : t('reservas.new')}
        tamanho="max-w-2xl"
      >
        <div className="flex flex-col">
          <div style={{ padding: '10px 12px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '4px', fontSize: '13px', color: '#92400e', marginBottom: '12px' }}>
            ℹ️ {t('reservas_page.equipAvariado')}
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <FontAwesomeIcon icon={faUser} className={styles.fieldIcon} aria-hidden="true" />
                {t('reservas_page.utilizador')}
              </span>
              <div className={styles.lockedField}>{user?.nome || '—'}</div>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <FontAwesomeIcon icon={faFolderOpen} className={styles.fieldIcon} aria-hidden="true" />
                {t('reservas_page.projeto')}
              </span>
              <input className={styles.input} value={form.projeto} onChange={e => setForm(f => ({ ...f, projeto: e.target.value }))} placeholder={t('reservas_page.projetoPlaceholder')} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <FontAwesomeIcon icon={faTools} className={styles.fieldIcon} aria-hidden="true" />
                {t('reservas_page.metodo')}
              </span>
              <input className={styles.input} value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))} placeholder={t('reservas_page.metodPlaceholder')} />
            </label>

            <div className={styles.formGrid}>
              <div className={styles.formColumn}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <FontAwesomeIcon icon={faTools} className={styles.fieldIcon} aria-hidden="true" />
                    {t('reservas_page.equipamento')}
                  </span>
                  <div className={styles.lockedField}>
                    {(() => {
                      const eq = equipamentos.find(e => String(e.id) === String(form.equipamento_id))
                      return eq ? (eq.codigo ? `${eq.codigo} — ${eq.nome}` : eq.nome) : '—'
                    })()}
                  </div>
                </label>

                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      <FontAwesomeIcon icon={faCalendar} className={styles.fieldIcon} aria-hidden="true" />
                      {t('reservas_page.dataInicio')}
                    </span>
                    <input
                      type="datetime-local"
                      step="3600"
                      className={styles.input}
                      value={form.data_inicio}
                      onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      <FontAwesomeIcon icon={faCalendar} className={styles.fieldIcon} aria-hidden="true" />
                      {t('reservas_page.dataFim')}
                    </span>
                    <input
                      type="datetime-local"
                      step="3600"
                      className={styles.input}
                      value={form.data_fim}
                      onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div className={styles.formColumn}>
                <div className={styles.quickHours}>
                  <div className={styles.quickHoursHeader}>
                    <span className={styles.fieldLabel}>
                      <FontAwesomeIcon icon={faClock} className={styles.fieldIcon} aria-hidden="true" />
                      {t('reservas_page.duracaoEstimada')}
                    </span>
                  </div>
                  <div className={styles.quickHoursButtons}>
                    <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(4)}>4h</button>
                    <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(8)}>8h</button>
                    <button type="button" className={styles.quickBtn} onClick={() => setDuracaoHoras(16)}>16h</button>
                  </div>
                </div>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <FontAwesomeIcon icon={faNoteSticky} className={styles.fieldIcon} aria-hidden="true" />
                    {t('reservas_page.notas')}
                  </span>
                  <textarea className={styles.textarea} rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
                </label>
              </div>
            </div>
          </div>

          {formErro && <div className={styles.formErro}>{formErro}</div>}

          {/* Rodapé fixo — sempre visível */}
          <div className="flex items-center justify-end gap-3 pt-3 mt-3 border-t border-gray-100 flex-shrink-0">
            <button className={styles.btnSecondary} onClick={fecharModalReserva}>{t('reservas_page.cancelar')}</button>
            <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
              {saving ? t('reservas_page.aGuardar') : modalModo === 'edit' ? 'Guardar alterações' : t('reservas_page.criarReserva')}
            </button>
          </div>
        </div>
      </ModalWrapper>
    </>
  )
}