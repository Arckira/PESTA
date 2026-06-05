/**
 * Formata uma data+hora para string ISO compatível com input[type="datetime-local"].
 * @param {Date|string} [date=new Date()]
 */
export function formatDateTimeLocal(date = new Date()) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Formata uma data+hora com dia, mês abreviado, ano, horas e minutos.
 * Usado em tabelas e listas de registos.
 * @param {string|null} dt
 * @param {string} [locale='pt-PT']
 */
export function fmtDateTime(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formata uma data (sem hora) com dia, mês abreviado e ano.
 * Usado em timelines e resumos.
 * @param {string|null} dt
 * @param {string} [locale='pt-PT']
 */
export function fmtDate(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Formata um valor numérico como moeda EUR.
 * @param {number|null} valor
 * @param {string} [locale='pt-PT']
 */
export function fmtEur(valor, locale = 'pt-PT') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(valor ?? 0)
}
