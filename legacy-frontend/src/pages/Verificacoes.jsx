import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'
import styles from './Verificacoes.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import { useAuth } from '../contexts/AuthContext.jsx'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Verificacoes() {
  const { list: equipamentos, map: eqMap, loading: eqLoading } = useEquipamentos()
  const { user } = useAuth()

  const [verificacoes, setVerificacoes] = useState([])
  const [loading] = useState(false)

  // Modal de registo
  const [openModal, setOpenModal] = useState(false)
  const [formEq, setFormEq] = useState('')
  const [formData, setFormData] = useState(() => new Date().toISOString().slice(0, 10))
  const [formNotas, setFormNotas] = useState('')
  const [formPass, setFormPass] = useState(true)

  // Modal detalhe
  const [view, setView] = useState(null)

  const handleSubmit = useCallback((e) => {
    e?.preventDefault()
    const nova = {
      id: Date.now(),
      data: new Date(formData).toISOString(),
      equipamento_id: formEq || null,
      tecnico: user ? `${user.nome || user.username || user.id}` : '—',
      notas: formNotas,
      pass: Boolean(formPass),
    }
    setVerificacoes(prev => [nova, ...prev])
    setOpenModal(false)
    setFormEq('')
    setFormNotas('')
    setFormPass(true)
  }, [formData, formEq, formNotas, formPass, user])

  const renderRow = useCallback((v) => {
    const eq = eqMap[v.equipamento_id]
    return (
      <tr key={v.id} className={v.pass ? styles.rowPass : styles.rowFail}>
        <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmt(v.data)}</td>
        <td>{eq ? (<Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>) : '—'}</td>
        <td style={{ color: 'var(--text-secondary)' }}>{v.tecnico}</td>
        <td><StatusBadge variant={v.pass ? 'success' : 'danger'}>{v.pass ? 'Pass' : 'Fail'}</StatusBadge></td>
        <td>
          <button className={styles.btnSecondary} onClick={() => setView(v)}>Ver detalhes</button>
        </td>
      </tr>
    )
  }, [eqMap])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Histórico</div>
          <h1 className={styles.title}>Verificações Intermédias</h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.toolbar}>
            <button className={styles.btnPrimary} onClick={() => setOpenModal(true)}>Registar Verificação</button>
          </div>
        </div>
      </div>

      {!eqLoading && (
        <ResourceTable
          columns={[ 'Data', 'Equipamento', 'Técnico', 'Resultado', '' ]}
          items={verificacoes}
          renderRow={renderRow}
          loading={loading}
          emptyNode={(
            <EmptyState
              variant={verificacoes.length === 0 ? 'positive' : 'neutral'}
              icon="✓"
              title={verificacoes.length === 0 ? 'Ainda não existem verificações.' : 'Nenhuma verificação encontrada.'}
              subtitle={verificacoes.length === 0 ? 'Regista uma verificação para a ver aqui.' : 'Tente outro filtro.'}
              buttonText="Registar Verificação"
              onButtonClick={() => setOpenModal(true)}
            />
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {/* Modal Registo */}
      {openModal && (
        <div className={styles.overlay} onClick={() => setOpenModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Nova Verificação</div>
            <h2 className={styles.modalTitle}>Registar Verificação Intermédia</h2>

            <form onSubmit={handleSubmit}>
              <label className={styles.fieldLabel}>
                <span className="label">Equipamento</span>
                <select value={formEq} onChange={e => setFormEq(e.target.value)} className={styles.textarea}>
                  <option value="">Selecionar equipamento…</option>
                  {equipamentos.map(eq => (
                    <option key={eq.id} value={eq.id}>{eq.nome}</option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
                <span className="label">Data da Verificação</span>
                <input type="date" value={formData} onChange={e => setFormData(e.target.value)} className={styles.textarea} style={{ height: 40 }} />
              </label>

              <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
                <span className="label">Notas de Conformidade</span>
                <textarea rows={3} className={styles.textarea} placeholder="Notas…" value={formNotas} onChange={e => setFormNotas(e.target.value)} />
              </label>

              <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
                <span className="label">Resultado</span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name="passfail" checked={formPass === true} onChange={() => setFormPass(true)} /> Pass
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name="passfail" checked={formPass === false} onChange={() => setFormPass(false)} /> Fail
                  </label>
                </div>
              </label>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setOpenModal(false)}>Cancelar</button>
                <button type="submit" className={styles.btnPrimary}>Registar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ver detalhes */}
      {view && (
        <div className={styles.overlay} onClick={() => setView(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Verificação #{String(view.id).slice(-6)}</div>
            <h2 className={styles.modalTitle}>{view.pass ? 'Pass' : 'Fail'}</h2>
            <div className={styles.modalDesc}>
              <div><strong>Data:</strong> {fmt(view.data)}</div>
              <div><strong>Equipamento:</strong> {eqMap[view.equipamento_id]?.nome || '—'}</div>
              <div><strong>Técnico:</strong> {view.tecnico}</div>
              <div style={{ marginTop: 8 }}><strong>Notas:</strong><div style={{ marginTop: 6 }}>{view.notas || '—'}</div></div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setView(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
