import React from 'react'

/**
 * `StatusBadge` unifica dois usos:
 * - Uso simples: `<StatusBadge variant="ok">Texto</StatusBadge>`
 * - Uso com estado do backend: `<StatusBadge estado={estado} />`
 */
const MAP = {
  'Disponível': { cls: 'badge-disponivel', label: 'Disponível' },
  'Em funcionamento': { cls: 'badge-ok', label: 'Disponível' },
  'Avariado': { cls: 'badge-nok', label: 'Avariado' },
  'NOK': { cls: 'badge-nok', label: 'Avariado' },
  'Ocupado': { cls: 'badge-ocupado', label: 'Ocupado' },
  'Em calibração': { cls: 'badge-calib', label: 'Em Calibração' },
  'Em manutenção': { cls: 'badge-manut', label: 'Em Manutenção' },
}

function StatusBadge({ variant = 'neutral', children, estado }) {
  if (estado !== undefined) {
    const { cls, label } = MAP[estado] ?? { cls: 'badge-nok', label: estado ?? '—' }
    return <span className={`badge ${cls}`}>{label}</span>
  }

  const base = 'badge'
  const cls = variant === 'ok'
    ? `${base} badge-ok`
    : variant === 'nok'
      ? `${base} badge-nok`
      : variant === 'ocupado'
        ? `${base} badge-ocupado`
        : base

  return <span className={cls} style={{ fontSize: 12 }}>{children}</span>
}

export default React.memo(StatusBadge)
