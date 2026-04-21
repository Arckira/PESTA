import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ToastProvider.module.css'

const ToastContext = createContext(null)

let toastSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((message, type = 'info', duration = 3200) => {
    const id = ++toastSeq
    const toast = { id, message, type }
    setToasts((prev) => [...prev, toast])

    window.setTimeout(() => {
      removeToast(id)
    }, duration)
  }, [removeToast])

  const api = useMemo(() => ({
    success: (message, duration) => pushToast(message, 'success', duration),
    error: (message, duration) => pushToast(message, 'error', duration),
    info: (message, duration) => pushToast(message, 'info', duration),
  }), [pushToast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={styles.stack} aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
              <div className={styles.icon} aria-hidden="true">
                {toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}
              </div>
              <div className={styles.message}>{toast.message}</div>
              <button
                className={styles.close}
                onClick={() => removeToast(toast.id)}
                aria-label="Fechar notificação"
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast deve ser usado dentro de ToastProvider')
  }
  return ctx
}
