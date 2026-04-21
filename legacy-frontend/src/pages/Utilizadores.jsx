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
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [roleDrafts, setRoleDrafts] = useState({})
  const [rolePins, setRolePins] = useState({})
  const [roleSavingId, setRoleSavingId] = useState(null)

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

  const handleSubmit = async () => {
    if (!form.nome || !form.numero_colaborador || !form.departamento) {
      setFormErro('Todos os campos são obrigatórios.')
      toast.error('Preenche todos os campos obrigatórios.')
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      if (editingId) {
        await api.atualizarUtilizador(editingId, form)
        toast.success('Utilizador atualizado com sucesso.')
      } else {
        await api.criarUtilizador(form)
        toast.success('Utilizador criado com sucesso.')
      }
      setModal(false)
      setForm(EMPTY)
      setEditingId(null)
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar o utilizador.')
    } finally {
      setSaving(false)
    }
  }

  const handleEditar = (ut) => {
    setForm({ nome: ut.nome || '', numero_colaborador: ut.numero_colaborador || '', departamento: ut.departamento || '', role: ut.role || 'user' })
    setEditingId(ut.id)
    setModal(true)
  }

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
    if (!/^\d{4}$/.test(pin_atual)) {
      toast.error('Confirma o PIN do administrador com 4 dígitos.')
      return
    }

    setRoleSavingId(id)
    try {
      await api.adminAlterarRoleUtilizador(id, role, pin_atual)
      toast.success('Permissões atualizadas com sucesso.')
      setRolePins((prev) => ({ ...prev, [id]: '' }))
      carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível atualizar as permissões.')
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
        <button className={styles.btnPrimary} onClick={() => setModal(true)}>
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
                  <td style={{ fontWeight: 500 }}>{ut.nome}</td>
                  <td className="mono" style={{ color: 'var(--text-secondary)' }}>{ut.numero_colaborador}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{ut.departamento}</td>
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
                      <button className={styles.btnSecondary} onClick={() => handleEditar(ut)}>Editar</button>
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

      {modal && (
        <div className={styles.overlay} onClick={() => setModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>Utilizadores</div>
            <h2 className={styles.modalTitle}>Novo Utilizador</h2>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span className="label">Nome *</span>
                <input className={styles.input} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="ex: João Silva" />
              </label>
              <label className={styles.field}>
                <span className="label">Nº Colaborador *</span>
                <input className={styles.input} value={form.numero_colaborador} onChange={e => setForm(f => ({ ...f, numero_colaborador: e.target.value }))} placeholder="ex: YZ-1042" />
              </label>
              <label className={styles.field}>
                <span className="label">Departamento *</span>
                <input className={styles.input} value={form.departamento} onChange={e => setForm(f => ({ ...f, departamento: e.target.value }))} placeholder="ex: Testing Centre" />
              </label>
              <label className={styles.field}>
                <span className="label">Role *</span>
                <select className={styles.input} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </label>
            </div>
            {formErro && <div className={styles.formErro}>{formErro}</div>}
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setModal(false); setFormErro('') }}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
                {saving ? 'A guardar…' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}