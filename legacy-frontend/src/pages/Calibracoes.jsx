import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { downloadCsv } from '../utils/downloadCsv.js'
import styles from './Calibracoes.module.css'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function diasRestantes(dt) {
  if (!dt) return null
  return Math.ceil((new Date(dt) - new Date()) / (1000 * 60 * 60 * 24))
}

const EMPTY = { data_realizada: '', proxima_data: '', certificado_url: '' }

export default function Calibracoes() {
  const toast = useToast()
  const [calibracoes, setCalibracoes] = useState([])
  const [equipamentos, setEquipamentos] = useState({})
  const [proximas, setProximas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [eqSel, setEqSel] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [filtroUrgencia, setFiltroUrgencia] = useState('todas')

  const carregar = async () => {
    setLoading(true)
    try {
      const [cal, eqs, prox] = await Promise.all([
        api.listarTodasCalibracoes(),
        api.listarEquipamentos(),
        api.calibracoesProximas(30),
      ])
      setCalibracoes(cal)
      setProximas(prox)
      const map = {}
      eqs.forEach(e => { map[e.id] = e })
      setEquipamentos(map)
      if (eqs.length > 0 && !eqSel) setEqSel(String(eqs[0].id))
    } catch (e) {
      toast.error(`Falha ao carregar calibrações: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const pesquisaLower = pesquisa.trim().toLowerCase()

  const calibracoesFiltradas = useMemo(() => {
    return calibracoes.filter(cal => {
      const eq = equipamentos[cal.equipamento_id]
      const dias = diasRestantes(cal.proxima_data)
      const vencida = dias !== null && dias < 0
      const urgente = dias !== null && dias >= 0 && dias <= 30
      const ok = dias !== null && dias > 30

      const matchUrgencia =
        filtroUrgencia === 'todas' ||
        (filtroUrgencia === 'vencidas' && vencida) ||
        (filtroUrgencia === 'urgentes' && urgente) ||
        (filtroUrgencia === 'ok' && ok)

      if (!matchUrgencia) return false

      if (!pesquisaLower) return true

      const haystack = [
        String(cal.id),
        eq?.nome,
        cal.proxima_data,
        cal.certificado_url,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(pesquisaLower)
    })
  }, [calibracoes, equipamentos, pesquisaLower, filtroUrgencia])

  const fmtCsv = (dt) => {
    if (!dt) return ''
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }

  const handleExport = () => {
    if (!calibracoesFiltradas || calibracoesFiltradas.length === 0) return

    const filename = `calibracoes-${new Date().toISOString().slice(0, 10)}.csv`
    const rows = calibracoesFiltradas.map(cal => {
      const eq = equipamentos[cal.equipamento_id]
      const dias = diasRestantes(cal.proxima_data)
      const vencida = dias !== null && dias < 0
      const urgente = dias !== null && dias >= 0 && dias <= 30
      const ok = dias !== null && dias > 30

      const estado =
        dias === null
          ? 'Sem data'
          : vencida
            ? `Vencida há ${Math.abs(dias)}d`
            : urgente
              ? `A vencer em ${dias}d`
              : ok
                ? `Em dia (${dias}d)`
                : 'Sem data'

      return {
        id: String(cal.id).padStart(3, '0'),
        equipamento: eq?.nome || `EQ-${cal.equipamento_id}`,
        data_realizada: fmtCsv(cal.data_realizada),
        proxima_data: fmtCsv(cal.proxima_data),
        estado,
        certificado_url: cal.certificado_url || '',
      }
    })

    downloadCsv({
      filename,
      rows,
      delimiter: ';',
      columns: [
        { key: 'id', header: '#' },
        { key: 'equipamento', header: 'Equipamento' },
        { key: 'data_realizada', header: 'Data Realizada' },
        { key: 'proxima_data', header: 'Próxima Calibração' },
        { key: 'estado', header: 'Estado' },
        { key: 'certificado_url', header: 'Certificado' },
      ],
    })
  }

  const handleSubmit = async () => {
    if (!eqSel || !form.data_realizada) {
      setFormErro('Preenche os campos obrigatórios.')
      toast.error('Faltam campos obrigatórios na calibração.')
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      const payload = {
        data_realizada: new Date(form.data_realizada).toISOString(),
        proxima_data: form.proxima_data ? new Date(form.proxima_data).toISOString() : null,
        certificado_url: form.certificado_url || null,
      }
      await api.registarCalibracao(eqSel, payload)
      toast.success('Calibração registada com sucesso.')
      setModal(false)
      setForm(EMPTY)
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível registar calibração.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Registos</div>
          <h1 className={styles.title}>Calibrações</h1>
        </div>
        <button className={styles.btnPrimary} onClick={() => setModal(true)}>
          + Registar Calibração
        </button>
      </div>

      {/* Alerta: calibrações a vencer */}
      {proximas.length > 0 && (
        <div className={styles.alerta}>
          <span className={styles.alertaIcon}>◎</span>
          <div>
            <strong>{proximas.length} calibração(ões)</strong> a vencer nos próximos 30 dias.
            {proximas.map(c => {
              const eq = equipamentos[c.equipamento_id]
              const dias = diasRestantes(c.proxima_data)
              return (
                <span key={c.id} className={styles.alertaItem}>
                  {eq && <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>}
                  <span className="mono" style={{ fontSize: 11 }}>
                    {dias <= 0 ? ' — VENCIDA' : ` — ${dias}d`}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className={styles.filtersBar}>
        <input
          className={styles.search}
          placeholder="Pesquisar por equipamento ou certificado…"
          value={pesquisa}
          onChange={(e) => setPesquisa(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroUrgencia}
          onChange={(e) => setFiltroUrgencia(e.target.value)}
        >
          <option value="todas">Todas</option>
          <option value="vencidas">Vencidas</option>
          <option value="urgentes">A vencer (&lt;=30d)</option>
          <option value="ok">Em dia (&gt;30d)</option>
        </select>
        <button
          type="button"
          className={styles.btnExport}
          disabled={loading || calibracoesFiltradas.length === 0}
          onClick={handleExport}
        >
          Exportar CSV
        </button>
      </div>

      {loading && <div className={styles.empty}>A carregar…</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Equipamento</th>
                <th>Data Realizada</th>
                <th>Próxima Calibração</th>
                <th>Dias Restantes</th>
                <th>Certificado</th>
              </tr>
            </thead>
            <tbody>
              {calibracoesFiltradas.map(cal => {
                const eq = equipamentos[cal.equipamento_id]
                const dias = diasRestantes(cal.proxima_data)
                const vencida = dias !== null && dias < 0
                const urgente = dias !== null && dias >= 0 && dias <= 30
                return (
                  <tr key={cal.id}>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(cal.id).padStart(3,'0')}</td>
                    <td>
                      {eq
                        ? <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
                        : `EQ-${cal.equipamento_id}`
                      }
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(cal.data_realizada)}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(cal.proxima_data)}</td>
                    <td>
                      {dias !== null ? (
                        <span
                          className={`badge ${vencida ? 'badge-nok' : urgente ? 'badge-ocupado' : 'badge-ok'}`}
                          style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                        >
                          {vencida
                            ? `Vencida há ${Math.abs(dias)}d`
                            : urgente
                              ? `A vencer em ${dias}d`
                              : `Em dia (${dias}d)`}
                        </span>
                      ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td>
                      {cal.certificado_url
                        ? <a href={cal.certificado_url} target="_blank" rel="noreferrer" className={styles.certLink}>Ver →</a>
                        : <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
                      }
                    </td>
                  </tr>
                )
              })}
              {calibracoesFiltradas.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.emptyCell}>
                    <EmptyState
                      variant={calibracoes.length === 0 ? 'positive' : 'neutral'}
                      icon="◎"
                      title={
                        calibracoes.length === 0
                          ? 'Ainda não existem calibrações registadas.'
                          : 'Sem resultados para os filtros atuais.'
                      }
                      subtitle={
                        calibracoes.length === 0
                          ? 'Comece por registar a primeira calibração.'
                          : 'Tente outro termo ou mude a urgência.'
                      }
                      buttonText={calibracoes.length === 0 ? '+ Registar Calibração' : 'Limpar filtros'}
                      onButtonClick={() => {
                        if (calibracoes.length === 0) setModal(true)
                        else {
                          setPesquisa('')
                          setFiltroUrgencia('todas')
                        }
                      }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className={styles.overlay} onClick={() => setModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Calibração</div>
            <h2 className={styles.modalTitle}>Registar Calibração</h2>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className="label">Equipamento *</span>
                <select className={styles.input} value={eqSel} onChange={e => setEqSel(e.target.value)}>
                  {Object.values(equipamentos).map(eq => (
                    <option key={eq.id} value={eq.id}>{eq.nome}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className="label">Data Realizada *</span>
                <input type="datetime-local" className={styles.input} value={form.data_realizada}
                  onChange={e => setForm(f => ({ ...f, data_realizada: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span className="label">Próxima Calibração (opcional)</span>
                <input type="datetime-local" className={styles.input} value={form.proxima_data}
                  onChange={e => setForm(f => ({ ...f, proxima_data: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span className="label">URL do Certificado (opcional)</span>
                <input type="url" className={styles.input} value={form.certificado_url}
                  onChange={e => setForm(f => ({ ...f, certificado_url: e.target.value }))}
                  placeholder="https://..." />
              </label>
            </div>

            {formErro && <div className={styles.formErro}>{formErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setModal(false); setFormErro('') }}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
                {saving ? 'A guardar…' : 'Registar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
