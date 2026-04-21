import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import styles from './UserMenu.module.css'

export default function UserMenu() {
  const { user, logout, bootstrapAvailable, openBootstrapPrompt } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) return null
  return (
    <div className={styles.wrap}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.name}>{user.nome}</span>
        <span className={styles.role}>{String(user.role).toUpperCase()}</span>
      </button>

      {/* Styled tooltip (shows on hover) */}
      <div className={styles.tooltip} role="tooltip">
        <div className={styles.tooltipName}>{user.nome}</div>
        <div className={styles.tooltipRole}>{String(user.role).toUpperCase()}</div>
      </div>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.meta}>Sessão ativa</div>
          <button
            className={styles.action}
            onClick={async () => {
              setOpen(false)
              await logout()
            }}
          >
            Mudar utilizador
          </button>
          {bootstrapAvailable && user.role !== 'admin' && (
            <button
              className={styles.action}
              onClick={() => {
                setOpen(false)
                openBootstrapPrompt()
              }}
            >
              Criar administrador inicial
            </button>
          )}
        </div>
      )}
    </div>
  )
}
