import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import SessionModal from './SessionModal.jsx'

const SessionContext = createContext(null)

const STORAGE_KEY = 'industrial-testing-lab.active-session'
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000

function readStoredSession() {
  if (typeof window === 'undefined') return { user: null, expiresAt: null }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed?.user || !parsed?.expiresAt) return { user: null, expiresAt: null }
    if (parsed.expiresAt <= Date.now()) return { user: null, expiresAt: null }
    return { user: parsed.user, expiresAt: parsed.expiresAt }
  } catch {
    return { user: null, expiresAt: null }
  }
}

function roleLabel(user) {
  const dep = (user?.departamento || '').trim()
  if (!dep) return 'Operador'
  if (/admin/i.test(dep)) return 'Admin'
  return dep
}

function formatRemainingTime(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function SessionProvider({ children }) {
  const toast = useToast()
  const stored = useRef(readStoredSession())
  const [activeUser, setActiveUser] = useState(stored.current.user)
  const [expiresAt, setExpiresAt] = useState(stored.current.expiresAt)
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(!stored.current.user)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    if (activeUser && expiresAt) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: activeUser, expiresAt }))
    }
  }, [activeUser, expiresAt])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!expiresAt || Date.now() < expiresAt) return

    setActiveUser(null)
    setExpiresAt(null)
    setIsModalOpen(true)
    toast.info('A sessão expirou. Seleciona novamente o utilizador ativo.')
  }, [expiresAt, now, toast])

  const loadUsers = async () => {
    setLoadingUsers(true)
    try {
      const data = await api.listarUtilizadores()
      setUsers(data)
      return data
    } catch (error) {
      toast.error(`Falha ao carregar utilizadores: ${error.message}`)
      return []
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    if (isModalOpen) {
      loadUsers()
    }
  }, [isModalOpen])

  const openSessionModal = async () => {
    setIsModalOpen(true)
    if (users.length === 0) {
      await loadUsers()
    }
  }

  const startSession = (user) => {
    const nextExpiry = Date.now() + SESSION_DURATION_MS
    setActiveUser(user)
    setExpiresAt(nextExpiry)
    setIsModalOpen(false)
    toast.success(`Sessão iniciada para ${user.nome}.`)
  }

  const clearSession = ({ reopenModal = false } = {}) => {
    setActiveUser(null)
    setExpiresAt(null)
    setIsModalOpen(reopenModal)
  }

  const changeUser = async () => {
    clearSession({ reopenModal: true })
    await loadUsers()
  }

  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0

  const value = {
    activeUser,
    roleLabel: roleLabel(activeUser),
    expiresAt,
    hasActiveSession: Boolean(activeUser && expiresAt && remainingMs > 0),
    remainingMs,
    remainingLabel: expiresAt ? formatRemainingTime(remainingMs) : null,
    isExpiringSoon: remainingMs > 0 && remainingMs <= 30 * 60 * 1000,
    openSessionModal,
    changeUser,
    clearSession,
    startSession,
    users,
    loadUsers,
  }

  const canCloseModal = Boolean(activeUser)

  return (
    <SessionContext.Provider value={value}>
      {children}
      <SessionModal
        open={isModalOpen}
        users={users}
        loading={loadingUsers}
        activeUser={activeUser}
        onSelect={startSession}
        onClose={() => canCloseModal && setIsModalOpen(false)}
        canClose={canCloseModal}
      />
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession deve ser usado dentro de SessionProvider')
  }
  return ctx
}
