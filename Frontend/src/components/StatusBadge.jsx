import React from 'react'
import { useLanguage } from '../contexts/useLanguage.js'

const MAP = {
  'Disponível':    { cls: 'badge-disponivel', labelKey: 'status.disponivel' },
  'Avariado':      { cls: 'badge-nok',        labelKey: 'status.avariado' },
  'Ocupado':       { cls: 'badge-ocupado',    labelKey: 'status.ocupado' },
  'Em calibração': { cls: 'badge-calib',      labelKey: 'status.emCalibracao' },
  'Em manutenção': { cls: 'badge-manut',      labelKey: 'status.emManutencao' },
  'Limitado':      { cls: 'badge-limitado',   labelKey: 'status.degradado' },
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
  const { t } = useLanguage()

  if (estado !== undefined) {
    const estadoNormalizado = normalizarEstadoEquipamento(estado)
    const { cls, labelKey } = MAP[estadoNormalizado] ?? { cls: 'badge-nok', labelKey: null }
    const label = labelKey ? t(labelKey) : (estadoNormalizado ?? '—')
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