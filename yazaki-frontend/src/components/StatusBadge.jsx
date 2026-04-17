// Mapeamento completo de todos os estados definidos no backend (EstadoEquipamento enum)
const MAP = {
  'Disponível':        { cls: 'badge-disponivel', label: 'Disponível' },
  'Em funcionamento':  { cls: 'badge-ok',         label: 'Em Funcionamento' },
  'NOK':               { cls: 'badge-nok',         label: 'NOK' },
  'Ocupado':           { cls: 'badge-ocupado',     label: 'Ocupado' },
  'Em calibração':     { cls: 'badge-calib',       label: 'Em Calibração' },
  'Em manutenção':     { cls: 'badge-manut',       label: 'Em Manutenção' },
}

export default function StatusBadge({ estado }) {
  const { cls, label } = MAP[estado] ?? { cls: 'badge-nok', label: estado ?? '—' }
  return <span className={`badge ${cls}`}>{label}</span>
}