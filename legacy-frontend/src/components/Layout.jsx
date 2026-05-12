import { Link, NavLink } from 'react-router-dom'
import { LogOut, LayoutDashboard, Microscope, CalendarCheck, AlertTriangle, Wrench, ClipboardCheck, Scale, Users } from 'lucide-react'
import styles from './Layout.module.css'
import UserMenu from './UserMenu.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { PUBLIC_PATHS } from '../contexts/authNavigation.js'
import labLogo from '../assets/industrial-testing-lab-logo.png'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/equipamentos', icon: Microscope, label: 'Equipamentos' },
  { to: '/reservas', icon: CalendarCheck, label: 'Reservas' },
  { to: '/avarias', icon: AlertTriangle, label: 'Avarias' },
  { to: '/manutencoes', icon: Wrench, label: 'Manutenções' },
  { to: '/verificacoes', icon: ClipboardCheck, label: 'Verificações' },
  { to: '/calibracoes', icon: Scale, label: 'Calibrações' },
  { to: '/utilizadores', icon: Users, label: 'Utilizadores' },
]

export default function Layout({ children }) {
  const { user, logout, openAuthPrompt } = useAuth()

  const navItems = user ? NAV : NAV.filter(({ to }) => PUBLIC_PATHS.has(to))

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <Link
            to="/"
            className={styles.logoLink}
            aria-label="Ir para o inicio"
          >
            <img src={labLogo} alt="Industrial Testing Lab" className={styles.logoImage} />
            <span className={styles.departmentName}>Testing Centre</span>
          </Link>
        </div>

        <nav className={styles.nav}>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.navIcon} aria-hidden>
                <Icon size={20} strokeWidth={1.5} />
              </span>
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
              <LogOut size={20} strokeWidth={1.5} />
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
