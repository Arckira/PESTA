import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { api } from '../api/index.js'
import { Flame, Snowflake, Droplets } from 'lucide-react'
import StatusBadge from '../components/StatusBadge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Equipamentos.module.css'

const ESTADOS = [
  'Disponível',
  'Avariado',
  'Ocupado',
  'Em calibração',
  'Em manutenção',
]

const ESTADOS_UI = [
  'Disponível',
  'Ocupado',
  'Em calibração',
  'Em manutenção',
  'Avariado',
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
  temp_max: '',      
  temp_min: '',     
  humidade_max: '', 
  localizacao: '',
  estado_atual: 'Disponível',
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

  // Modal ficha técnica — abre ao clicar na linha
  const [fichaModal, setFichaModal] = useState(null)
  const [fichaEdit, setFichaEdit] = useState(false)
  const [fichaForm, setFichaForm] = useState({})
  const [savingFicha, setSavingFicha] = useState(false)

  const abrirFicha = (eq) => {
    setFichaModal(eq)
    setFichaEdit(false)
    setFichaForm({
      fabricante: eq.fabricante || '',
      modelo: eq.modelo || '',
      ano_fabrico: eq.ano_fabrico || '',
      potencia_kw: eq.potencia_kw || '',
      notas_tecnicas: eq.notas_tecnicas || '',
      range_temp: eq.range_temp || '',
      foto_url: eq.foto_url || '',
    })
  }

  const handleGuardarFicha = async () => {
    setSavingFicha(true)
    try {
      await api.atualizarEquipamento(fichaModal.id, {
        fabricante: fichaForm.fabricante || null,
        modelo: fichaForm.modelo || null,
        ano_fabrico: fichaForm.ano_fabrico ? parseInt(fichaForm.ano_fabrico, 10) : null,
        potencia_kw: fichaForm.potencia_kw ? parseFloat(fichaForm.potencia_kw) : null,
        notas_tecnicas: fichaForm.notas_tecnicas || null,
        range_temp: fichaForm.range_temp || null,
        foto_url: fichaForm.foto_url || null,
      })
      toast.success('Ficha técnica actualizada com sucesso.')
      setFichaEdit(false)
      carregar()
      setFichaModal((prev) => ({ ...prev, ...fichaForm }))
    } catch (e) {
      toast.error(e.message || 'Não foi possível guardar a ficha técnica.')
    } finally {
      setSavingFicha(false)
    }
  }

  const carregar = () => {
    setLoading(true)
    api.listarEquipamentos()
      .then(setEquipamentos)
      .catch((e) => {
        setErro(e.message)
        toast.error(`Falha ao carregar equipamentos: ${e.message}`)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  const filtrados = equipamentos.filter((eq) => {
    const matchTexto = eq.nome.toLowerCase().includes(filtro.toLowerCase())
      || eq.tipo.toLowerCase().includes(filtro.toLowerCase())
      || eq.localizacao.toLowerCase().includes(filtro.toLowerCase())
    const matchEstado = filtroEstado === 'Todos' || eq.estado_atual === filtroEstado
    return matchTexto && matchEstado
  })

  const codigoNormalizado = form.codigo_interno.trim().toLowerCase()
  const codigoDuplicado = codigoNormalizado
    ? equipamentos.some((eq) => (eq.codigo || '').trim().toLowerCase() === codigoNormalizado)
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
  const requiredDone = [
    fieldErrors.nome,
    fieldErrors.codigo_interno,
    fieldErrors.tipo,
    fieldErrors.localizacao,
  ].filter((v) => !v).length

  const updateField = (campo, valor) => {
    setForm((f) => ({ ...f, [campo]: valor }))
    if (formErro) setFormErro('')
  }

  const markTouched = (campo) => {
    setTouched((prev) => ({ ...prev, [campo]: true }))
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
        temp_max: form.temp_max ? parseFloat(form.temp_max) : null,
        temp_min: form.temp_min ? parseFloat(form.temp_min) : null,
        humidade_max: form.humidade_max ? parseFloat(form.humidade_max) : null,
        estado_atual: form.estado_atual,
      }

      await api.criarEquipamento(payload)
      toast.success(`Equipamento "${nome}" criado com sucesso.`)

      setModal(false)
      setForm(EMPTY_FORM)
      setTouched({})
      setSubmittedOnce(false)
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível criar o equipamento.')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    if (!filtrados || filtrados.length === 0) return

    try {
      const estadoSelecionado = filtroEstado === 'Todos' ? '' : filtroEstado
      const blob = await api.exportarEquipamentosPdf({
        filtro,
        estado: estadoSelecionado,
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `equipamentos-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PDF exportado com sucesso.')
    } catch (e) {
      toast.error(e.message || 'Não foi possível exportar o PDF.')
    }
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

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Pesquisar por nome, tipo ou localização..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
        >
          <option value="Todos">Todos os estados</option>
          {ESTADOS_UI.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button
          className={styles.btnExport}
          onClick={handleExport}
          disabled={filtrados.length === 0}
          type="button"
        >
          Exportar PDF
        </button>
      </div>

      {loading && <div className={styles.empty}>A carregar...</div>}
      {erro && <div className={styles.erro}>Erro ao carregar: {erro}</div>}

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
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((eq) => (
                  <tr
                    key={eq.id}
                    onClick={() => abrirFicha(eq)}
                    className={styles.trClickable}
                  >
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(eq.id).padStart(3, '0')}</td>
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
                        {deletingId === eq.id ? 'A eliminar...' : 'Eliminar'}
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

      {modal && createPortal(
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className="label">Equipamento</div>
              <h2 className={styles.modalTitle}>Novo Equipamento</h2>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className="label">Nome do Equipamento *</span>
                <input
                  className={`${styles.input} ${showFieldError('nome') ? styles.inputError : ''} ${showFieldValid('nome') ? styles.inputValid : ''}`}
                  value={form.nome}
                  onChange={(e) => updateField('nome', e.target.value)}
                  onBlur={() => markTouched('nome')}
                  placeholder="ex: Aralab - Fitoclima 300"
                />
                {showFieldError('nome') && <span className={styles.fieldHintError}>{fieldErrors.nome}</span>}
              </label>

              <label className={styles.field}>
                <span className="label">Código Interno *</span>
                <input
                  className={`${styles.input} ${showFieldError('codigo_interno') ? styles.inputError : ''} ${showFieldValid('codigo_interno') ? styles.inputValid : ''}`}
                  value={form.codigo_interno}
                  onChange={(e) => updateField('codigo_interno', e.target.value)}
                  onBlur={() => markTouched('codigo_interno')}
                  placeholder="ex: T1C-0015"
                />
                {showFieldError('codigo_interno') && <span className={styles.fieldHintError}>{fieldErrors.codigo_interno}</span>}
              </label>

              <label className={styles.field}>
                <span className="label">Tipo *</span>
                <select
                  className={`${styles.input} ${showFieldError('tipo') ? styles.inputError : ''} ${showFieldValid('tipo') ? styles.inputValid : ''}`}
                  value={form.tipo}
                  onChange={(e) => updateField('tipo', e.target.value)}
                  onBlur={() => markTouched('tipo')}
                >
                  <option value="">Selecionar tipo...</option>
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {showFieldError('tipo') && <span className={styles.fieldHintError}>{fieldErrors.tipo}</span>}
              </label>



<div className={styles.horizontalRow}>
  
  {/* Temperatura Máxima */}
  <div className={styles.horizontalItem}>
    <label className={styles.horizontalLabel}>
      <Flame size={14} color="#ef4444" /> Max
    </label>
    <div className={styles.horizontalInputWrap}>
      <input 
        type="number" 
        value={form.temp_max}
        onChange={(e) => updateField('temp_max', e.target.value)}
        placeholder="180"
      />
      <span className={styles.horizontalUnit}>°C</span>
    </div>
  </div>

  {/* Temperatura Mínima */}
  <div className={styles.horizontalItem}>
    <label className={styles.horizontalLabel}>
      <Snowflake size={14} color="#3b82f6" /> Min
    </label>
    <div className={styles.horizontalInputWrap}>
      <input 
        type="number" 
        value={form.temp_min}
        onChange={(e) => updateField('temp_min', e.target.value)}
        placeholder="-40"
      />
      <span className={styles.horizontalUnit}>°C</span>
    </div>
  </div>

  {/* Humidade */}
  <div className={styles.horizontalItem}>
    <label className={styles.horizontalLabel}>
      <Droplets size={14} color="#06b6d4" /> Hum
    </label>
    <div className={styles.horizontalInputWrap}>
      <input 
        type="number" 
        value={form.humidade_max}
        onChange={(e) => updateField('humidade_max', e.target.value)}
        placeholder="95"
      />
      <span className={styles.horizontalUnit}>%</span>
    </div>
  </div>

</div>

              <label className={styles.field}>
                <span className="label">Localização *</span>
                <input
                  className={`${styles.input} ${showFieldError('localizacao') ? styles.inputError : ''} ${showFieldValid('localizacao') ? styles.inputValid : ''}`}
                  value={form.localizacao}
                  onChange={(e) => updateField('localizacao', e.target.value)}
                  onBlur={() => markTouched('localizacao')}
                  placeholder="ex: Lab 2 - Piso 1"
                />
                {showFieldError('localizacao') && <span className={styles.fieldHintError}>{fieldErrors.localizacao}</span>}
              </label>

              <label className={styles.field}>
                <span className="label">Estado Inicial</span>
                <select
                  className={styles.input}
                  value={form.estado_atual}
                  onChange={(e) => updateField('estado_atual', e.target.value)}
                >
                  {ESTADOS_UI.map((e) => <option key={e} value={e}>{e}</option>)}
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
                {saving ? 'A guardar...' : 'Criar Equipamento'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {fichaModal && createPortal(
        <div className={styles.overlay} onClick={() => { setFichaModal(null); setFichaEdit(false) }}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Ficha Técnica</div>
                <h2 className={styles.modalTitle} style={{ marginBottom: 2 }}>{fichaModal.nome}</h2>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {fichaModal.codigo} · {fichaModal.tipo} · {fichaModal.localizacao}
                </div>
              </div>
              <StatusBadge estado={fichaModal.estado_atual} />
            </div>

            {fichaModal.foto_url && !fichaEdit && (
              <img
                src={fichaModal.foto_url}
                alt={fichaModal.nome}
                style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 16 }}
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}

            {!fichaEdit && (
              <div className={styles.fichaGrid}>
                <FichaItem label="Fabricante" value={fichaModal.fabricante} />
                <FichaItem label="Modelo" value={fichaModal.modelo} />
                <FichaItem label="Ano de Fabrico" value={fichaModal.ano_fabrico} />
                <FichaItem label="Potência (kW)" value={fichaModal.potencia_kw} />
                <FichaItem label="Range Temp. Cal." value={fichaModal.range_temp} />
                <FichaItem label="URL Foto" value={fichaModal.foto_url} />
                {fichaModal.notas_tecnicas && (
                  <div className={styles.fichaNotas}>
                    <div className="label" style={{ marginBottom: 6 }}>Notas Técnicas</div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {fichaModal.notas_tecnicas}
                    </p>
                  </div>
                )}
              </div>
            )}

            {fichaEdit && (
              <div className={styles.fields}>
                {[
                  ['fabricante', 'Fabricante', 'text', 'ex: Aralab'],
                  ['modelo', 'Modelo', 'text', 'ex: Fitoclima 300'],
                  ['ano_fabrico', 'Ano de Fabrico', 'number', 'ex: 2018'],
                  ['potencia_kw', 'Potência (kW)', 'number', 'ex: 2.5'],
                  ['range_temp', 'Range Temp. Calibração', 'text', 'ex: -40°C a +180°C'],
                  ['foto_url', 'URL da Foto', 'url', 'https://...'],
                ].map(([key, label, type, placeholder]) => (
                  <label key={key} className={styles.field}>
                    <span className="label">{label}</span>
                    <input
                      type={type}
                      className={styles.input}
                      value={fichaForm[key]}
                      placeholder={placeholder}
                      onChange={(e) => setFichaForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </label>
                ))}
                <label className={styles.field}>
                  <span className="label">Notas Técnicas</span>
                  <textarea
                    className={styles.input}
                    rows={3}
                    value={fichaForm.notas_tecnicas}
                    placeholder="Informações relevantes sobre o equipamento..."
                    onChange={(e) => setFichaForm((f) => ({ ...f, notas_tecnicas: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
                  />
                </label>
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setFichaModal(null); setFichaEdit(false) }}>
                Fechar
              </button>
              {!fichaEdit ? (
                <button className={styles.btnPrimary} onClick={() => setFichaEdit(true)}>
                  Editar Ficha
                </button>
              ) : (
                <button className={styles.btnPrimary} onClick={handleGuardarFicha} disabled={savingFicha}>
                  {savingFicha ? 'A guardar...' : 'Guardar'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function FichaItem({ label, value }) {
  if (!value) return null
  return (
    <div className="fichaItem">
      <div className="label" style={{ marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}
