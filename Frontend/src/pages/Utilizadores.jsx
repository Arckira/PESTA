import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Utilizadores.module.css'
import { corDoUtilizador } from '../utils/coresUtilizadores.js'

export default function Utilizadores() {
  const toast = useToast()
  const { t } = useLanguage()
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
      .catch((e) => toast.error(`${t('utilizadores.errorLoad')}: ${e.message}`))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [user?.role])

  const handleEliminar = async (id, nome) => {
    if (!window.confirm(t('utilizadores_page.confirmarEliminar', { nome }))) return
    try {
      await api.eliminarUtilizador(id)
      setUtilizadores((prev) => prev.filter((u) => u.id !== id))
      setEditingRows((prev) => { const c = { ...prev }; delete c[id]; return c })
      setRoleDrafts((prev) => { const c = { ...prev }; delete c[id]; return c })
      toast.success(t('utilizadores_page.eliminadoSucesso'))
      carregar()
    } catch (e) {
      toast.error(e.message || t('utilizadores_page.erroEliminar'))
    }
  }

  const handleRoleChange = async (id, role) => {
    setRoleSavingId(id)
    try {
      await api.atualizarUtilizador(id, { role })
      toast.success(t('utilizadores_page.permissoesSucesso'))
      carregar()
    } catch (e) {
      toast.error(e.message || t('utilizadores_page.erroPermissoes'))
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

  const [isModalUtilizadorAberto, setIsModalUtilizadorAberto] = useState(false)

  const startCreateRow = () => {
    setEditingRows((prev) => {
      const copy = { ...prev }
      delete copy.new
      return { ...copy, new: { nome: '', numero_colaborador: '', departamento: '', role: 'user', pin: '' } }
    })
  }

  useEffect(() => {
    if (isModalUtilizadorAberto) {
      startCreateRow()
      setIsModalUtilizadorAberto(false)
    }
  }, [isModalUtilizadorAberto])

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
      toast.error(t('utilizadores_page.erroCamposObrigatorios'))
      return
    }
    try {
      setRoleSavingId(id)
      if (id === 'new') {
        await api.criarUtilizador(draft)
        toast.success(t('utilizadores_page.criadoSucesso'))
      } else {
        await api.atualizarUtilizador(id, draft)
        toast.success(t('utilizadores_page.atualizadoSucesso'))
      }
      setEditingRows((prev) => { const c = { ...prev }; delete c[id]; return c })
      carregar()
    } catch (e) {
      toast.error(e.message || t('utilizadores_page.erroAtualizar'))
    } finally {
      setRoleSavingId(null)
    }
  }

  if (authLoading) {
    return (
      <div className="fade-up">
        <div className={styles.empty}>{t('common.loading')}</div>
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return (
      <div className="fade-up">
        <PageHeader categoria="Administração" titulo="Utilizadores" />

        <div className={styles.empty}>
          {t('utilizadores_page.acessoNegado')}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className={styles.btnPrimary} onClick={() => openAuthPrompt('login')}>
            {t('utilizadores_page.entrarAdmin')}
          </button>
          {bootstrapAvailable && (
            <button className={styles.btnSecondary} onClick={openBootstrapPrompt}>
              {t('utilizadores_page.criarPrimeiroAdmin')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up">
      <PageHeader
        categoria="Administração"
        titulo="Utilizadores"
        actionText="Novo Utilizador"
        onActionClick={() => setIsModalUtilizadorAberto(true)}
      />

      <div className={styles.legendaCores}>
        <span className={styles.legendaIcone}>◉</span>
        {t('utilizadores_page.legendaCores')}
      </div>

      {loading && <div className={styles.empty}>{t('common.loading')}</div>}

      {!loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('common.name')}</th>
                <th>{t('utilizadores_page.nColaborador')}</th>
                <th>{t('utilizadores_page.departamento')}</th>
                <th style={{ width: 100 }}>{t('utilizadores.pin')}</th>
                <th>{t('utilizadores.role')}</th>
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
                      <button className={styles.btnPrimary} onClick={() => saveInlineEdit('new')} disabled={roleSavingId === 'new'}>{roleSavingId === 'new' ? t('common.loading') : t('common.save')}</button>
                      <button className={styles.btnSecondary} onClick={() => cancelInlineEdit('new')}>{t('common.cancel')}</button>
                    </div>
                  </td>
                </tr>
              )}
              {utilizadores.map(ut => (
                <tr key={ut.id}>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(ut.id).padStart(3,'00')}</td>
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
                        placeholder={t('utilizadores_page.novoPinPlaceholder')}
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
                          <button className={styles.btnSecondary} onClick={() => startInlineEdit(ut)}>{t('common.edit')}</button>
                        </>
                      ) : (
                        <>
                          <button className={styles.btnPrimary} onClick={() => saveInlineEdit(ut.id)} disabled={roleSavingId === ut.id}>{roleSavingId === ut.id ? t('common.loading') : t('common.save')}</button>
                          <button className={styles.btnSecondary} onClick={() => cancelInlineEdit(ut.id)}>{t('common.cancel')}</button>
                        </>
                      )}
                      <button
                        className={styles.btnPrimary}
                        onClick={() => handleRoleChange(ut.id, roleDrafts[ut.id] || ut.role || 'user')}
                        disabled={roleSavingId === ut.id}
                      >
                        {roleSavingId === ut.id ? t('common.loading') : t('utilizadores_page.guardarPermissoes')}
                      </button>
                      <button className={styles.btnEliminar} onClick={() => handleEliminar(ut.id, ut.nome)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {utilizadores.length === 0 && (
                <tr><td colSpan={7} className={styles.empty}>{t('common.noData')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
