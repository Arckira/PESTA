import { createContext, useState } from 'react'
import { translations } from '../i18n/index.js'

export const LanguageContext = createContext(null)

const SUPPORTED_LANGS = ['pt', 'en']

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const stored = localStorage.getItem('lab_lang')
    return SUPPORTED_LANGS.includes(stored) ? stored : 'pt'
  })

  const setLang = (newLang) => {
    if (!SUPPORTED_LANGS.includes(newLang)) return
    localStorage.setItem('lab_lang', newLang)
    setLangState(newLang)
  }

  const t = (key, vars) => {
    let str = translations[lang]?.[key] ?? translations['pt']?.[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
      }
    }
    return str
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}