import React from 'react'

/**
 * ResourceTable: wrapper genérico para tabelas de recursos.
 * Props:
 * - columns: array de strings (cabecalhos)
 * - items: array de itens
 * - renderRow: função (item) => <tr>...</tr>
 * - loading: boolean
 * - emptyNode: node a mostrar quando não há items
 * - showTrailingHeader: boolean para renderizar a célula extra no cabeçalho/empty state
 */
export default React.memo(function ResourceTable({
  columns = [],
  items = [],
  renderRow,
  loading = false,
  emptyNode = null,
  wrapperClass = 'tableWrap',
  tableClass = 'table',
  showTrailingHeader = true,
}) {
  if (loading) return <div className="loading">A carregar…</div>

  return (
    <div className={wrapperClass}>
      <table className={tableClass} style={{ width: '100%' }}>
        <thead>
          <tr>
            {columns.map((c, i) => <th key={i}>{c}</th>)}
            {showTrailingHeader && <th />}
          </tr>
        </thead>
        <tbody>
          {items && items.length > 0 ? items.map(renderRow) : (
            <tr>
              <td colSpan={columns.length + (showTrailingHeader ? 1 : 0)} className="emptyCell">
                {emptyNode}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
})
