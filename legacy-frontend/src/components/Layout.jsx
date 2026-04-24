import { Link, NavLink } from 'react-router-dom'
import styles from './Layout.module.css'
import UserMenu from './UserMenu.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

const NAV = [
  { to: '/',              icon: '⬡', label: 'Dashboard' },
  { to: '/equipamentos',  icon: '⚙', label: 'Equipamentos' },
  { to: '/reservas',      icon: '📅', label: 'Reservas' },
  { to: '/avarias',       icon: '⚠', label: 'Avarias' },
  { to: '/manutencoes',   icon: '🔧', label: 'Manutenções' },
  { to: '/calibracoes',   icon: '◎', label: 'Calibrações' },
  { to: '/utilizadores',  icon: '👤', label: 'Utilizadores' },
]

export default function Layout({ children }) {
  const { user } = useAuth()

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <Link to="/" className={styles.logoLink} aria-label="Ir para o dashboard">
            <div className={styles.logoBrand}>
              <div className={styles.logoMark}>INDUSTRIAL TESTING LAB</div>
              <div className={styles.logoSub}>TESTING CENTRE</div>
            </div>
          </Link>
        </div>

        <nav className={styles.nav}>
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ''}`
              }
            >
              <span className={styles.navIcon}>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <UserMenu />
          <div className="label">v0.3.0 — LAB</div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div className={styles.sessionPanel}>
            <div className={styles.sessionIdentity}>
              <div className="label">Utilizador ativo</div>
              {user ? (
                <div className={styles.sessionNameRow}>
                  <strong className={styles.sessionName}>{user.nome}</strong>
                  <span className={styles.sessionRole}>{String(user.role).toUpperCase()}</span>
                </div>
              ) : (
                <div className={styles.sessionPlaceholder}>Sem sessão ativa</div>
              )}
            </div>
          </div>
        </div>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  )
}
