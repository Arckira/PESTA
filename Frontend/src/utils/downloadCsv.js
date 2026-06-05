function csvEscape(value) {
  const v = value === null || value === undefined ? '' : String(value)
  // Excel/Sheets: escape com aspas duplas duplicadas
  const escaped = v.replace(/"/g, '""')
  return `"${escaped}"`
}

export function downloadCsv({ filename, rows, columns, delimiter = ';' }) {
  const safeFilename = filename || 'export.csv'
  const safeColumns = columns || []

  const headerLine = safeColumns.map(c => csvEscape(c.header)).join(delimiter)
  const bodyLines = (rows || []).map(row => {
    return safeColumns
      .map(c => {
        const key = c.key
        const raw = row?.[key]
        const formatted = c.format ? c.format(raw, row) : raw
        return csvEscape(formatted)
      })
      .join(delimiter)
  })

  const csv = [headerLine, ...bodyLines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  setTimeout(() => URL.revokeObjectURL(url), 0)
}

