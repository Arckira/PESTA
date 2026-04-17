import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge from '../components/StatusBadge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { downloadCsv } from '../utils/downloadCsv.js'
import styles from './Equipamentos.module.css'
import { createPortal } from 'react-dom';

const ESTADOS = [
  'Em funcionamento',
  'NOK',
  'Ocupado',
  'Em calibração',
  'Em manutenção',
]

const TIPOS = [
  'Câmara Climática',
  'Forno',
  'Câmara Choque Térmico',
  'Salina',
  'Outro',
]

const EMPTY_FORM = {
  nome: '',
  codigo_interno: '',
  tipo: '',
  range_calibracao: '',
  localizacao: '',
  estado_atual: 'Em funcionamento',
  
}

export default function Equipamentos() {
  const toast = useToast()
  const [equipamentos, setEquipamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('Todos')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [formErro, setFormErro] = useState('')
  const [touched, setTouched] = useState({})
  const [submittedOnce, setSubmittedOnce] = useState(false)

  const carregar = () => {
    setLoading(true)
    api.listarEquipamentos()
      .then(setEquipamentos)
      .catch(e => {
        setErro(e.message)
        toast.error(`Falha ao carregar equipamentos: ${e.message}`)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const filtrados = equipamentos.filter(eq => {
    const matchTexto = eq.nome.toLowerCase().includes(filtro.toLowerCase()) ||
                       eq.tipo.toLowerCase().includes(filtro.toLowerCase()) ||
                       eq.localizacao.toLowerCase().includes(filtro.toLowerCase())
    const matchEstado = filtroEstado === 'Todos' || eq.estado_atual === filtroEstado
    return matchTexto && matchEstado
  })

  const codigoNormalizado = form.codigo_interno.trim().toLowerCase()
  const codigoDuplicado = codigoNormalizado
    ? equipamentos.some(eq => (eq.codigo || '').trim().toLowerCase() === codigoNormalizado)
    : false

  const fieldErrors = {
    nome: form.nome.trim() ? '' : 'Nome obrigatório.',
    codigo_interno: !form.codigo_interno.trim()
      ? 'Código obrigatório.'
      : (codigoDuplicado ? 'Este código já existe.' : ''),
    tipo: form.tipo ? '' : 'Tipo obrigatório.',
    localizacao: form.localizacao.trim() ? '' : 'Localização obrigatória.',
  }

  const hasErrors = Object.values(fieldErrors).some(Boolean)
  const requiredTotal = 4
  const requiredDone = [fieldErrors.nome, fieldErrors.codigo_interno, fieldErrors.tipo, fieldErrors.localizacao]
    .filter(v => !v).length

  const updateField = (campo, valor) => {
    setForm(f => ({ ...f, [campo]: valor }))
    if (formErro) setFormErro('')
  }

  const markTouched = (campo) => {
    setTouched(prev => ({ ...prev, [campo]: true }))
  }

  const showFieldError = (campo) => (submittedOnce || touched[campo]) && !!fieldErrors[campo]
  const showFieldValid = (campo) => (submittedOnce || touched[campo]) && !fieldErrors[campo]

  const openModal = () => {
    setForm(EMPTY_FORM)
    setFormErro('')
    setTouched({})
    setSubmittedOnce(false)
    setModal(true)
  }

  const closeModal = () => {
    setModal(false)
    setFormErro('')
    setTouched({})
    setSubmittedOnce(false)
  }

  const handleSubmit = async () => {
    setSubmittedOnce(true)

    const nome = form.nome.trim()
    const codigo = form.codigo_interno.trim()
    const localizacao = form.localizacao.trim()

    if (hasErrors) {
      setFormErro('Confirma os campos obrigatórios assinalados antes de criar o equipamento.')
      toast.error('Existem campos obrigatórios por corrigir.')
      return
    }
    setSaving(true)
    setFormErro('')
    
    try {
      const payload = {
        nome,
        codigo,
        tipo: form.tipo,
        localizacao,
        range_temp: form.range_calibracao?.trim() || null,
        estado_atual: form.estado_atual,
      }

      await api.criarEquipamento(payload)
      toast.success(`Equipamento "${nome}" criado com sucesso.`)
      
      setModal(false)
      setForm(EMPTY_FORM)
      setTouched({})
      setSubmittedOnce(false)
      carregar() // Atualiza a tabela automaticamente!
      
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar o equipamento.')
    } finally {
      setSaving(false)
    }
  }

  const fmtCsv = (dt) => {
    if (!dt) return ''
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return ''
    // ISO-like para excel (sem timezone)
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }

  const handleExport = () => {
    if (!filtrados || filtrados.length === 0) return

    const filename = `equipamentos-${new Date().toISOString().slice(0, 10)}.csv`
    const rows = filtrados.map(eq => ({
      id: String(eq.id).padStart(3, '0'),
      nome: eq.nome,
      tipo: eq.tipo,
      localizacao: eq.localizacao,
      estado: eq.estado_atual,
      criado_em: fmtCsv(eq.criado_em),
    }))

    downloadCsv({
      filename,
      rows,
      delimiter: ';',
      columns: [
        { key: 'id', header: '#' },
        { key: 'nome', header: 'Nome' },
        { key: 'tipo', header: 'Tipo' },
        { key: 'localizacao', header: 'Localização' },
        { key: 'estado', header: 'Estado' },
        { key: 'criado_em', header: 'Registado em' },
      ],
    })
  }

  const handleEliminar = async (eq) => {
    const confirmar = window.confirm(`Eliminar o equipamento "${eq.nome}"?`)
    if (!confirmar) return

    setDeletingId(eq.id)
    try {
      await api.eliminarEquipamento(eq.id)
      setEquipamentos((prev) => prev.filter((item) => item.id !== eq.id))
      toast.success(`Equipamento "${eq.nome}" eliminado com sucesso.`)
    } catch (e) {
      toast.error(e.message || 'Não foi possível eliminar o equipamento.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Gestão</div>
          <h1 className={styles.title}>Equipamentos</h1>
        </div>
        <button className={styles.btnPrimary} onClick={openModal}>
          + Novo Equipamento
        </button>
      </div>

      {/* Filtros */}
      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Pesquisar por nome, tipo ou localização…"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
        >
          <option value="Todos">Todos os estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <button
          className={styles.btnExport}
          onClick={handleExport}
          disabled={filtrados.length === 0}
          type="button"
        >
          Exportar CSV
        </button>
      </div>

      {/* Tabela */}
      {loading && <div className={styles.empty}>A carregar…</div>}
      {erro    && <div className={styles.erro}>Erro ao carregar: {erro}</div>}

      {!loading && !erro && (
        <>
          <div className={styles.count} style={{ marginBottom: 12 }}>
            <span className="mono">{filtrados.length}</span>
            <span style={{ color: 'var(--text-dim)' }}> equipamento{filtrados.length !== 1 ? 's' : ''}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Localização</th>
                  <th>Estado</th>
                  <th>Registado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(eq => (
                  <tr key={eq.id}>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(eq.id).padStart(3,'0')}</td>
                    <td style={{ fontWeight: 500 }}>{eq.nome}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{eq.localizacao}</td>
                    <td><StatusBadge estado={eq.estado_atual} /></td>
                    <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                      {new Date(eq.criado_em).toLocaleDateString('pt-PT')}
                    </td>
                    <td className={styles.rowActions}>
                      <Link to={`/equipamentos/${eq.id}`} className={styles.detailLink}>
                        Ver →
                      </Link>
                      <button
                        type="button"
                        className={styles.btnDelete}
                        onClick={() => handleEliminar(eq)}
                        disabled={deletingId === eq.id}
                      >
                        {deletingId === eq.id ? 'A eliminar…' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.emptyCell}>
                      <EmptyState
                        icon="◎"
                        variant="neutral"
                        title={
                          equipamentos.length === 0
                            ? 'Ainda não existem equipamentos registados.'
                            : 'Nenhum resultado para os filtros atuais.'
                        }
                        subtitle={
                          equipamentos.length === 0
                            ? 'Comece por adicionar o primeiro equipamento.'
                            : 'Tente outra pesquisa ou limpe os filtros.'
                        }
                        buttonText={
                          equipamentos.length === 0 ? '+ Adicionar Equipamento' : 'Limpar filtros'
                        }
                        onButtonClick={() => {
                          if (equipamentos.length === 0) setModal(true)
                          else {
                            setFiltro('')
                            setFiltroEstado('Todos')
                          }
                        }}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal Criar (Teletransportada com Portal) */}
      {modal && createPortal(
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className="label">Equipamento</div>
              <h2 className={styles.modalTitle}>Novo Equipamento</h2>
            </div>

            <div className={styles.fields}>
              
              {/* 1. NOME */}
              <label className={styles.field}>
                <span className="label">Nome do Equipamento *</span>
                <input
                  className={`${styles.input} ${showFieldError('nome') ? styles.inputError : ''} ${showFieldValid('nome') ? styles.inputValid : ''}`}
                  value={form.nome}
                  onChange={e => updateField('nome', e.target.value)}
                  onBlur={() => markTouched('nome')}
                  placeholder="ex: Aralab - Fitoclima 300"
                />
                {showFieldError('nome') && <span className={styles.fieldHintError}>{fieldErrors.nome}</span>}
              </label>

              {/* 2. CÓDIGO INTERNO */}
              <label className={styles.field}>
                <span className="label">Código Interno *</span>
                <input
                  className={`${styles.input} ${showFieldError('codigo_interno') ? styles.inputError : ''} ${showFieldValid('codigo_interno') ? styles.inputValid : ''}`}
                  value={form.codigo_interno}
                  onChange={e => updateField('codigo_interno', e.target.value)}
                  onBlur={() => markTouched('codigo_interno')}
                  placeholder="ex: T1C-0015"
                />
                {showFieldError('codigo_interno') && <span className={styles.fieldHintError}>{fieldErrors.codigo_interno}</span>}
              </label>

              {/* 3. TIPO */}
              <label className={styles.field}>
                <span className="label">Tipo *</span>
                <select
                  className={`${styles.input} ${showFieldError('tipo') ? styles.inputError : ''} ${showFieldValid('tipo') ? styles.inputValid : ''}`}
                  value={form.tipo}
                  onChange={e => updateField('tipo', e.target.value)}
                  onBlur={() => markTouched('tipo')}
                >
                  <option value="">Selecionar tipo…</option>
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {showFieldError('tipo') && <span className={styles.fieldHintError}>{fieldErrors.tipo}</span>}
              </label>

              {/* 4. RANGE DE CALIBRAÇÃO */}
              <label className={styles.field}>
                <span className="label">Range de Calibração</span>
                <input
                  className={styles.input}
                  value={form.range_calibracao}
                  onChange={e => updateField('range_calibracao', e.target.value)}
                  placeholder="ex: +125 ºC / -40 ºC"
                />
              </label>

              {/* 5. LOCALIZAÇÃO */}
              <label className={styles.field}>
                <span className="label">Localização *</span>
                <input
                  className={`${styles.input} ${showFieldError('localizacao') ? styles.inputError : ''} ${showFieldValid('localizacao') ? styles.inputValid : ''}`}
                  value={form.localizacao}
                  onChange={e => updateField('localizacao', e.target.value)}
                  onBlur={() => markTouched('localizacao')}
                  placeholder="ex: Lab 2 - Piso 1"
                />
                {showFieldError('localizacao') && <span className={styles.fieldHintError}>{fieldErrors.localizacao}</span>}
              </label>

              {/* 6. ESTADO INICIAL */}
              <label className={styles.field}>
                <span className="label">Estado Inicial</span>
                <select
                  className={styles.input}
                  value={form.estado_atual}
                  onChange={e => updateField('estado_atual', e.target.value)}
                >
                  {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
              
            </div>

            <div className={styles.requiredProgress}>
              Campos obrigatórios preenchidos: <strong>{requiredDone}/{requiredTotal}</strong>
            </div>

            {formErro && <div className={styles.formErro}>{formErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={closeModal}>
                Cancelar
              </button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving || hasErrors}>
                {saving ? 'A guardar…' : 'Criar Equipamento'}
              </button>
            </div>
          </div>
        </div>,
        document.body // <-- O destino do Portal!
      )}
    </div>
  )
}
