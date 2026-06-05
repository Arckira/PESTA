import styles from './EmptyState.module.css'

export default function EmptyState({
  icon = '◎',
  title,
  subtitle,
  buttonText,
  onButtonClick,
  variant = 'neutral', // 'neutral' | 'positive'
}) {
  const buttonClass =
    variant === 'positive' ? `${styles.button} ${styles.buttonPositive}` : styles.button

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.icon} aria-hidden="true">
        {icon}
      </div>
      {title && <div className={`${styles.title} text-base font-bold text-gray-800 tracking-wide uppercase`}>{title}</div>}
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}

      {buttonText && onButtonClick && (
        <button className={buttonClass} onClick={onButtonClick} type="button">
          {buttonText}
        </button>
      )}
    </div>
  )
}

