import { useEffect, useMemo, useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import { api } from '../../api/index.js'
import styles from './HistoryDrawer.module.css'

function formatDateTitle(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatWeekTitle(weekStartDate) {
  const start = new Date(weekStartDate)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)

  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
  const endLabel = end.toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: sameMonth ? undefined : 'short',
    year: 'numeric',
  })
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const yearLabel = startYear === endYear ? `${startYear}` : `${startYear} - ${endYear}`

  return `Semana ${startLabel} - ${endLabel} ${yearLabel}`
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek(date) {
  const d = startOfDay(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d
}

function endOfWeek(date) {
  const d = startOfWeek(date)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfMonth(date) {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfMonth(date) {
  const d = startOfMonth(date)
  d.setMonth(d.getMonth() + 1)
  d.setMilliseconds(-1)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function isWithinRange(date, start, end) {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime()
}

function filterSessionsByPeriod(sessions, period, now = new Date()) {
  if (period === 'all') return sessions

  const currentDay = startOfDay(now)
  const currentWeekStart = startOfWeek(now)
  const currentWeekEnd = endOfWeek(now)
  const currentMonthStart = startOfMonth(now)
  const currentMonthEnd = endOfMonth(now)

  return sessions.filter((session) => {
    if (!session.inicio) return false
    const sessionDate = new Date(session.inicio)

    if (period === 'today') return isSameDay(sessionDate, currentDay)
    if (period === 'week') return isWithinRange(sessionDate, currentWeekStart, currentWeekEnd)
    if (period === 'month') return isWithinRange(sessionDate, currentMonthStart, currentMonthEnd)
    return true
  })
}

function groupSessionsByPeriod(sessions, period) {
  const groups = {}

  sessions.forEach((session) => {
    if (!session.inicio) return
    const date = new Date(session.inicio)

    if (period === 'month') {
      const weekStart = startOfWeek(date)
      const key = weekStart.toISOString().slice(0, 10)
      groups[key] = groups[key] || { title: formatWeekTitle(weekStart), items: [] }
      groups[key].items.push(session)
      return
    }

    const key = date.toISOString().slice(0, 10)
    groups[key] = groups[key] || { title: formatDateTitle(key), items: [] }
    groups[key].items.push(session)
  })

  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({
      date: key,
      title: groups[key].title,
      items: groups[key].items.sort((a, b) => new Date(b.inicio || 0) - new Date(a.inicio || 0)),
    }))
}

function formatTimeRange(inicio, fim) {
  const si = inicio ? new Date(inicio) : null
  const sf = fim ? new Date(fim) : null
  const pad = (n) => String(n).padStart(2, '0')
  if (!si) return '—'
  const hi = `${pad(si.getHours())}:${pad(si.getMinutes())}`
  const hf = sf ? `${pad(sf.getHours())}:${pad(sf.getMinutes())}` : 'em curso'
  return `${hi} — ${hf}`
}

function formatDurationMinutes(inicio, fim) {
  const si = inicio ? new Date(inicio).getTime() : null
  const sf = fim ? new Date(fim).getTime() : Date.now()
  if (!si) return '—'
  const minutes = Math.max(0, Math.round((sf - si) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const FILTERS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta Semana' },
  { key: 'month', label: 'Este Mês' },
  { key: 'all', label: 'Tudo' },
]

export default function HistoryDrawer({ equipamentoId, open = false, onClose = () => {} }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState('all')

  useEffect(() => {
    if (!open) return
    let mounted = true
    setLoading(true)
    api.listarSessoes(equipamentoId).then((data) => {
      if (!mounted) return
      setSessions(Array.isArray(data) ? data : [])
    }).catch(() => {
      if (!mounted) return
      setSessions([])
    }).finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [equipamentoId, open])

  useEffect(() => {
    if (!open) return
    setSelectedFilter('all')
  }, [open])

  const visibleSessions = useMemo(
    () => filterSessionsByPeriod(sessions, selectedFilter),
    [sessions, selectedFilter],
  )

  const grouped = useMemo(
    () => groupSessionsByPeriod(visibleSessions, selectedFilter),
    [visibleSessions, selectedFilter],
  )

  const stats = useMemo(() => {
    const totalMinutes = visibleSessions.reduce((sum, s) => {
      if (!s.inicio) return sum
      const start = new Date(s.inicio).getTime()
      const end = s.fim ? new Date(s.fim).getTime() : Date.now()
      return sum + Math.max(0, Math.round((end - start) / 60000))
    }, 0)
    const projects = {}
    visibleSessions.forEach((s) => {
      const p = s.projeto || '—'
      projects[p] = (projects[p] || 0) + 1
    })
    const mostFreqProject = Object.keys(projects).reduce((a, b) => (projects[b] > (projects[a] || 0) ? b : a), Object.keys(projects)[0] || '—')
    return {
      totalHours: (totalMinutes / 60).toFixed(1),
      totalSessions: visibleSessions.length,
      mostFreqProject,
    }
  }, [visibleSessions])

  if (!open) return null

  return (
    <div
      className={styles.drawer}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={styles.panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={`${styles.title} text-base font-bold text-gray-800 tracking-wide uppercase`}>Histórico</div>
          <button className={styles.close} onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <div className={styles.quickStats}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Horas</div>
            <div className={styles.statValue}>{stats.totalHours}h</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Sessões</div>
            <div className={styles.statValue}>{stats.totalSessions}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Projeto mais comum</div>
            <div className={styles.statValue}>{stats.mostFreqProject}</div>
          </div>
        </div>

        <div className={styles.filters} role="tablist" aria-label="Filtrar histórico por período">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              role="tab"
              aria-selected={selectedFilter === filter.key}
              className={`${styles.filterTab} ${selectedFilter === filter.key ? styles.filterTabActive : ''}`}
              onClick={() => setSelectedFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>A carregar histórico…</div>
          ) : (
            <div className={styles.timeline}>
              {grouped.length === 0 && (
                <div className={styles.emptyState}>
                  <CalendarX2 className={styles.emptyIcon} aria-hidden="true" />
                  <div className={styles.emptyText}>Sem registos para este período</div>
                </div>
              )}
              {grouped.map((grp) => (
                <div key={grp.date} className={styles.group}>
                  <div className={styles.groupTitle}>{grp.title}</div>
                  <div className={styles.groupItems}>
                    {grp.items.map((s) => {
                      const finished = !!s.fim
                      return (
                        <div key={s.id || `${s.inicio}-${Math.random()}`} className={styles.item}>
                          <div className={styles.lineMarker}>
                            <div className={styles.dot} data-finished={finished} />
                          </div>
                          <div className={styles.itemContent}>
                            <div className={styles.timeRange}>{formatTimeRange(s.inicio, s.fim)}</div>
                            <div className={styles.meta}>
                              <div className={styles.user}>{s.utilizador?.nome || s.utilizador || '—'}</div>
                              <div className={styles.project}>{s.projeto || '—'}</div>
                            </div>
                          </div>
                          <div className={styles.duration}>{formatDurationMinutes(s.inicio, s.fim)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
