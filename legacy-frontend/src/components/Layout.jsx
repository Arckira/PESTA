import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import styles from './Layout.module.css'
import UserMenu from './UserMenu.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getPostLoginPath, LOGIN_PATH, PUBLIC_PATHS } from '../contexts/authNavigation.js'

const NAV = [
  { to: '/', icon: '⬡', label: 'Dashboard' },
  { to: '/equipamentos', icon: '⚙', label: 'Equipamentos' },
  { to: '/reservas', icon: '📄', label: 'Reservas' },
  { to: '/avarias', icon: '⚠', label: 'Avarias' },
  { to: '/manutencoes', icon: '🔧', label: 'Manutenções' },
  { to: '/calibracoes', icon: '◍', label: 'Calibrações' },
  { to: '/utilizadores', icon: '👤', label: 'Utilizadores' },
]

export default function Layout({ children }) {
  const navigate = useNavigate()
  const { user, logout, openAuthPrompt } = useAuth()

  const navItems = user ? NAV : NAV.filter(({ to }) => PUBLIC_PATHS.has(to))
  const handleLogoClick = () => navigate(user ? getPostLoginPath(user) : LOGIN_PATH)

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <button
            type="button"
            className={styles.logoLink}
            aria-label="Ir para o inicio"
            onClick={handleLogoClick}
          >
            <div className={styles.logoBrand}>
              <div className={styles.logoMark}>INDUSTRIAL TESTING LAB</div>
              <div className={styles.logoSub}>TESTING CENTRE</div>
            </div>
          </button>
        </div>

        <nav className={styles.nav}>
          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.navIcon}>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <UserMenu />
          {user && (
            <button
              type="button"
              className={styles.logoutBtn}
              onClick={logout}
              aria-label="Terminar sessão"
            >
              <LogOut size={14} strokeWidth={2} />
              Sair
            </button>
          )}
          {!user && (
            <button
              onClick={() => openAuthPrompt('login')}
              style={{ background: 'none', border: '1px solid var(--border, #444)', color: 'var(--text, #eee)', padding: '6px 12px', cursor: 'pointer', borderRadius: 4, fontSize: '0.85rem', width: '100%', marginBottom: 4 }}
            >
              Entrar
            </button>
          )}
          <div className="label">v0.3.0 - LAB</div>
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
                <div className={styles.sessionPlaceholder}>Sem sessao ativa</div>
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
