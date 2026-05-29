import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
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



export default function Reservas({startOpenModal = false}) {
  const toast = useToast()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const {
    eventos,
    reservas,
    equipamentos,
    utilizadores,
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
    if (startOpenModal && user && String(user.role).toLowerCase() !== 'admin' && user.id) {
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

  // Função auxiliar para traduzir o valor interno do campo 'tipo' para a label visível.
  // Reutiliza o mesmo padrão de DetalheEquipamento para consistência visual.
  const tCategoria = useCallback((tipo) => {
    const k = `categorias.${tipo}`
    const v = t(k)
    return v === k ? tipo : v
  }, [t])

  // Calcula os equipamentos elegíveis para seleção no dropdown do formulário de reserva.
  // A filtragem é feita em dois passos encadeados: estado operacional e depois sobreposição temporal.
  const equipamentosElegiveis = useMemo(() => {
    // Passo 1 — Filtragem por estado operacional.
    // Apenas 'Disponível' e 'Limitado' permitem nova reserva.
    // Todos os outros estados ('Avariado', 'Ocupado', 'Em manutenção', 'Em calibração')
    // são excluídos para impedir agendamentos em ativos inoperacionais ou já comprometidos.
    const operacionais = equipamentos.filter(
      eq => eq.estado_atual === 'Disponível' || eq.estado_atual === 'Degradado'
    )

    // Passo 2 — Tentativa de conversão das datas do formulário.
    // Tratamento defensivo: se qualquer campo estiver vazio ou contiver uma data
    // parcial/inválida (NaN), saltamos a verificação de sobreposição e devolvemos
    // apenas o resultado do Passo 1, evitando que o dropdown bloqueie durante a digitação.
    const inicio = new Date(form.data_inicio)
    const fim = new Date(form.data_fim)
    if (!form.data_inicio || !form.data_fim || isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return operacionais
    }

    // Passo 3 — Filtragem por sobreposição temporal (overlap).
    //
    // Regra matemática de interseção de intervalos semi-abertos:
    //   A sobrepõe B  ⟺  A.início < B.fim  ∧  A.fim > B.início
    //
    // Esta condição é deliberadamente estrita: adjacências (fim_A == início_B)
    // NÃO constituem sobreposição, permitindo reservas consecutivas sem lacunas artificiais.
    //
    // São consideradas apenas reservas "em curso" (esta_ativa === true) ou
    // "planeadas" (data_fim no futuro sem check-in concluído) — reservas históricas
    // não representam conflito real e são ignoradas para evitar falsos positivos.
    //
    // Em modo de edição, a própria reserva em edição é excluída do varrimento
    // para não auto-excluir o equipamento que já lhe estava atribuído.
    const agora = Date.now()

    return operacionais.filter(eq => {
      const temConflito = reservas.some(r => {
        // Ignorar reservas associadas a outros equipamentos
        if (Number(r.equipamento_id) !== Number(eq.id)) return false
        // Em modo edição, excluir a reserva corrente para evitar auto-exclusão
        if (reservaEmEdicao && r.id === reservaEmEdicao.id) return false
        // Ignorar reservas históricas (concluídas e sem sessão ativa)
        const ePlaneada = !r.esta_ativa && new Date(r.data_fim).getTime() >= agora
        if (!r.esta_ativa && !ePlaneada) return false
        // Tratamento defensivo: ignorar reservas com datas malformadas na base de dados
        const rInicio = new Date(r.data_inicio)
        const rFim = new Date(r.data_fim)
        if (isNaN(rInicio.getTime()) || isNaN(rFim.getTime())) return false
        // Aplicar a regra de interseção: início_form < fim_reserva ∧ fim_form > início_reserva
        return inicio < rFim && fim > rInicio
      })
      // O equipamento é elegível se nenhum conflito temporal foi detetado
      return !temConflito
    })
  }, [equipamentos, reservas, form.data_inicio, form.data_fim, reservaEmEdicao])

  // Agrupa os equipamentos elegíveis por categoria (campo 'tipo') para alimentar
  // os <optgroup> do dropdown. Usa um Map para preservar a ordem de inserção —
  // a primeira aparição de cada tipo define a posição do grupo na lista.
  const equipamentosPorCategoria = useMemo(() => {
    const mapa = new Map()
    for (const eq of equipamentosElegiveis) {
      const tipo = eq.tipo || 'Outros'
      if (!mapa.has(tipo)) mapa.set(tipo, [])
      mapa.get(tipo).push(eq)
    }
    return mapa
  }, [equipamentosElegiveis])

  const tipoLabel = useCallback((tipo) => {
    const mapa = {
      'Câmara Climática':      lang === 'en' ? 'Climate Chamber'       : 'Câmara Climática',
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
      }))
  }, [equipamentos, lang, tipoLabel])

  // Pré-preencher o formulário com o utilizador logado se for um user
  const abrirModalNovaReserva = useCallback((preenchimento = {}) => {
    const novoForm = {
      equipamento_id: preenchimento.equipamento_id || '',
      utilizador_id: '',
      projeto: '',
      metodo: '',
      data_inicio: preenchimento.data_inicio || '',
      data_fim: preenchimento.data_fim || '',
      notas: ''
    }

    if (user && String(user.role).toLowerCase() !== 'admin' && user.id) {
      novoForm.utilizador_id = String(user.id)
    } else if (preenchimento.utilizador_id) {
      novoForm.utilizador_id = String(preenchimento.utilizador_id)
    }

    setModalModo('create')
    setReservaEmEdicao(null)
    setForm(novoForm)
    setFormErro('')
    setModal(true)
  }, [user])

  const abrirModalEdicaoReserva = useCallback((reserva) => {
    setModalModo('edit')
    setReservaEmEdicao(reserva)
    setForm({
      equipamento_id: String(reserva.equipamento_id || ''),
      utilizador_id: String(reserva.utilizador_id || ''),
      projeto: reserva.projeto || '',
      metodo: reserva.metodo || '',
      data_inicio: formatLocalInput(reserva.data_inicio),
      data_fim: formatLocalInput(reserva.data_fim),
      notas: reserva.notas || '',
    })
    setFormErro('')
    setModal(true)
  }, [formatLocalInput])

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
    abrirModalNovaReserva({
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
  const fmtDt = (iso) => new Date(iso).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  const iniciais = (r) =>
    (r.utilizador_iniciais || r.utilizador_nome || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="fade-up" onClick={() => setDropdown(null)}>
      <div className={styles.header}>
        <div>
          <div className="label">{t('reservas_page.calendario')}</div>
          <h1 className={styles.title}>{t('reservas.title')}</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.btnSecondary}
            onClick={e => { e.stopPropagation(); handleExportPdf() }}
            disabled={exporting}
          >
            {exporting ? t('reservas_page.aExportar') : t('reservas_page.exportarPdf')}
          </button>
          <button type="button" className={styles.addEquipmentBtn} onClick={e => { e.stopPropagation(); abrirModalNovaReserva() }}>
            <Plus strokeWidth={2.5} />
            {t('reservas.new')}
          </button>
        </div>
      </div>

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
          select={handleTimeSelect}
          selectMirror
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
                { month: 'short', omitCommas: true },
                { weekday: 'narrow', day: 'numeric' },
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

      {/* Modal Nova Reserva */}
      {modal && (
        <div className={styles.overlay} onClick={fecharModalReserva}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>{t('reservas_page.modalLabel')}</div>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{modalModo === 'edit' ? 'Editar Reserva' : t('reservas.new')}</h2>
              <div className={styles.infoWrap}>
                <span className={styles.infoIcon}>i</span>
                <div className={styles.infoTooltip}>{t('reservas_page.tooltipBlocos')}</div>
              </div>
            </div>
            <div className={styles.hourRule}>{t('reservas_page.horaCheiaAviso')}</div>
            <div style={{
              padding: '10px 12px',
              backgroundColor: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#92400e',
              marginBottom: '16px'
            }}>
              ℹ️ {t('reservas_page.equipAvariado')}
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  <FontAwesomeIcon icon={faUser} className={styles.fieldIcon} aria-hidden="true" />
                  {t('reservas_page.utilizador')}
                </span>
                <select
                  className={styles.input}
                  value={form.utilizador_id}
                  onChange={e => setForm(f => ({ ...f, utilizador_id: e.target.value }))}
                  disabled={user && String(user.role).toLowerCase() !== 'admin'}
                  title={user && String(user.role).toLowerCase() !== 'admin' ? t('reservas_page.operadorTooltip') : t('reservas_page.adminTooltip')}
                >
                  <option value="">{t('reservas_page.selecionarUtilizador')}</option>
                  {utilizadores.map(ut => (
                    <option key={ut.id} value={ut.id}>{ut.nome} ({ut.departamento})</option>
                  ))}
                </select>
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
                    <select
                      className={styles.input}
                      value={form.equipamento_id}
                      onChange={e => setForm(f => ({ ...f, equipamento_id: e.target.value }))}
                    >
                      <option value="">{t('reservas_page.selecionarEquipamento')}</option>
                      {[...equipamentosPorCategoria.entries()].map(([tipo, lista]) => (
                        <optgroup key={tipo} label={tCategoria(tipo)}>
                          {lista.map(eq => (
                            <option key={eq.id} value={eq.id}>
                              {eq.codigo} — {eq.nome}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
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
                      <div className={styles.infoWrapSmall}>
                        <span className={styles.infoIconSmall}>i</span>
                        <div className={styles.infoTooltip}>{t('reservas_page.tooltipDuracao')}</div>
                      </div>
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
                    <textarea className={styles.textarea} rows={5} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
                  </label>
                </div>
              </div>
            </div>

            {formErro && <div className={styles.formErro}>{formErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={fecharModalReserva}>{t('reservas_page.cancelar')}</button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
                {saving ? t('reservas_page.aGuardar') : modalModo === 'edit' ? 'Guardar alterações' : t('reservas_page.criarReserva')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}