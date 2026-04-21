import { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Utilizadores.module.css'

const EMPTY = { nome: '', numero_colaborador: '', departamento: '' }

export default function Utilizadores() {
  const toast = useToast()
  const [utilizadores, setUtilizadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')

  const carregar = () => {
    setLoading(true)
    api.listarUtilizadores()
      .then(setUtilizadores)
      .catch((e) => toast.error(`Falha ao carregar utilizadores: ${e.message}`))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const handleSubmit = async () => {
    if (!form.nome || !form.numero_colaborador || !form.departamento) {
      setFormErro('Todos os campos são obrigatórios.')
      toast.error('Preenche todos os campos obrigatórios.')
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      await api.criarUtilizador(form)
      toast.success('Utilizador criado com sucesso.')
      setModal(false)
      setForm(EMPTY)
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar o utilizador.')
    } finally {
      setSaving(false)
    }
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
                    <button className={styles.btnEliminar} onClick={() => handleEliminar(ut.id, ut.nome)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {utilizadores.length === 0 && (
                <tr><td colSpan={5} className={styles.empty}>Nenhum utilizador registado.</td></tr>
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