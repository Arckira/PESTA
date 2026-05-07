import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Avarias.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'

/**
 * Página: Avarias
 * - Lista avarias (filtráveis) e permite resolver uma avaria.
 * - Exemplo de refactor: usa `useEquipamentos`, `StatusBadge` e `ResourceTable`.
 */
function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Avarias() {
  const toast = useToast()
  const { map: equipamentos, loading: eqLoading } = useEquipamentos()
  const [avarias, setAvarias] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('abertas') // 'abertas' | 'resolvidas' | 'todas'
  const [pesquisa, setPesquisa] = useState('')

  // Modal resolver
  const [modal, setModal] = useState(null) // avaria object
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [sucesso, setSucesso] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const resolvida = filtro === 'abertas' ? false : filtro === 'resolvidas' ? true : undefined
      const av = await api.listarTodasAvarias(resolvida)
      setAvarias(av)
    } catch (e) {
      toast.error(`Falha ao carregar avarias: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [filtro, toast])

  useEffect(() => { carregar() }, [carregar])

  const navigate = useNavigate()
  const pesquisaLower = pesquisa.trim().toLowerCase()
  const avariasFiltradas = useMemo(() => {
    if (!pesquisaLower) return avarias

    return avarias.filter(a => {
      const eq = equipamentos[a.equipamento_id]
      const haystack = [
        String(a.id),
        eq?.nome,
        a.descricao,
        a.empresa_externa, // Adicionado à pesquisa
        a.num_sc_po,       // Adicionado à pesquisa
        a.resolvida ? 'resolvida' : 'aberta',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(pesquisaLower)
    })
  }, [avarias, equipamentos, pesquisaLower])

  const handleExport = useCallback(() => {
    if (!avariasFiltradas || avariasFiltradas.length === 0) return

    const resolvida = filtro === 'abertas' ? false : filtro === 'resolvidas' ? true : undefined
    api.exportarAvariasPdf({ resolvida, pesquisa })
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
        a.href = url
        a.download = `avarias-${stamp}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast.success('PDF das avarias exportado com sucesso.')
      })
      .catch((e) => {
        toast.error(e.message || 'Não foi possível exportar o PDF das avarias.')
      })
  }, [avariasFiltradas, filtro, pesquisa, toast])

  const handleResolver = useCallback(async () => {
    if (!modal) return
    setSaving(true)
    try {
      await api.resolverAvaria(modal.id, notas)
      toast.success('Avaria resolvida com sucesso.')
      setSucesso('Avaria resolvida com sucesso!')
      setTimeout(() => { setModal(null); setNotas(''); setSucesso(''); carregar() }, 1400)
    } catch (e) {
      toast.error(e.message || 'Não foi possível resolver a avaria.')
    } finally {
      setSaving(false)
    }
  }, [modal, notas, carregar, toast])

  const abertas   = avarias.filter(a => !a.resolvida).length
  const resolvidas = avarias.filter(a => a.resolvida).length

  const loadingPage = loading || eqLoading

  const renderRow = useCallback((av) => {
    const eq = equipamentos[av.equipamento_id]
    return (
      <tr key={av.id} className={av.resolvida ? styles.rowResolvida : styles.rowAberta}>
        <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(av.id).padStart(3,'0')}</td>
        <td>
          {eq ? (
            <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
          ) : `EQ-${av.equipamento_id}`}
        </td>
        <td className={styles.descricao}>{av.descricao}</td>
        
        {/* --- NOVAS COLUNAS INJETADAS AQUI --- */}
        <td style={{ color: av.empresa_externa ? 'inherit' : 'var(--text-dim)' }}>
          {av.empresa_externa || '—'}
        </td>
        <td className="mono" style={{ color: av.custo_reparacao ? 'var(--text-primary)' : 'var(--text-dim)' }}>
          {av.custo_reparacao ? `${av.custo_reparacao.toFixed(2)}€` : '—'}
        </td>
        <td className="mono" style={{ fontSize: 11, color: av.num_sc_po ? 'inherit' : 'var(--text-dim)' }}>
          {av.num_sc_po || '—'}
        </td>
        {/* ------------------------------------ */}

        <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_registo)}</td>
        <td>
          <StatusBadge variant={av.resolvida ? 'success' : 'danger'}>{av.resolvida ? 'Resolvida' : 'Aberta'}</StatusBadge>
        </td>
        <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_resolucao)}</td>
        <td>
          {!av.resolvida && (
            <button className={styles.btnResolver} onClick={() => { setModal(av); setNotas('') }}>
              Resolver
            </button>
          )}
        </td>
      </tr>
    )
  }, [equipamentos])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Histórico</div>
          <h1 className={styles.title}>Avarias</h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.pills}>
            {[['abertas','Abertas', abertas], ['resolvidas','Resolvidas', resolvidas], ['todas','Todas', avarias.length]].map(([val, label, count]) => (
              <button
                key={val}
                className={`${styles.pill} ${filtro === val ? styles.pillActive : ''}`}
                onClick={() => setFiltro(val)}
              >
                {label} <span className={styles.pillCount}>{count}</span>
              </button>
            ))}
          </div>

          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="Pesquisar por equipamento ou descrição…"
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
            />
            <button
              type="button"
              className={styles.btnExport}
              disabled={avariasFiltradas.length === 0}
              onClick={handleExport}
            >
              Exportar PDF
            </button>
          </div>
        </div>
      </div>

      {loadingPage && <div className={styles.empty}>A carregar…</div>}

      {!loadingPage && (
        <ResourceTable
          // --- ADICIONADOS OS CABEÇALHOS AQUI ---
          columns={[ '#', 'Equipamento', 'Descrição', 'Empresa', 'Custo (€)', 'SC / PO', 'Data Registo', 'Estado', 'Data Resolução', '' ]}
          items={avariasFiltradas}
          renderRow={renderRow}
          loading={false}
          emptyNode={(
            <EmptyState
              variant={avarias.length === 0 ? 'positive' : 'neutral'}
              icon="◎"
              title={
                avarias.length === 0
                  ? 'Ainda não existem avarias registadas.'
                  : 'Nenhuma avaria corresponde à pesquisa.'
              }
              subtitle={
                avarias.length === 0
                  ? 'Quando houver uma avaria, ela aparecerá aqui.'
                  : 'Tente outro termo ou limpe a pesquisa.'
              }
              buttonText={avarias.length === 0 ? 'Ver Equipamentos' : 'Limpar pesquisa'}
              onButtonClick={() => {
                if (avarias.length === 0) navigate('/equipamentos')
                else setPesquisa('')
              }}
            />
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {/* Modal Resolver */}
      {modal && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Avaria #{String(modal.id).padStart(3,'0')}</div>
            <h2 className={styles.modalTitle}>Resolver Avaria</h2>
            <div className={styles.modalDesc}>{modal.descricao}</div>

            {sucesso ? (
              <div className={styles.sucesso}>{sucesso}</div>
            ) : (
              <>
                <label className={styles.fieldLabel}>
                  <span className="label">Notas de Resolução (opcional)</span>
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    placeholder="Descreve o que foi feito para resolver o problema…"
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                  />
                </label>
                <p className={styles.aviso}>
                  O equipamento voltará automaticamente a <strong>Disponível</strong> se não houver outras avarias abertas.
                </p>
              </>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal(null)}>Cancelar</button>
              {!sucesso && (
                <button className={styles.btnGreen} onClick={handleResolver} disabled={saving}>
                  {saving ? 'A resolver…' : '✓ Confirmar Resolução'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}