import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, setStoredToken } from '../api/index.js'
import { setAuthPromptHandler } from './authBridge.js'
import { PUBLIC_PATHS } from './authNavigation.js'

const AuthContext = createContext(null)
const SESSION_STORAGE_KEY = 'lab_auth_session'
const LAST_USER_STORAGE_KEY = 'lab_last_user_id'

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearSessionStorage() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
  setStoredToken(null)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptMode, setPromptMode] = useState('login')
  const [redirectPath, setRedirectPath] = useState(null)
  const pendingPromptRef = useRef(null)

  const syncBootstrapStatus = async ({ abrirSetup = false } = {}) => {
    try {
      const estado = await api.authBootstrapStatus()
      const disponivel = !estado.has_admin
      setBootstrapAvailable(disponivel)
      if (abrirSetup) {
        // Sem admin → primeiro arranque; com admin → login normal
        setPromptMode(disponivel ? 'bootstrap-admin' : 'login')
        setPromptOpen(true)
      }
    } catch {
      setBootstrapAvailable(false)
      if (abrirSetup) {
        // Falha de rede: abrir modal de login como fallback
        setPromptMode('login')
        setPromptOpen(true)
      }
    }
  }

  useEffect(() => {
    const restored = readSession()

    // Safety timeout: se as chamadas de rede ficarem pendentes (ex: MSSQL down
    // / backend indisponível), garantir que a página não fica branca para sempre.
    const startupTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('Auth bootstrap timeout — forçando isLoading=false')
      setIsLoading(false)
    }, 15000)

    if (!restored || !restored.token || !restored.expira_em_epoch_ms) {
      clearSessionStorage()
      const isPublicPath = Array.from(PUBLIC_PATHS).some((p) => window.location.pathname.startsWith(p))
      syncBootstrapStatus({ abrirSetup: !isPublicPath }).finally(() => {
        clearTimeout(startupTimer)
        setIsLoading(false)
      })
      return
    }

    if (Date.now() >= restored.expira_em_epoch_ms) {
      clearSessionStorage()
      clearTimeout(startupTimer)
      setIsLoading(false)
      return
    }

    setStoredToken(restored.token)
    api.authMe()
      .then((utilizador) => {
        const merged = { ...restored, utilizador }
        setSession(merged)
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged))
        localStorage.setItem(LAST_USER_STORAGE_KEY, String(utilizador.id))
      })
      .catch(() => {
        clearSessionStorage()
        syncBootstrapStatus({ abrirSetup: true })
      })
      .finally(() => {
        syncBootstrapStatus().finally(() => {
          clearTimeout(startupTimer)
          setIsLoading(false)
        })
      })
  }, [])

  const openAuthPrompt = (mode = 'login', redirectTo = null) => {
    setPromptMode(mode)
    setPromptOpen(true)
    if (redirectTo !== null) setRedirectPath(redirectTo)
    return new Promise((resolve, reject) => {
      pendingPromptRef.current = { resolve, reject }
    })
  }

  const closeAuthPrompt = () => {
    setPromptOpen(false)
    setPromptMode('login')
    if (pendingPromptRef.current) {
      pendingPromptRef.current.reject(new Error('Autenticação cancelada'))
      pendingPromptRef.current = null
    }
  }

  const openBootstrapPrompt = () => {
    pendingPromptRef.current = null
    setPromptMode('bootstrap-admin')
    setPromptOpen(true)
  }

  const completePrompt = () => {
    if (pendingPromptRef.current) {
      pendingPromptRef.current.resolve(true)
      pendingPromptRef.current = null
    }
    setPromptOpen(false)
    setPromptMode('login')
  }

  const login = async ({ userId, pin }) => {
    const data = await api.authLogin(userId, pin)
    const novaSessao = {
      token: data.token,
      expira_em: data.expira_em,
      expira_em_epoch_ms: data.expira_em_epoch_ms,
      utilizador: data.utilizador,
    }
    setStoredToken(data.token)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(novaSessao))
    localStorage.setItem(LAST_USER_STORAGE_KEY, String(data.utilizador.id))
    setSession(novaSessao)
    if (!data.utilizador.forcar_troca_pin) {
      completePrompt()
    } else {
      setPromptMode('change-pin')
      setPromptOpen(true)
    }
    return data
  }

  const logout = async () => {
    try {
      await api.authLogout()
    } catch {
      // Ignorar erro no logout remoto e limpar sessão local sempre.
    } finally {
      clearSessionStorage()
      setSession(null)
      // replace() elimina a entrada atual do histórico: o botão "voltar"
      // do browser não permite regressar a páginas protegidas.
      window.location.replace('/login')
    }
  }

  const alterarPin = async (pinAtual, novoPin) => {
    await api.authAlterarPin(pinAtual, novoPin)
    const utilizadorAtualizado = { ...session.utilizador, forcar_troca_pin: false }
    const novaSessao = { ...session, utilizador: utilizadorAtualizado }
    setSession(novaSessao)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(novaSessao))
    completePrompt()
  }

  const value = useMemo(() => ({
    isLoading,
    session,
    user: session?.utilizador || null,
    bootstrapAvailable,
    promptOpen,
    promptMode,
    redirectPath,
    setRedirectPath,
    lastUserId: localStorage.getItem(LAST_USER_STORAGE_KEY),
    login,
    logout,
    alterarPin,
    openAuthPrompt,
    openBootstrapPrompt,
    closeAuthPrompt,
  }), [isLoading, session, promptOpen, promptMode, redirectPath, openAuthPrompt, openBootstrapPrompt, closeAuthPrompt])

  useEffect(() => {
    setAuthPromptHandler((mode = 'login') => openAuthPrompt(mode))
    return () => setAuthPromptHandler(null)
  }, [])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
