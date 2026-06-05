import { useState } from 'react'
import { UserCircle2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './UserMenu.module.css'

export default function UserMenu() {
  const { user, logout, bootstrapAvailable, openBootstrapPrompt } = useAuth()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  if (!user) return null
  return (
    <div className={styles.wrap}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <div className={styles.avatar} aria-hidden>
          <UserCircle2 size={36} strokeWidth={1.5} />
        </div>
        <div className={styles.textContent}>
          <span className={styles.name}>{user.nome}</span>
          <span className={styles.role}>{String(user.role).toUpperCase()}</span>
        </div>
      </button>

      {/* Styled tooltip (shows on hover) */}
      <div className={styles.tooltip} role="tooltip">
        <div className={styles.tooltipName}>{user.nome}</div>
        <div className={styles.tooltipRole}>{String(user.role).toUpperCase()}</div>
      </div>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.meta}>{t('userMenu.activeSession')}</div>
          <button
            className={styles.action}
            onClick={async () => {
              setOpen(false)
              await logout()
            }}
          >
            {t('userMenu.switchUser')}
          </button>
          {bootstrapAvailable && user.role !== 'admin' && (
            <button
              className={styles.action}
              onClick={() => {
                setOpen(false)
                openBootstrapPrompt()
              }}
            >
              {t('userMenu.createAdmin')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
