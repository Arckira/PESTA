import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { downloadCsv } from '../utils/downloadCsv.js'
import styles from './Avarias.module.css'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Avarias() {
  const toast = useToast()
  const [avarias, setAvarias] = useState([])
  const [equipamentos, setEquipamentos] = useState({})
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('abertas') // 'abertas' | 'resolvidas' | 'todas'
  const [pesquisa, setPesquisa] = useState('')

  // Modal resolver
  const [modal, setModal] = useState(null) // avaria object
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [sucesso, setSucesso] = useState('')

  const carregar = async () => {
    setLoading(true)
    try {
      const resolvida = filtro === 'abertas' ? false : filtro === 'resolvidas' ? true : undefined
      const [av, eqs] = await Promise.all([
        api.listarTodasAvarias(resolvida),
        api.listarEquipamentos(),
      ])
      setAvarias(av)
      const map = {}
      eqs.forEach(e => { map[e.id] = e })
      setEquipamentos(map)
    } catch (e) {
      toast.error(`Falha ao carregar avarias: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [filtro])

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
        a.resolvida ? 'resolvida' : 'aberta',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(pesquisaLower)
    })
  }, [avarias, equipamentos, pesquisaLower])

  const fmtCsv = (dt) => {
    if (!dt) return ''
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }

  const handleExport = () => {
    if (!avariasFiltradas || avariasFiltradas.length === 0) return

    const filename = `avarias-${new Date().toISOString().slice(0, 10)}.csv`
    const rows = avariasFiltradas.map(a => {
      const eq = equipamentos[a.equipamento_id]
      return {
        id: String(a.id).padStart(3, '0'),
        equipamento: eq?.nome || `EQ-${a.equipamento_id}`,
        descricao: a.descricao || '',
        data_registo: fmtCsv(a.data_registo),
        estado: a.resolvida ? 'Resolvida' : 'Aberta',
        data_resolucao: fmtCsv(a.data_resolucao),
      }
    })

    downloadCsv({
      filename,
      rows,
      delimiter: ';',
      columns: [
        { key: 'id', header: '#' },
        { key: 'equipamento', header: 'Equipamento' },
        { key: 'descricao', header: 'Descrição' },
        { key: 'data_registo', header: 'Data Registo' },
        { key: 'estado', header: 'Estado' },
        { key: 'data_resolucao', header: 'Data Resolução' },
      ],
    })
  }

  const handleResolver = async () => {
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
  }

  const abertas   = avarias.filter(a => !a.resolvida).length
  const resolvidas = avarias.filter(a => a.resolvida).length

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
              Exportar CSV
            </button>
          </div>
        </div>
      </div>

      {loading && <div className={styles.empty}>A carregar…</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Equipamento</th>
                <th>Descrição</th>
                <th>Data Registo</th>
                <th>Estado</th>
                <th>Data Resolução</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {avariasFiltradas.map(av => {
                const eq = equipamentos[av.equipamento_id]
                return (
                  <tr key={av.id} className={av.resolvida ? styles.rowResolvida : styles.rowAberta}>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(av.id).padStart(3,'0')}</td>
                    <td>
                      {eq ? (
                        <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>
                          {eq.nome}
                        </Link>
                      ) : `EQ-${av.equipamento_id}`}
                    </td>
                    <td className={styles.descricao}>{av.descricao}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_registo)}</td>
                    <td>
                      {av.resolvida
                        ? <span className="badge badge-ok">Resolvida</span>
                        : <span className="badge badge-nok">Aberta</span>
                      }
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
              })}
              {avariasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
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
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
                  O equipamento voltará automaticamente a <strong>Em Funcionamento</strong> se não houver outras avarias abertas.
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
