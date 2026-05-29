import { useLanguage } from '../contexts/useLanguage.js'

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage()

  const btnBase = {
    border: 'none',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: '0.7rem',
    fontWeight: 600,
    borderRadius: '6px',
    transition: 'all 0.2s',
    lineHeight: 1,
  }

  const activeBtn = {
    ...btnBase,
    background: 'var(--sidebar-bg, #fff)',
    color: 'var(--accent, #c8102e)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    cursor: 'default',
  }

  const inactiveBtn = {
    ...btnBase,
    background: 'none',
    color: 'var(--text-secondary, #888)',
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 'fit-content',
        background: 'rgba(200,16,46,0.06)',
        border: '1px solid rgba(200,16,46,0.15)',
        borderRadius: '8px',
        padding: '2px',
        userSelect: 'none',
        marginBottom: 4,
      }}
    >
      <button onClick={() => setLang('pt')} style={lang === 'pt' ? activeBtn : inactiveBtn}>
        PT
      </button>
      <button onClick={() => setLang('en')} style={lang === 'en' ? activeBtn : inactiveBtn}>
        EN
      </button>
    </div>
  )
}
