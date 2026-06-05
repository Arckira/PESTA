import { createPortal } from 'react-dom'
import styles from './ModalWrapper.module.css'

/**
 * Universal modal wrapper — backdrop centrado, card com scroll interno.
 *
 * Props:
 *   isOpen    — controla visibilidade
 *   onClose   — chamado ao clicar no backdrop ou no botão X
 *   categoria — etiqueta uppercase vermelha acima do título
 *   titulo    — título principal
 *   tamanho   — classe Tailwind de largura máxima (ex: "max-w-2xl"). Padrão: "max-w-xl"
 *   wide      — atalho para max-w-3xl quando tamanho não é passado
 *   children  — conteúdo do formulário injectado
 */
export default function ModalWrapper({
  isOpen,
  onClose,
  categoria,
  titulo,
  tamanho,
  wide = false,
  children,
}) {
  if (!isOpen) return null

  const sizeClass = tamanho ?? (wide ? 'max-w-3xl' : 'max-w-xl')

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.card} w-full ${sizeClass}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <div className={styles.categoria}>{categoria}</div>
            <h2 className={styles.titulo}>{titulo}</h2>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
