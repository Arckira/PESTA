import { NavLink } from 'react-router-dom'
import styles from './Layout.module.css'

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
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>YZ</span>
          <div>
  
            <div className={styles.logoSub}>Testing Centre</div>
          </div>
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
          <div className="label">v0.3.0 — LAB</div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  )
}