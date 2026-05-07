import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge, { normalizarEstadoEquipamento } from '../components/StatusBadge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Equipamentos.module.css'

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

// Porque: formulário de criação simplificado para registo rápido.
// Separámos os dados logísticos (nome, código, localização, tipo)
// dos dados técnicos (dimensões, eléctricos, humidade) para reduzir
// o esforço inicial de registo e acelerar a entrada de novos equipamentos.
const EMPTY_CREATE_FORM = {
  nome: '',
  codigo_interno: '',
  tipo: '',
  localizacao: '',
  // Apenas o range de temperatura é pedido no registo inicial
  temp_min: '',
  temp_max: '',
  // Humidade opcional no registo inicial (reintroduzido a pedido)
  humidade_max: '',
  estado_atual: 'Disponível',
}

// O formulário de edição aqui é intencionalmente reduzido: alteração
// rápida de dados logísticos sem tocar nos dados técnicos.
const EMPTY_EDIT_FORM = {
  nome: '',
  tipo: '',
  localizacao: '',
  estado_atual: 'Disponível',
  descricao_avaria: '',
}

// No processo de criação pedimos apenas o intervalo de temperatura.
const CREATE_NUMERIC_FIELDS = [
  { key: 'temp_max', label: 'Temperatura máxima', allowNegative: true },
  { key: 'temp_min', label: 'Temperatura mínima', allowNegative: true },
  { key: 'humidade_max', label: 'Humidade máxima', allowNegative: false },
]

// A edição rápida não altera os dados técnicos — isso é feito na Ficha Técnica
const EDIT_NUMERIC_FIELDS = []

const MANUAL_SECTIONS = [
  {
    title: 'Dimensões Úteis',
    fields: [
      { key: 'largura_mm', label: 'Largura', unit: 'mm' },
      { key: 'altura_mm', label: 'Altura', unit: 'mm' },
      { key: 'profundidade_mm', label: 'Profundidade', unit: 'mm' },
      { key: 'volume_l', label: 'Volume', unit: 'L' },
    ],
  },
  {
    title: 'Especificações Elétricas',
    fields: [
      { key: 'voltagem_v', label: 'Voltagem', unit: 'V' },
      { key: 'corrente_a', label: 'Corrente', unit: 'A' },
      { key: 'potencia_kw', label: 'Potência', unit: 'kW' },
      { key: 'ligacao_eletrica', label: 'Ligação' },
    ],
  },
]

// Campos técnicos agrupados para edição na Ficha Técnica (manual)
const MANUAL_EDIT_FIELDS = [
  { key: 'humidade_max', label: 'Humidade máxima', unit: '%' },
  { key: 'largura_mm', label: 'Largura útil', unit: 'mm' },
  { key: 'altura_mm', label: 'Altura útil', unit: 'mm' },
  { key: 'profundidade_mm', label: 'Profundidade útil', unit: 'mm' },
  { key: 'volume_l', label: 'Volume útil', unit: 'L' },
  { key: 'voltagem_v', label: 'Voltagem', unit: 'V' },
  { key: 'corrente_a', label: 'Corrente', unit: 'A' },
  { key: 'potencia_kw', label: 'Potência', unit: 'kW' },
]

function formatValue(value, unit = '') {
  if (value === null || value === undefined || value === '') return '—'
  return unit ? `${value} ${unit}` : String(value)
}

function parseOptionalNumber(rawValue, label, { allowNegative = true } = {}) {
  const text = String(rawValue ?? '').trim()
  if (!text) return null
  const normalizado = Number(text.replace(',', '.'))
  if (Number.isNaN(normalizado)) {
    throw new Error(`O campo "${label}" tem de ser numérico.`)
  }
  if (!allowNegative && normalizado < 0) {
    throw new Error(`O campo "${label}" não pode ser negativo.`)
  }
  return normalizado
}

function sanitizeText(rawValue) {
  const text = String(rawValue ?? '').trim()
  return text || null
}

function buildNumericPayload(form, fields) {
  return fields.reduce((payload, field) => {
    payload[field.key] = parseOptionalNumber(form[field.key], field.label, {
      allowNegative: field.allowNegative,
    })
    return payload
  }, {})
}

function getCreateErrors(form, equipamentos) {
  const nome = form.nome.trim()
  const codigo = form.codigo_interno.trim()
  const localizacao = form.localizacao.trim()
  const codigoNormalizado = codigo.toLowerCase()

  return {
    nome: nome ? '' : 'Nome obrigatório.',
    codigo_interno: !codigo
      ? 'Código obrigatório.'
      : (equipamentos.some((eq) => String(eq.codigo || '').trim().toLowerCase() === codigoNormalizado)
        ? 'Este código já existe.'
        : ''),
    tipo: form.tipo ? '' : 'Tipo obrigatório.',
    localizacao: localizacao ? '' : 'Localização obrigatória.',
  }
}

function getEditErrors(form) {
  return {
    nome: form.nome.trim() ? '' : 'Nome obrigatório.',
    tipo: form.tipo ? '' : 'Tipo obrigatório.',
    localizacao: form.localizacao.trim() ? '' : 'Localização obrigatória.',
  }
}

function createEditForm(equipamento) {
  return {
    nome: equipamento.nome || '',
    tipo: equipamento.tipo || '',
    localizacao: equipamento.localizacao || '',
    estado_atual: equipamento.estado_atual || 'Disponível',
    descricao_avaria: '',
  }
}

export default function Equipamentos() {
  const toast = useToast()
  const navigate = useNavigate()
  const [equipamentos, setEquipamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('Todos')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM)
  const [createSaving, setCreateSaving] = useState(false)
  const [createErro, setCreateErro] = useState('')
  const [createTouched, setCreateTouched] = useState({})
  const [createSubmittedOnce, setCreateSubmittedOnce] = useState(false)

  const [manualEquipamento, setManualEquipamento] = useState(null)
  const [manualForm, setManualForm] = useState(null)
  const [manualEdit, setManualEdit] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [editEquipamento, setEditEquipamento] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editErro, setEditErro] = useState('')
  const [editTouched, setEditTouched] = useState({})
  const [editSubmittedOnce, setEditSubmittedOnce] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const carregar = async () => {
    setLoading(true)
    try {
      const data = await api.listarEquipamentos()
      setEquipamentos(data)
      setErro(null)
    } catch (e) {
      setErro(e.message)
      toast.error(`Falha ao carregar equipamentos: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const filtrados = equipamentos.filter((eq) => {
    const texto = `${eq.nome || ''} ${eq.tipo || ''} ${eq.localizacao || ''}`.toLowerCase()
    const matchTexto = texto.includes(filtro.toLowerCase())
    const matchEstado = filtroEstado === 'Todos' || normalizarEstadoEquipamento(eq.estado_atual) === filtroEstado
    return matchTexto && matchEstado
  })

  const createFieldErrors = getCreateErrors(createForm, equipamentos)
  const editFieldErrors = getEditErrors(editForm)

  const createHasErrors = Object.values(createFieldErrors).some(Boolean)
  const editHasErrors = Object.values(editFieldErrors).some(Boolean)

  const createRequiredDone = [
    createFieldErrors.nome,
    createFieldErrors.codigo_interno,
    createFieldErrors.tipo,
    createFieldErrors.localizacao,
  ].filter((v) => !v).length

  const createRequiredTotal = 4

  const openCreate = () => {
    setCreateForm(EMPTY_CREATE_FORM)
    setCreateErro('')
    setCreateTouched({})
    setCreateSubmittedOnce(false)
    setCreateOpen(true)
  }

  const closeCreate = () => {
    setCreateOpen(false)
    setCreateErro('')
    setCreateTouched({})
    setCreateSubmittedOnce(false)
  }

  const openManual = (eq) => {
    setManualEquipamento(eq)
    setManualForm({
      humidade_max: eq.humidade_max ?? '',
      largura_mm: eq.largura_mm ?? '',
      altura_mm: eq.altura_mm ?? '',
      profundidade_mm: eq.profundidade_mm ?? '',
      volume_l: eq.volume_l ?? '',
      voltagem_v: eq.voltagem_v ?? '',
      corrente_a: eq.corrente_a ?? '',
      potencia_kw: eq.potencia_kw ?? '',
      ligacao_eletrica: eq.ligacao_eletrica || '',
    })
    setManualEdit(false)
  }

  const closeManual = () => {
    setManualEquipamento(null)
    setManualForm(null)
    setManualEdit(false)
  }

  const openEdit = (eq) => {
    setEditEquipamento(eq)
    setEditForm(createEditForm(eq))
    setEditErro('')
    setEditTouched({})
    setEditSubmittedOnce(false)
  }

  const closeEdit = () => {
    setEditEquipamento(null)
    setEditErro('')
    setEditTouched({})
    setEditSubmittedOnce(false)
  }

  const updateCreateField = (campo, valor) => {
    setCreateForm((prev) => ({ ...prev, [campo]: valor }))
    if (createErro) setCreateErro('')
  }

  const updateManualField = (campo, valor) => {
    setManualForm((prev) => ({ ...prev, [campo]: valor }))
  }

  const updateEditField = (campo, valor) => {
    setEditForm((prev) => ({ ...prev, [campo]: valor }))
    if (editErro) setEditErro('')
  }

  const markCreateTouched = (campo) => {
    setCreateTouched((prev) => ({ ...prev, [campo]: true }))
  }

  const markEditTouched = (campo) => {
    setEditTouched((prev) => ({ ...prev, [campo]: true }))
  }

  const showCreateError = (campo) => (createSubmittedOnce || createTouched[campo]) && !!createFieldErrors[campo]
  const showCreateValid = (campo) => (createSubmittedOnce || createTouched[campo]) && !createFieldErrors[campo]
  const showEditError = (campo) => (editSubmittedOnce || editTouched[campo]) && !!editFieldErrors[campo]
  const showEditValid = (campo) => (editSubmittedOnce || editTouched[campo]) && !editFieldErrors[campo]

  const handleSubmit = async () => {
    setCreateSubmittedOnce(true)
    if (createHasErrors) {
      setCreateErro('Confirma os campos obrigatórios assinalados antes de criar o equipamento.')
      toast.error('Existem campos obrigatórios por corrigir.')
      return
    }

    setCreateSaving(true)
    setCreateErro('')

    try {
      const payload = {
        nome: createForm.nome.trim(),
        codigo: createForm.codigo_interno.trim(),
        tipo: createForm.tipo,
        localizacao: createForm.localizacao.trim(),
        ...buildNumericPayload(createForm, CREATE_NUMERIC_FIELDS),
        estado_atual: normalizarEstadoEquipamento(createForm.estado_atual),
      }

      await api.criarEquipamento(payload)
      toast.success(`Equipamento "${payload.nome}" criado com sucesso.`)
      closeCreate()
      await carregar()
    } catch (e) {
      setCreateErro(e.message)
      toast.error(e.message || 'Não foi possível criar o equipamento.')
    } finally {
      setCreateSaving(false)
    }
  }

  const handleEditar = async () => {
    if (!editEquipamento) return

    setEditSubmittedOnce(true)
    if (editHasErrors) {
      setEditErro('Confirma os campos obrigatórios assinalados antes de guardar a edição.')
      toast.error('Existem campos obrigatórios por corrigir.')
      return
    }

    setEditSaving(true)
    setEditErro('')

    try {
      // Construir payload parcial — inclui alteração de estado e possível
      // descrição de avaria se o utilizador marcar como 'Avariado'.
      const payload = {
        nome: editForm.nome.trim(),
        tipo: editForm.tipo,
        localizacao: editForm.localizacao.trim(),
      }

      // Se o estado foi alterado, envia-o para o servidor juntamente
      // com a descrição opcional da avaria (campo opcional no modal).
      if (editForm.estado_atual && editForm.estado_atual !== editEquipamento.estado_atual) {
        payload.estado_atual = editForm.estado_atual
        if (editForm.descricao_avaria && editForm.descricao_avaria.trim()) {
          payload.descricao_avaria = editForm.descricao_avaria.trim()
        }
      }

      const atualizado = await api.atualizarEquipamento(editEquipamento.id, payload)
      setEquipamentos((prev) => prev.map((item) => (item.id === atualizado.id ? atualizado : item)))
      setManualEquipamento((prev) => (prev && prev.id === atualizado.id ? atualizado : prev))
      toast.success(`Equipamento "${atualizado.nome}" actualizado com sucesso.`)
      closeEdit()
    } catch (e) {
      setEditErro(e.message)
      toast.error(e.message || 'Não foi possível actualizar o equipamento.')
    } finally {
      setEditSaving(false)
    }
  }

  // Guarda os campos técnicos da Ficha Técnica diretamente do modal Manual.
  const saveManual = async () => {
    if (!manualEquipamento || !manualForm) return
    setManualSaving(true)
    try {
      const payload = {
        ...buildNumericPayload(manualForm, MANUAL_EDIT_FIELDS.map(f => ({ key: f.key, label: f.label, allowNegative: true }))),
        ligacao_eletrica: sanitizeText(manualForm.ligacao_eletrica),
      }
      const atualizado = await api.atualizarEquipamento(manualEquipamento.id, payload)
      setEquipamentos((prev) => prev.map((item) => (item.id === atualizado.id ? atualizado : item)))
      setManualEquipamento(atualizado)
      toast.success('Ficha Técnica actualizada com sucesso.')
      setManualEdit(false)
    } catch (e) {
      toast.error(e.message || 'Não foi possível actualizar a Ficha Técnica.')
    } finally {
      setManualSaving(false)
    }
  }

  const handleEliminar = async (eq) => {
    const confirmar = window.confirm(`Eliminar o equipamento "${eq.nome}"?`)
    if (!confirmar) return

    setDeletingId(eq.id)
    try {
      await api.eliminarEquipamento(eq.id)
      setEquipamentos((prev) => prev.filter((item) => item.id !== eq.id))
      if (manualEquipamento?.id === eq.id) closeManual()
      if (editEquipamento?.id === eq.id) closeEdit()
      toast.success(`Equipamento "${eq.nome}" eliminado com sucesso.`)
    } catch (e) {
      toast.error(e.message || 'Não foi possível eliminar o equipamento.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleExport = async () => {
    if (!filtrados.length) return

    try {
      const estado = filtroEstado === 'Todos' ? '' : normalizarEstadoEquipamento(filtroEstado)
      const blob = await api.exportarEquipamentosPdf({ filtro, estado })
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

  const renderRow = (eq) => (
    <tr key={eq.id}>
      <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(eq.id).padStart(3, '0')}</td>
      <td>
        <strong className={styles.rowName}>{eq.nome}</strong>
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>
      <td style={{ color: 'var(--text-secondary)' }}>{eq.localizacao}</td>
      <td><StatusBadge estado={eq.estado_atual} /></td>
      <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
        {eq.criado_em ? new Date(eq.criado_em).toLocaleDateString('pt-PT') : '—'}
      </td>
      <td>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.btnDetail}
            onClick={() => navigate(`/equipamentos/${eq.id}`)}
          >
            Ver Detalhe
          </button>
          <button
            type="button"
            className={styles.btnManual}
            onClick={() => openManual(eq)}
          >
            Ver Manual
          </button>
          <button
            type="button"
            className={styles.btnEdit}
            onClick={() => openEdit(eq)}
          >
            Editar
          </button>
          <button
            type="button"
            className={styles.btnDelete}
            onClick={() => handleEliminar(eq)}
            disabled={deletingId === eq.id}
          >
            {deletingId === eq.id ? 'A eliminar...' : 'Eliminar'}
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Gestão</div>
          <h1 className={styles.title}>Equipamentos</h1>
        </div>
        <button className={styles.btnPrimary} onClick={openCreate} type="button">
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
          {ESTADOS_UI.map((estado) => <option key={estado} value={estado}>{estado}</option>)}
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
                {filtrados.map(renderRow)}
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
                          if (equipamentos.length === 0) openCreate()
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

      {createOpen && createPortal(
        <div className={styles.overlay} onClick={closeCreate}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className="label">Equipamento</div>
              <h2 className={styles.modalTitle}>Novo Equipamento</h2>
            </div>

            <div className={styles.fields}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className="label">Nome do Equipamento *</span>
                  <input
                    className={`${styles.input} ${showCreateError('nome') ? styles.inputError : ''} ${showCreateValid('nome') ? styles.inputValid : ''}`}
                    value={createForm.nome}
                    onChange={(e) => updateCreateField('nome', e.target.value)}
                    onBlur={() => markCreateTouched('nome')}
                    placeholder="ex: Aralab - Fitoclima 300"
                  />
                  {showCreateError('nome') && <span className={styles.fieldHintError}>{createFieldErrors.nome}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">Código Interno *</span>
                  <input
                    className={`${styles.input} ${showCreateError('codigo_interno') ? styles.inputError : ''} ${showCreateValid('codigo_interno') ? styles.inputValid : ''}`}
                    value={createForm.codigo_interno}
                    onChange={(e) => updateCreateField('codigo_interno', e.target.value)}
                    onBlur={() => markCreateTouched('codigo_interno')}
                    placeholder="ex: T1C-0015"
                  />
                  {showCreateError('codigo_interno') && <span className={styles.fieldHintError}>{createFieldErrors.codigo_interno}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">Tipo *</span>
                  <select
                    className={`${styles.input} ${showCreateError('tipo') ? styles.inputError : ''} ${showCreateValid('tipo') ? styles.inputValid : ''}`}
                    value={createForm.tipo}
                    onChange={(e) => updateCreateField('tipo', e.target.value)}
                    onBlur={() => markCreateTouched('tipo')}
                  >
                    <option value="">Selecionar tipo...</option>
                    {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                  </select>
                  {showCreateError('tipo') && <span className={styles.fieldHintError}>{createFieldErrors.tipo}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">Localização *</span>
                  <input
                    className={`${styles.input} ${showCreateError('localizacao') ? styles.inputError : ''} ${showCreateValid('localizacao') ? styles.inputValid : ''}`}
                    value={createForm.localizacao}
                    onChange={(e) => updateCreateField('localizacao', e.target.value)}
                    onBlur={() => markCreateTouched('localizacao')}
                    placeholder="ex: Laboratório 2 - Piso 1"
                  />
                  {showCreateError('localizacao') && <span className={styles.fieldHintError}>{createFieldErrors.localizacao}</span>}
                </label>
              </div>

              <div className={styles.sectionDivider}>
                <span>Ficha Técnica</span>
              </div>

              <div className={styles.techGrid}>
                {/*
                  Porque (PT-PT): usamos CSS Grid para garantir que os três campos
                  técnicos ocupam exatamente a mesma largura, com alinhamento estável
                  em contexto industrial (dados comparáveis lado a lado no ecrã).
                */}
                <div className={styles.horizontalRow}>
                  <div className={styles.horizontalItem}>
                    <NumberField
                      label="❄️ Temp. mínima"
                      unit="°C"
                      value={createForm.temp_min}
                      onChange={(value) => updateCreateField('temp_min', value)}
                      compact
                      placeholder="ex: -20"
                    />
                  </div>

                  <div className={styles.horizontalItem}>
                    <NumberField
                      label="🔥 Temp. máxima"
                      unit="°C"
                      value={createForm.temp_max}
                      onChange={(value) => updateCreateField('temp_max', value)}
                      compact
                      placeholder="ex: 80"
                    />
                  </div>

                  <div className={styles.horizontalItem}>
                      <NumberField
                        label="💧 Humidade"
                        unit="%"
                        value={createForm.humidade_max}
                        onChange={(value) => updateCreateField('humidade_max', value)}
                        compact
                        placeholder="opcional"
                      />
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <span className="label">Estado Inicial</span>
                <select
                  className={styles.input}
                  value={createForm.estado_atual}
                  onChange={(e) => updateCreateField('estado_atual', e.target.value)}
                >
                  {ESTADOS_UI.map((estado) => <option key={estado} value={estado}>{estado}</option>)}
                </select>
              </label>
            </div>

            <div className={styles.requiredProgress}>
              Campos obrigatórios preenchidos: <strong>{createRequiredDone}/{createRequiredTotal}</strong>
            </div>

            {createErro && <div className={styles.formErro}>{createErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={closeCreate} type="button">
                Cancelar
              </button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={createSaving || createHasErrors} type="button">
                {createSaving ? 'A guardar...' : 'Criar Equipamento'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {manualEquipamento && createPortal(
        <div className={styles.overlay} onClick={closeManual}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className="label">Ficha Técnica</div>
              <h2 className={styles.modalTitle}>{manualEquipamento.nome}</h2>
              <p className={styles.modalSubtitle}>
                {manualEquipamento.codigo} · {manualEquipamento.tipo} · {manualEquipamento.localizacao}
              </p>
            </div>

            <div className={styles.manualSummary}>
              <div>
                <span className={styles.manualLabel}>Estado</span>
                <StatusBadge estado={manualEquipamento.estado_atual} />
              </div>
              <div>
                <span className={styles.manualLabel}>Registado em</span>
                <strong>{manualEquipamento.criado_em ? new Date(manualEquipamento.criado_em).toLocaleDateString('pt-PT') : '—'}</strong>
              </div>
              <div>
                <span className={styles.manualLabel}>Temperatura (min → max)</span>
                <strong>{`${manualEquipamento.temp_min ?? '—'} °C ❄️  → ${manualEquipamento.temp_max ?? '—'} °C 🔥`}</strong>
              </div>
            </div>

            <div className={styles.manualLayout}>
              {!manualEdit && (
                MANUAL_SECTIONS.map((section) => (
                  <section key={section.title} className={styles.manualSection}>
                    <div className={styles.manualSectionTitle}>{section.title}</div>
                    <div className={styles.manualGrid}>
                      {section.fields.map((field) => (
                        <InfoCard
                          key={field.key}
                          label={field.label}
                          value={formatValue(manualEquipamento[field.key], field.unit)}
                        />
                      ))}
                    </div>
                  </section>
                ))
              )}

              {manualEdit && manualForm && (
                <section className={styles.manualSection}>
                  <div className={styles.manualSectionTitle}>Ficha Técnica (Edição)</div>
                  <div className={styles.manualGrid}>
                    {MANUAL_EDIT_FIELDS.map((field) => (
                      <NumberField
                        key={field.key}
                        label={field.label}
                        unit={field.unit}
                        value={manualForm[field.key]}
                        onChange={(value) => updateManualField(field.key, value)}
                      />
                    ))}
                    <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                      <span className="label">Ligação Eléctrica</span>
                      <input
                        className={styles.input}
                        value={manualForm.ligacao_eletrica}
                        onChange={(e) => updateManualField('ligacao_eletrica', e.target.value)}
                        placeholder="ex: Trifásica 400V"
                      />
                    </label>
                  </div>
                </section>
              )}
            </div>

            <div className={styles.modalActions}>
              {!manualEdit && (
                <>
                  <button className={styles.btnSecondary} onClick={closeManual} type="button">
                    Fechar
                  </button>
                  <button className={styles.btnManual} onClick={() => setManualEdit(true)} type="button">
                    Editar Ficha
                  </button>
                </>
              )}

              {manualEdit && (
                <>
                  <button className={styles.btnSecondary} onClick={() => { setManualEdit(false); setManualForm({
                    humidade_max: manualEquipamento.humidade_max ?? '',
                    largura_mm: manualEquipamento.largura_mm ?? '',
                    altura_mm: manualEquipamento.altura_mm ?? '',
                    profundidade_mm: manualEquipamento.profundidade_mm ?? '',
                    volume_l: manualEquipamento.volume_l ?? '',
                    voltagem_v: manualEquipamento.voltagem_v ?? '',
                    corrente_a: manualEquipamento.corrente_a ?? '',
                    potencia_kw: manualEquipamento.potencia_kw ?? '',
                    ligacao_eletrica: manualEquipamento.ligacao_eletrica || '',
                  }) }} type="button">
                    Cancelar
                  </button>
                  <button className={styles.btnPrimary} onClick={saveManual} disabled={manualSaving} type="button">
                    {manualSaving ? 'A guardar...' : 'Guardar Ficha'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {editEquipamento && createPortal(
        <div className={styles.overlay} onClick={closeEdit}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className="label">Editar Equipamento</div>
              <h2 className={styles.modalTitle}>{editEquipamento.nome}</h2>
              <p className={styles.modalSubtitle}>
                Actualiza apenas os campos necessários para manter o registo limpo e auditável.
              </p>
            </div>

            <div className={styles.fields}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className="label">Nome *</span>
                  <input
                    className={`${styles.input} ${showEditError('nome') ? styles.inputError : ''} ${showEditValid('nome') ? styles.inputValid : ''}`}
                    value={editForm.nome}
                    onChange={(e) => updateEditField('nome', e.target.value)}
                    onBlur={() => markEditTouched('nome')}
                  />
                  {showEditError('nome') && <span className={styles.fieldHintError}>{editFieldErrors.nome}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">Tipo *</span>
                  <select
                    className={`${styles.input} ${showEditError('tipo') ? styles.inputError : ''} ${showEditValid('tipo') ? styles.inputValid : ''}`}
                    value={editForm.tipo}
                    onChange={(e) => updateEditField('tipo', e.target.value)}
                    onBlur={() => markEditTouched('tipo')}
                  >
                    <option value="">Selecionar tipo...</option>
                    {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                  </select>
                  {showEditError('tipo') && <span className={styles.fieldHintError}>{editFieldErrors.tipo}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">Localização *</span>
                  <input
                    className={`${styles.input} ${showEditError('localizacao') ? styles.inputError : ''} ${showEditValid('localizacao') ? styles.inputValid : ''}`}
                    value={editForm.localizacao}
                    onChange={(e) => updateEditField('localizacao', e.target.value)}
                    onBlur={() => markEditTouched('localizacao')}
                  />
                  {showEditError('localizacao') && <span className={styles.fieldHintError}>{editFieldErrors.localizacao}</span>}
                </label>
                
                <label className={styles.field}>
                  <span className="label">Estado</span>
                  <select
                    className={styles.input}
                    value={editForm.estado_atual}
                    onChange={(e) => updateEditField('estado_atual', e.target.value)}
                  >
                    {ESTADOS_UI.map((estado) => <option key={estado} value={estado}>{estado}</option>)}
                  </select>
                </label>
              </div>

              {/* A Ficha Técnica técnica edita-se no modal "Ficha Técnica" para evitar sobrescritas acidentais */}
            </div>

            {editErro && <div className={styles.formErro}>{editErro}</div>}

            {editForm.estado_atual === 'Avariado' && (
              <div style={{ marginTop: 12 }}>
                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Descrição da Avaria (opcional)</span>
                  <textarea
                    className={styles.textarea}
                    value={editForm.descricao_avaria}
                    onChange={(e) => updateEditField('descricao_avaria', e.target.value)}
                    placeholder="Detalhes breves sobre a avaria (ex: falha no ventilador, fuga de água, ...)"
                    rows={3}
                  />
                </label>
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={closeEdit} type="button">
                Cancelar
              </button>
              <button className={styles.btnPrimary} onClick={handleEditar} disabled={editSaving || editHasErrors} type="button">
                {editSaving ? 'A guardar...' : 'Guardar Alterações'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className={styles.manualCard}>
      <span className={styles.manualCardLabel}>{label}</span>
      <strong className={styles.manualCardValue}>{value}</strong>
    </div>
  )
}

function NumberField({ label, unit, value, onChange, compact = false, placeholder = '' }) {
  const fieldClass = compact ? `${styles.field} ${styles.compactField}` : styles.field
  const wrapClass = compact ? `${styles.numberInputWrap} ${styles.compactWrap}` : styles.numberInputWrap
  const inputClass = compact ? `${styles.numberInput} ${styles.numberInputCompact}` : styles.numberInput
  const unitClass = compact ? `${styles.numberUnit} ${styles.numberUnitCompact}` : styles.numberUnit

  return (
    <label className={fieldClass}>
      <span className="label">{label}</span>
      <div className={wrapClass}>
        <input
          type="number"
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <span className={unitClass}>{unit}</span>
      </div>
    </label>
  )
}
