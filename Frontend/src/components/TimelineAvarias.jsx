import { useState } from 'react'
import EmptyState from './EmptyState.jsx'
import { fmtDate as fmtData, fmtEur } from '../utils/dateFormat.js'

const TRUNC = 120

function corNo(severidade, resolvida) {
  if (resolvida) return '#16a34a'
  if (severidade === 'BLOQUEANTE') return '#dc2626'
  if (severidade === 'ALERTA') return '#f59e0b'
  return 'var(--text-dim)'
}

function badgeSev(severidade) {
  if (severidade === 'BLOQUEANTE')
    return { background: '#fee2e2', color: '#dc2626' }
  if (severidade === 'ALERTA')
    return { background: '#fef3c7', color: '#b45309' }
  return { background: 'var(--surface)', color: 'var(--text-dim)' }
}

function AvariaItem({ av, locale }) {
  const [expandida, setExpandida] = useState(false)

  const desc = av.descricao || ''
  const longa = desc.length > TRUNC
  const textoVis = longa && !expandida ? desc.slice(0, TRUNC) + '…' : desc

  const sevStyle = badgeSev(av.severidade)

  return (
    <div style={{ position: 'relative', marginBottom: 20, paddingLeft: 8 }}>
      {/* Nó circular na linha vertical */}
      <div style={{
        position: 'absolute',
        left: -31,
        top: 4,
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: corNo(av.severidade, av.resolvida),
        border: '2px solid var(--bg)',
        flexShrink: 0,
      }} />

      {/* Cabeçalho */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {fmtData(av.data_registo, locale)}
        </span>
        {av.severidade && (
          <span style={{
            fontSize: 11,
            padding: '1px 7px',
            borderRadius: 10,
            fontWeight: 600,
            ...sevStyle,
          }}>
            {av.severidade}
          </span>
        )}
        {av.resolvida && (
          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
            ✓ Resolvida
          </span>
        )}
      </div>

      {/* Descrição com truncagem */}
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
        {textoVis}
        {longa && (
          <button
            onClick={() => setExpandida(e => !e)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}
          >
            {expandida ? 'ver menos' : 'ver mais'}
          </button>
        )}
      </div>

      {/* Tags opcionais */}
      {(av.empresa_externa || av.num_sc_po) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {av.empresa_externa && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              🏢 {av.empresa_externa}
            </span>
          )}
          {av.num_sc_po && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              SC/PO: {av.num_sc_po}
            </span>
          )}
        </div>
      )}

      {/* Bloco de resolução */}
      {av.resolvida && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          marginTop: 6,
          fontSize: 12,
        }}>
          {av.data_resolucao && (
            <div>Resolvida em: <strong>{fmtData(av.data_resolucao, locale)}</strong></div>
          )}
          {av.notas_resolucao && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{av.notas_resolucao}</div>
          )}
          {av.custo_reparacao != null && (
            <div style={{ marginTop: 2 }}>{fmtEur(av.custo_reparacao, locale)}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TimelineAvarias({ avarias = [], locale = 'pt-PT' }) {
  if (!avarias.length) {
    return (
      <EmptyState
        icon="✓"
        title="Sem avarias"
        subtitle="Sem avarias registadas."
        variant="positive"
      />
    )
  }

  const ordenadas = [...avarias].sort(
    (a, b) => new Date(b.data_registo) - new Date(a.data_registo)
  )

  return (
    <div style={{
      position: 'relative',
      paddingLeft: 24,
      borderLeft: '2px solid var(--border)',
      marginLeft: 6,
    }}>
      {ordenadas.map(av => (
        <AvariaItem key={av.id} av={av} locale={locale} />
      ))}
    </div>
  )
}
