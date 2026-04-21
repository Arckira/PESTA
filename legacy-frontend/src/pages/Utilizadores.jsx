import { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Utilizadores.module.css'

const EMPTY = { nome: '', numero_colaborador: '', departamento: '', role: 'user' }

export default function Utilizadores() {
  const toast = useToast()
  const { user, isLoading: authLoading, openAuthPrompt, openBootstrapPrompt, bootstrapAvailable } = useAuth()
  const [utilizadores, setUtilizadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [roleDrafts, setRoleDrafts] = useState({})
  const [rolePins, setRolePins] = useState({})
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
      toast.success('Utilizador eliminado com sucesso.')
      carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível eliminar o utilizador.')
    }
  }

  const handleRoleChange = async (id, role) => {
    const pin_atual = (rolePins[id] || '').trim()
    setRoleSavingId(id)
    try {
      if (/^\d{4}$/.test(pin_atual)) {
        // Legacy: admin can confirm with PIN (keeps existing secured flow)
        await api.adminAlterarRoleUtilizador(id, role, pin_atual)
      } else {
        // Inline update without PIN (authenticated admin)
        await api.atualizarUtilizador(id, { role })
      }
      toast.success('Permissões atualizadas com sucesso.')
      setRolePins((prev) => ({ ...prev, [id]: '' }))
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
      [ut.id]: { nome: ut.nome || '', numero_colaborador: ut.numero_colaborador || '', departamento: ut.departamento || '' }
    }))
  }

  const startCreateRow = () => {
    setEditingRows((prev) => ({ ...prev, new: { nome: '', numero_colaborador: '', departamento: '', role: 'user' } }))
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
        toast.success('Utilizador criado com sucesso.')
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
                <th>Role</th>
                <th>PIN admin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {utilizadores.map(ut => (
                <tr key={ut.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(ut.id).padStart(3,'0')}</td>
                  <td style={{ fontWeight: 500 }}>
                    {editingRows[ut.id] ? (
                      <input className={styles.input} value={editingRows[ut.id].nome} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], nome: e.target.value } }))} />
                    ) : (
                      ut.nome
                    )}
                  </td>
                  <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                    {editingRows[ut.id] ? (
                      <input className={styles.input} value={editingRows[ut.id].numero_colaborador} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], numero_colaborador: e.target.value } }))} />
                    ) : (
                      ut.numero_colaborador
                    )}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {editingRows[ut.id] ? (
                      <input className={styles.input} value={editingRows[ut.id].departamento} onChange={e => setEditingRows(prev => ({ ...prev, [ut.id]: { ...prev[ut.id], departamento: e.target.value } }))} />
                    ) : (
                      ut.departamento
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
                    <input
                      className={styles.input}
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="PIN admin"
                      value={rolePins[ut.id] || ''}
                      onChange={(e) => setRolePins((prev) => ({ ...prev, [ut.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    />
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