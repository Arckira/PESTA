import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Manutencoes.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import ResourceTable from '../components/ResourceTable.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

/**
 * Página: Manutenções
 * Lista manutenções, permite registar uma nova manutenção.
 * Refactor: usa `useEquipamentos`, `ResourceTable` e memoização.
 */
function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isProxima(dt) {
  if (!dt) return false
  const diff = (new Date(dt) - new Date()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 30
}

function isVencida(dt) {
  if (!dt) return false
  return new Date(dt) < new Date()
}

const EMPTY = { descricao: '', data_realizada: '', proxima_data: '' }

export default function Manutencoes() {
  const toast = useToast()
  const { map: equipamentos, list: equipamentosList, loading: eqLoading } = useEquipamentos()

  const [manutencoes, setManutencoes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [eqSel, setEqSel] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const mn = await api.listarTodasManutencoes()
      setManutencoes(mn)
      if (equipamentosList.length > 0 && !eqSel) setEqSel(String(equipamentosList[0].id))
    } catch (e) {
      toast.error(`Falha ao carregar manutenções: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [equipamentosList, eqSel, toast])

  useEffect(() => { carregar() }, [carregar])

  const handleSubmit = useCallback(async () => {
    if (!eqSel || !form.descricao || !form.data_realizada) {
      setFormErro('Preenche os campos obrigatórios.')
      toast.error('Faltam campos obrigatórios na manutenção.')
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      const payload = {
        descricao: form.descricao,
        data_realizada: new Date(form.data_realizada).toISOString(),
        proxima_data: form.proxima_data ? new Date(form.proxima_data).toISOString() : null,
      }
      await api.registarManutencao(eqSel, payload)
      toast.success('Manutenção registada com sucesso.')
      setModal(false)
      setForm(EMPTY)
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível registar manutenção.')
    } finally {
      setSaving(false)
    }
  }, [eqSel, form, carregar, toast])

  const loadingPage = loading || eqLoading

  const renderRow = useCallback((mn) => {
    const eq = equipamentos[mn.equipamento_id]
    const proxVencida = isVencida(mn.proxima_data)
    const proxProxima = isProxima(mn.proxima_data)
    return (
      <tr key={mn.id}>
        <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(mn.id).padStart(3,'0')}</td>
        <td>
          {eq
            ? <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
            : `EQ-${mn.equipamento_id}`
          }
        </td>
        <td className={styles.descricao}>{mn.descricao}</td>
        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(mn.data_realizada)}</td>
        <td>
          {mn.proxima_data ? (
            <StatusBadge variant={proxVencida ? 'danger' : proxProxima ? 'occupied' : 'success'}>
              {proxVencida && '⚠ '}{proxProxima && '● '}{fmt(mn.proxima_data)}
            </StatusBadge>
          ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
      </tr>
    )
  }, [equipamentos])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Registos</div>
          <h1 className={styles.title}>Manutenções</h1>
        </div>
        <button className={styles.btnPrimary} onClick={() => setModal(true)}>
          + Registar Manutenção
        </button>
      </div>

      {loadingPage && <div className={styles.empty}>A carregar…</div>}

      {!loadingPage && (
        <ResourceTable
          columns={[ '#', 'Equipamento', 'Descrição', 'Data Realizada', 'Próxima Manutenção' ]}
          items={manutencoes}
          renderRow={renderRow}
          loading={false}
          emptyNode={(<div className={styles.empty}>Nenhuma manutenção registada.</div>)}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {/* Modal */}
      {modal && (
        <div className={styles.overlay} onClick={() => setModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Manutenção</div>
            <h2 className={styles.modalTitle}>Registar Manutenção</h2>

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
                <span className="label">Descrição *</span>
                <textarea className={styles.textarea} rows={3} value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  placeholder="O que foi feito…" />
              </label>
              <label className={styles.field}>
                <span className="label">Data Realizada *</span>
                <input type="datetime-local" className={styles.input} value={form.data_realizada}
                  onChange={e => setForm(f => ({ ...f, data_realizada: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span className="label">Próxima Manutenção (opcional)</span>
                <input type="datetime-local" className={styles.input} value={form.proxima_data}
                  onChange={e => setForm(f => ({ ...f, proxima_data: e.target.value }))} />
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
