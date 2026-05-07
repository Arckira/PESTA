import React from 'react'

/**
 * `StatusBadge` unifica dois usos:
 * - Uso simples: `<StatusBadge variant="ok">Texto</StatusBadge>`
 * - Uso com estado do backend: `<StatusBadge estado={estado} />`
 */
const MAP = {
  'Disponível': { cls: 'badge-disponivel', label: 'Disponível' },
  'Avariado': { cls: 'badge-nok', label: 'Avariado' },
  'Ocupado': { cls: 'badge-ocupado', label: 'Ocupado' },
  'Em calibração': { cls: 'badge-calib', label: 'Em Calibração' },
  'Em manutenção': { cls: 'badge-manut', label: 'Em Manutenção' },
}

const LEGACY_MAP = {
  'nok': 'Avariado',
  'em funcionamento': 'Disponível',
}

export function normalizarEstadoEquipamento(estado) {
  if (estado === null || estado === undefined) return 'Disponível'

  const texto = String(estado).trim()
  return LEGACY_MAP[texto.toLowerCase()] ?? texto
}

function StatusBadge({ variant = 'neutral', children, estado }) {
  if (estado !== undefined) {
    const estadoNormalizado = normalizarEstadoEquipamento(estado)
    const { cls, label } = MAP[estadoNormalizado] ?? { cls: 'badge-nok', label: estadoNormalizado ?? '—' }
    return <span className={`badge ${cls}`}>{label}</span>
  }

  const base = 'badge'
  const cls = variant === 'success'
    ? `${base} badge-ok`
    : variant === 'danger'
      ? `${base} badge-nok`
      : variant === 'occupied'
        ? `${base} badge-ocupado`
        : base

  return <span className={cls} style={{ fontSize: 12 }}>{children}</span>
}

export default React.memo(StatusBadge)
