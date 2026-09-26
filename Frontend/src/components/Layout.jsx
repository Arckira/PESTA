import { Link, NavLink } from 'react-router-dom'
import { LogOut, LayoutDashboard, Microscope, CalendarCheck, AlertTriangle, Wrench, ClipboardCheck, Scale, Users, FlaskConical } from 'lucide-react'
import styles from './Layout.module.css'
import UserMenu from './UserMenu.jsx'
import LanguageToggle from './LanguageToggle.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import { PUBLIC_PATHS } from '../contexts/authNavigation.js'

export default function Layout({ children }) {
  const { user, logout, openAuthPrompt } = useAuth()
  const { t } = useLanguage()

  const NAV = [
    { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
    { to: '/equipamentos', icon: Microscope, labelKey: 'nav.equipamentos' },
    { to: '/reservas', icon: CalendarCheck, labelKey: 'nav.reservas' },
    { to: '/avarias', icon: AlertTriangle, labelKey: 'nav.avarias' },
    { to: '/manutencoes', icon: Wrench, labelKey: 'nav.manutencoes' },
    { to: '/verificacoes', icon: ClipboardCheck, labelKey: 'nav.verificacoes' },
    { to: '/calibracoes', icon: Scale, labelKey: 'nav.calibracoes' },
    { to: '/utilizadores', icon: Users, labelKey: 'nav.utilizadores' },
  ]

  const navItems = user ? NAV : NAV.filter(({ to }) => PUBLIC_PATHS.has(to))

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <Link
            to="/"
            className={styles.logoLink}
            aria-label={t('nav.goHome')}
          >
            <FlaskConical className={styles.logoImage} aria-hidden="true" />
            <span className={styles.departmentName}>Testing Centre</span>
          </Link>
        </div>

        <nav className={styles.nav}>
          {navItems.map(({ to, icon: Icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.navIcon} aria-hidden>
                <Icon size={20} strokeWidth={1.5} />
              </span>
              <span>{t(labelKey)}</span>
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
              aria-label={t('nav.logout')}
            >
              <LogOut size={20} strokeWidth={1.5} />
              {t('nav.logout')}
            </button>
          )}
          {!user && (
            <button
              onClick={() => openAuthPrompt('login')}
              style={{ background: 'none', border: '1px solid var(--border, #444)', color: 'var(--text, #eee)', padding: '6px 12px', cursor: 'pointer', borderRadius: 4, fontSize: '0.85rem', width: '100%', marginBottom: 4 }}
            >
              {t('nav.login')}
            </button>
          )}
          <LanguageToggle />
          <div className="label">{import.meta.env.VITE_APP_VERSION || 'v0.3.0'} - LAB</div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div className={styles.sessionPanel}>
            <div className={styles.sessionIdentity}>
                <div className="text-[10px] font-bold tracking-widest text-red-600 uppercase block mb-0.5">{t('nav.activeUser')}</div>
              {user ? (
                <div className={styles.sessionNameRow}>
                  <strong className={styles.sessionName}>{user.nome}</strong>
                  <span className={styles.sessionRole}>{String(user.role).toUpperCase()}</span>
                </div>
              ) : (
                <div className={styles.sessionPlaceholder}>{t('nav.noSession')}</div>
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