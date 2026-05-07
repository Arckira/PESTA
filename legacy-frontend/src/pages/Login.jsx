import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getPostLoginPath, LOGIN_PATH } from '../contexts/authNavigation.js'

const cardStyle = {
  maxWidth: '560px',
  margin: '48px auto',
  padding: '28px 32px',
  border: '1px solid var(--border)',
  borderRadius: '18px',
  background: 'linear-gradient(135deg, rgba(255,255,255,0.94), rgba(246,247,251,0.98))',
  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
}

export default function Login() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      navigate(getPostLoginPath(user), { replace: true })
    }
  }, [navigate, user])

  useEffect(() => {
    if (user) return

    // Mantem o utilizador no fluxo de autenticacao quando tenta recuar sem sessao valida.
    window.history.pushState({ labLoginLock: true }, '', window.location.href)

    const handlePopState = () => {
      navigate(LOGIN_PATH, { replace: true, state: location.state })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [location.state, navigate, user])

  return (
    <section style={cardStyle}>
      <div className="label">Autenticacao</div>
      <h1 style={{ margin: '8px 0 12px', fontSize: '2rem', lineHeight: 1.1 }}>Introduz o teu PIN</h1>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
        A autenticacao e obrigatoria para aceder as areas privadas do sistema.
      </p>
    </section>
  )
}
