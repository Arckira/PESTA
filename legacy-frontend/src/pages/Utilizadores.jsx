import { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Utilizadores.module.css'
import { corDoUtilizador } from '../utils/coresUtilizadores.js'

const EMPTY = { nome: '', numero_colaborador: '', departamento: '', role: 'user' }

export default function Utilizadores() {
  const toast = useToast()
  const { user, isLoading: authLoading, openAuthPrompt, openBootstrapPrompt, bootstrapAvailable } = useAuth()
  const [utilizadores, setUtilizadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [roleDrafts, setRoleDrafts] = useState({})
  const [roleSavingId, setRoleSavingId] = useState(null)
  const [editingRows, setEditingRows] = useState({})

  const carregar = () => {
    if (user?.role !== 'admin') {
      setLoading(false)
      return
    }
    setLoading(true)
    api.listarUtilizadores()
      .then((data) => {
        setUtilizadores(data)
        setRoleDrafts(Object.fromEntries(data.map((ut) => [ut.id, ut.role || 'user'])))
      })
      .catch((e) => toast.error(`Falha ao carregar utilizadores: ${e.message}`))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [user?.role])

  

  const handleEliminar = async (id, nome) => {
    if (!window.confirm(`Eliminar o utilizador "${nome}"?`)) return
    try {
      await api.eliminarUtilizador(id)
      // Remove imediatamente do estado local para evitar flash antes do re-fetch
      setUtilizadores((prev) => prev.filter((u) => u.id !== id))
      setEditingRows((prev) => { const c = { ...prev }; delete c[id]; return c })
      setRoleDrafts((prev) => { const c = { ...prev }; delete c[id]; return c })
      toast.success('Utilizador eliminado com sucesso.')
      carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível eliminar o utilizador.')
    }
  }

  const handleRoleChange = async (id, role) => {
    setRoleSavingId(id)
    try {
      await api.atualizarUtilizador(id, { role })
      toast.success('Permissões atualizadas com sucesso.')
      carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível atualizar as permissões.')
    } finally {
      setRoleSavingId(null)
    }
  }

  const startInlineEdit = (ut) => {
    setEditingRows((prev) => ({
      ...prev,
      [ut.id]: { nome: ut.nome || '', numero_colaborador: ut.numero_colaborador || '', departamento: ut.departamento || '', pin: '' }
    }))
  }

  const startCreateRow = () => {
    setEditingRows((prev) => {
      const copy = { ...prev }
      delete copy.new
      return { ...copy, new: { nome: '', numero_colaborador: '', departamento: '', role: 'user', pin: '' } }
    })
  }

  const cancelInlineEdit = (id) => {
    setEditingRows((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  const saveInlineEdit = async (id) => {
    const draft = editingRows[id]
    if (!draft) return
    if (!draft.nome || !draft.numero_colaborador || !draft.departamento) {
      toast.error('Todos os campos são obrigatórios.')
      return
    }
    try {
      setRoleSavingId(id)
      if (id === 'new') {
        await api.criarUtilizador(draft)
        toast.success('Utilizador criado. PIN inicial: 0000 (obrigatório alterar no primeiro login).')
      } else {
        await api.atualizarUtilizador(id, draft)
        toast.success('Utilizador atualizado com sucesso.')
      }
      setEditingRows((prev) => { const c = { ...prev }; delete c[id]; return c })
      carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível atualizar o utilizador.')
    } finally {
      setRoleSavingId(null)
    }
  }

  if (authLoading) {
    return (
      <div className="fade-up">
        <div className={styles.empty}>A verificar a sessão…</div>
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return (
      <div className="fade-up">
        <div className={styles.header}>
          <div>
            <div className="label">Gestão</div>
            <h1 className={styles.title}>Utilizadores</h1>
          </div>
        </div>

        <div className={styles.empty}>
          Esta aba é visível para todos. A gestão de utilizadores e permissões só está disponível para administradores.
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className={styles.btnPrimary} onClick={() => openAuthPrompt('login')}>
            Entrar como administrador
          </button>
          {bootstrapAvailable && (
            <button className={styles.btnSecondary} onClick={openBootstrapPrompt}>
              Criar primeiro administrador
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up">
        <div className={styles.header}>
        <div>
          <div className="label">Gestão</div>
          <h1 className={styles.title}>Utilizadores</h1>
        </div>
        <button className={styles.btnPrimary} onClick={() => startCreateRow()}>
          + Novo Utilizador
        </button>
      </div>

      <div className={styles.legendaCores}>
        <span className={styles.legendaIcone}>◉</span>
        A cor junto ao nome identifica as reservas de cada utilizador no calendário.
      </div>

      {loading && <div className={styles.empty}>A carregar…</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Nome</th>
                <th>Nº Colaborador</th>
                <th>Departamento</th>
                <th style={{ width: 100 }}>PIN</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editingRows.new && (
                <tr key="new">
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>—</td>
                  <td style={{ fontWeight: 500 }}>
                    <input autoComplete="off" className={styles.input} value={editingRows.new.nome} onChange={e => setEditingRows(prev => ({ ...prev, new: { ...prev.new, nome: e.target.value } }))} />
                  </td>
                  <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                    <input autoComplete="off" className={styles.input} value={editingRows.new.numero_colaborador} onChange={e => setEditingRows(prev => ({ ...prev, new: { ...prev.new, numero_colaborador: e.target.value } }))} />
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    <input autoComplete="off" className={styles.input} value={editingRows.new.departamento} onChange={e => setEditingRows(prev => ({ ...prev, new: { ...prev.new, departamento: e.target.value } }))} />
                  </td>
                  <td>
                    <input
                      type="password"
                      autoComplete="new-password"
                      className={styles.input}
                      placeholder="0000"
                      maxLength={4}
                      value={editingRows.new.pin || ''}
                      onChange={e => setEditingRows(prev => ({ ...prev, new: { ...prev.new, pin: e.target.value } }))}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <select className={styles.input} value={editingRows.new.role} onChange={e => setEditingRows(prev => ({ ...prev, new: { ...prev.new, role: e.target.value } }))}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className={styles.btnPrimary} onClick={() => saveInlineEdit('new')} disabled={roleSavingId === 'new'}>{roleSavingId === 'new' ? 'A guardar…' : 'Guardar'}</button>
                      <button className={styles.btnSecondary} onClick={() => cancelInlineEdit('new')}>Cancelar</button>
                    </div>
                  </td>
                </tr>
              )}
              {utilizadores.map(ut => (
                <tr key={ut.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(ut.id).padStart(3,'0')}</td>
                  <td style={{ fontWeight: 500 }}>
                      {editingRows[ut.id] ? (
                      <input autoComplete="off" className={styles.input} value={editingRows[ut.id].nome} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], nome: e.target.value } }))} />
                    ) : (
                      <span className={styles.nomeComCor}>
                        <span
                          className={styles.badgeIniciais}
                          style={{ backgroundColor: corDoUtilizador(ut.id) }}
                        >
                          {ut.nome ? ut.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : '?'}
                        </span>
                        {ut.nome}
                      </span>
                    )}
                  </td>
                  <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                      {editingRows[ut.id] ? (
                      <input autoComplete="off" className={styles.input} value={editingRows[ut.id].numero_colaborador} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], numero_colaborador: e.target.value } }))} />
                    ) : (
                      ut.numero_colaborador
                    )}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {editingRows[ut.id] ? (
                      <input autoComplete="off" className={styles.input} value={editingRows[ut.id].departamento} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], departamento: e.target.value } }))} />
                    ) : (
                      ut.departamento || ''
                    )}
                  </td>
                  <td>
                    {editingRows[ut.id] ? (
                      <input
                        type="password"
                        autoComplete="new-password"
                        className={styles.input}
                        placeholder="Novo PIN"
                        maxLength={4}
                        value={editingRows[ut.id].pin || ''}
                        onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], pin: e.target.value } }))}
                        style={{ width: 80 }}
                      />
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.15em' }}>••••</span>
                    )}
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={roleDrafts[ut.id] || ut.role || 'user'}
                      onChange={(e) => setRoleDrafts((prev) => ({ ...prev, [ut.id]: e.target.value }))}
                      disabled={roleSavingId === ut.id}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {!editingRows[ut.id] ? (
                        <>
                          <button className={styles.btnSecondary} onClick={() => startInlineEdit(ut)}>Editar</button>
                        </>
                      ) : (
                        <>
                          <button className={styles.btnPrimary} onClick={() => saveInlineEdit(ut.id)} disabled={roleSavingId === ut.id}>{roleSavingId === ut.id ? 'A guardar…' : 'Guardar'}</button>
                          <button className={styles.btnSecondary} onClick={() => cancelInlineEdit(ut.id)}>Cancelar</button>
                        </>
                      )}
                      <button
                        className={styles.btnPrimary}
                        onClick={() => handleRoleChange(ut.id, roleDrafts[ut.id] || ut.role || 'user')}
                        disabled={roleSavingId === ut.id}
                      >
                        {roleSavingId === ut.id ? 'A guardar…' : 'Guardar permissões'}
                      </button>
                      <button className={styles.btnEliminar} onClick={() => handleEliminar(ut.id, ut.nome)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {utilizadores.length === 0 && (
                <tr><td colSpan={7} className={styles.empty}>Nenhum utilizador registado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* modal removed: inline creation/editing used instead */}
    </div>
  )
}