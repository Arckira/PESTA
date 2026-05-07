import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { LOGIN_PATH } from '../contexts/authNavigation.js'

export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      navigate(LOGIN_PATH, {
        replace: true,
        state: { from: `${location.pathname}${location.search}${location.hash}` },
      })
      return
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      navigate('/equipamentos', { replace: true })
    }
  }, [allowedRoles, isLoading, location.hash, location.pathname, location.search, navigate, user])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--color-text-muted, #888)', fontSize: '0.9rem' }}>A carregar...</span>
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return null
  }

  return children
}
