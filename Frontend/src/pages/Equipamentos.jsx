import React, { useEffect, useState, useMemo } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { Play, BookOpen, Pencil, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import ModalWrapper from '../components/ModalWrapper.jsx'
import { api } from '../api/index.js'
import StatusBadge, { normalizarEstadoEquipamento } from '../components/StatusBadge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Equipamentos.module.css'

const ESTADOS_UI = [
  { value: 'Disponível',    labelKey: 'status.disponivel' },
  { value: 'Ocupado',       labelKey: 'status.ocupado' },
  { value: 'Em calibração', labelKey: 'status.emCalibracao' },
  { value: 'Em manutenção', labelKey: 'status.emManutencao' },
  { value: 'Avariado',      labelKey: 'status.avariado' },
]

const TIPOS = [
  'Câmara Climática',
  'Forno',
  'Câmara Choque Térmico',
  'Salina',
  'Outro',
]

const CATEGORIAS = [
  { id: 'Todos',                 labelKey: 'equipamentos.catTodos',             icone: '◈', tipos: null },
  { id: 'Câmara Climática',      labelKey: 'equipamentos.catCamarasClimaticas', icone: '❄', tipos: ['Câmara Climática'] },
  { id: 'Câmara Choque Térmico', labelKey: 'equipamentos.catChoqueTermico',     icone: '⚡', tipos: ['Câmara Choque Térmico'] },
  { id: 'Forno',                 labelKey: 'equipamentos.catFornos',            icone: '🔥', tipos: ['Forno'] },
  { id: 'Salina',                labelKey: 'equipamentos.catSalinas',           icone: '◌', tipos: ['Salina'] },
  { id: 'Outro',                 labelKey: 'equipamentos.catOutros',            icone: '⊡', tipos: ['Outro'] },
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
  codigo: '',
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
    title: 'Identificação',
    fields: [
      { key: 'fabricante', label: 'Fabricante' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'numero_serie', label: 'Número de Série' },
      { key: 'ano_fabrico', label: 'Ano de Fabrico' },
      { key: 'peso_kg', label: 'Peso', unit: 'kg' },
      { key: 'peso_max_kg', label: 'Carga Máxima', unit: 'kg' },
    ],
  },
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
  { key: 'codigo', label: 'Código Interno', textField: true },
  { key: 'fabricante', label: 'Fabricante', textField: true },
  { key: 'modelo', label: 'Modelo', textField: true },
  { key: 'numero_serie', label: 'Número de Série', textField: true },
  { key: 'ano_fabrico', label: 'Ano de Fabrico' },
  { key: 'peso_kg', label: 'Peso', unit: 'kg' },
  { key: 'peso_max_kg', label: 'Carga Máxima', unit: 'kg' },
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
    codigo: equipamento.codigo || '',
    tipo: equipamento.tipo || '',
    localizacao: equipamento.localizacao || '',
    estado_atual: equipamento.estado_atual || 'Disponível',
    descricao_avaria: '',
  }
}

export default function Equipamentos() {
  const toast = useToast()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
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
      toast.error(t('equipamentos.erroCarregarToast', { msg: e.message }))
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

  const [filtroCategoria, setFiltroCategoria] = useState('Todos')

  // Estado de colapso persistido em localStorage — recupera preferências entre sessões
  const [colapsadas, setColapsadas] = useState(() => {
    try {
      const guardado = localStorage.getItem('equipamentos-categorias-colapsadas')
      return guardado ? new Set(JSON.parse(guardado)) : new Set()
    } catch {
      return new Set()
    }
  })

  const toggleCategoria = (catId) => {
    setColapsadas((prev) => {
      const novo = new Set(prev)
      if (novo.has(catId)) novo.delete(catId)
      else novo.add(catId)
      localStorage.setItem('equipamentos-categorias-colapsadas', JSON.stringify([...novo]))
      return novo
    })
  }

  const expandirTodas = () => {
    localStorage.setItem('equipamentos-categorias-colapsadas', JSON.stringify([]))
    setColapsadas(new Set())
  }

  const recolherTodas = () => {
    const idsComEquipamentos = CATEGORIAS
      .filter((cat) => cat.id !== 'Todos')
      .filter((cat) => filtradosPorCategoria.some((eq) => (cat.tipos ?? []).includes(eq.tipo)))
      .map((cat) => cat.id)
    const cheio = new Set(idsComEquipamentos)
    localStorage.setItem('equipamentos-categorias-colapsadas', JSON.stringify([...cheio]))
    setColapsadas(cheio)
  }

  // Verdadeiro se nenhuma categoria está colapsada
  const todasExpandidas = colapsadas.size === 0

  // Contagens por categoria para mostrar badges nos chips e ocultar chips sem equipamentos
  const contagensPorCategoria = useMemo(() => {
    return CATEGORIAS.reduce((acc, cat) => {
      acc[cat.id] = cat.tipos === null
        ? filtrados.length
        : filtrados.filter((eq) => cat.tipos.includes(eq.tipo)).length
      return acc
    }, {})
  }, [filtrados])

  // Aplica o filtro de categoria sobre os já filtrados por texto/estado
  const filtradosPorCategoria = useMemo(() => {
    if (filtroCategoria === 'Todos') return filtrados
    const cat = CATEGORIAS.find((c) => c.id === filtroCategoria)
    if (!cat || !cat.tipos) return filtrados
    return filtrados.filter((eq) => cat.tipos.includes(eq.tipo))
  }, [filtrados, filtroCategoria])

  // Os separadores de categoria identificam o grupo — a coluna Tipo seria ruído visual em ambos os modos
  const mostrarColunaTipo = false

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
      codigo: eq.codigo || '',
      fabricante: eq.fabricante || '',
      modelo: eq.modelo || '',
      numero_serie: eq.numero_serie || '',
      ano_fabrico: eq.ano_fabrico ?? '',
      peso_kg: eq.peso_kg ?? '',
      peso_max_kg: eq.peso_max_kg ?? '',
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
      setCreateErro(t('equipamentos.confirmaCamposCriar'))
      toast.error(t('equipamentos.camposObrigatoriosErro'))
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
      toast.success(t('equipamentos.criadoSucesso', { nome: payload.nome }))
      closeCreate()
      await carregar()
    } catch (e) {
      setCreateErro(e.message)
      toast.error(e.message || t('equipamentos.erroCriar'))
    } finally {
      setCreateSaving(false)
    }
  }

  const handleEditar = async () => {
    if (!editEquipamento) return

    setEditSubmittedOnce(true)
    if (editHasErrors) {
      setEditErro(t('equipamentos.confirmaCamposEditar'))
      toast.error(t('equipamentos.camposObrigatoriosErro'))
      return
    }

    setEditSaving(true)
    setEditErro('')

    try {
      // Construir payload parcial — inclui alteração de estado e possível
      // descrição de avaria se o utilizador marcar como 'Avariado'.
      const payload = {
        nome: editForm.nome.trim(),
        codigo: editForm.codigo.trim() || undefined,
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
      toast.success(t('equipamentos.atualizadoSucesso', { nome: atualizado.nome }))
      closeEdit()
    } catch (e) {
      setEditErro(e.message)
      toast.error(e.message || t('equipamentos.erroAtualizar'))
    } finally {
      setEditSaving(false)
    }
  }

  // Guarda os campos técnicos da Ficha Técnica diretamente do modal Manual.
  const saveManual = async () => {
    if (!manualEquipamento || !manualForm) return
    setManualSaving(true)
    try {
      const numericFields = MANUAL_EDIT_FIELDS.filter(f => !f.textField)
      const textFields = MANUAL_EDIT_FIELDS.filter(f => f.textField)
      const payload = {
        ...buildNumericPayload(manualForm, numericFields.map(f => ({ key: f.key, label: f.label, allowNegative: true }))),
        ...Object.fromEntries(textFields.map(f => [f.key, sanitizeText(manualForm[f.key])])),
        ligacao_eletrica: sanitizeText(manualForm.ligacao_eletrica),
      }
      const atualizado = await api.atualizarEquipamento(manualEquipamento.id, payload)
      setEquipamentos((prev) => prev.map((item) => (item.id === atualizado.id ? atualizado : item)))
      setManualEquipamento(atualizado)
      toast.success(t('equipamentos.fichaAtualizadaSucesso'))
      setManualEdit(false)
    } catch (e) {
      toast.error(e.message || t('equipamentos.erroAtualizarFicha'))
    } finally {
      setManualSaving(false)
    }
  }

  const handleEliminar = async (eq) => {
    const confirmar = window.confirm(t('equipamentos.confirmarEliminar', { nome: eq.nome }))
    if (!confirmar) return

    setDeletingId(eq.id)
    try {
      await api.eliminarEquipamento(eq.id)
      setEquipamentos((prev) => prev.filter((item) => item.id !== eq.id))
      if (manualEquipamento?.id === eq.id) closeManual()
      if (editEquipamento?.id === eq.id) closeEdit()
      toast.success(t('equipamentos.eliminadoSucesso', { nome: eq.nome }))
    } catch (e) {
      toast.error(e.message || t('equipamentos.erroEliminar'))
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
      toast.success(t('equipamentos.pdfExportado'))
    } catch (e) {
      toast.error(e.message || t('equipamentos.erroPdf'))
    }
  }

  const renderRow = (eq) => {
    const estaAvariado = normalizarEstadoEquipamento(eq.estado_atual) === 'Avariado'
    return (
    <tr key={eq.id} className={estaAvariado ? styles.rowAvariado : undefined}>
      <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(eq.id).padStart(3, '0')}</td>
      <td>
        <strong className={styles.rowName}>
          {estaAvariado && (
            <span className={styles.rowAvariadoIcon} title={t('equipamentos.equipamentoAvariado')}>⚠</span>
          )}
          {eq.nome}
        </strong>
      </td>
      <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>{eq.codigo || '-'}</td>
      {mostrarColunaTipo && <td style={{ color: 'var(--text-secondary)' }}>{eq.tipo}</td>}
      <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {(eq.temp_min != null && eq.temp_max != null)
          ? `${eq.temp_min} → ${eq.temp_max} °C`
          : '—'}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>{eq.localizacao}</td>
      <td><StatusBadge estado={eq.estado_atual} /></td>
      <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
        {eq.criado_em ? new Date(eq.criado_em).toLocaleDateString(locale) : '—'}
      </td>
      <td>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.btnCheckin}
            onClick={() => navigate(`/equipamentos/${eq.id}`)}
          >
            <Play size={18} />
            {t('equipamentos.botaoAbrir')}
          </button>
          <button
            type="button"
            className={styles.manualIcon}
            onClick={() => openManual(eq)}
            aria-label={t('equipamentos.consultarManual')}
            title={t('equipamentos.consultarManual')}
          >
            <BookOpen size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.btnEdit}
            onClick={() => openEdit(eq)}
            aria-label={t('equipamentos.editarNome', { nome: eq.nome })}
            title={t('common.edit')}
          >
            <Pencil size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.btnDelete}
            onClick={() => handleEliminar(eq)}
            disabled={deletingId === eq.id}
            aria-label={deletingId === eq.id
              ? t('equipamentos.aEliminarNome', { nome: eq.nome })
              : t('equipamentos.eliminarNome', { nome: eq.nome })}
            title={deletingId === eq.id ? t('equipamentos.aGuardar') : t('common.delete')}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </td>
    </tr>
  )
  }

  return (
    <div className="fade-up">
      <PageHeader
        categoria={t('equipamentos.gestao')}
        titulo={t('equipamentos.title')}
        secondaryActionText={t('equipamentos.exportarPdf')}
        onSecondaryActionClick={handleExport}
        actionText={t('equipamentos.novoEquipamento')}
        onActionClick={openCreate}
      />

      <div className={styles.categoryTabs}>
        {CATEGORIAS.filter((cat) => cat.tipos === null || contagensPorCategoria[cat.id] > 0).map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`${styles.categoryChip} ${filtroCategoria === cat.id ? styles.categoryChipActive : ''}`}
            onClick={() => setFiltroCategoria(cat.id)}
          >
            {cat.icone} {t(cat.labelKey)}
            <span className={styles.categoryChipCount}>{contagensPorCategoria[cat.id]}</span>
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder={t('equipamentos.pesquisarPlaceholder')}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
        >
          <option value="Todos">{t('common.allStatus')}</option>
          {ESTADOS_UI.map((e) => <option key={e.value} value={e.value}>{t(e.labelKey)}</option>)}
        </select>
      </div>

      {loading && <div className={styles.empty}>{t('common.loading')}</div>}
      {erro && <div className={styles.erro}>{t('equipamentos.erroCarregar', { msg: erro })}</div>}

      {!loading && !erro && (
        <>
          <div className={styles.count} style={{ marginBottom: 12 }}>
            <span>{t('equipamentos.contadorEquipamentos', { count: filtradosPorCategoria.length })}</span>
          </div>

          {filtroCategoria === 'Todos' && (
            <div className={styles.collapseControls}>
              <button
                type="button"
                className={styles.btnCollapseAll}
                onClick={todasExpandidas ? recolherTodas : expandirTodas}
              >
                {todasExpandidas ? t('equipamentos.recolherTudo') : t('equipamentos.expandirTudo')}
              </button>
            </div>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('common.name')}</th>
                  <th>{t('equipamentos.cabecalhoCod')}</th>
                  {mostrarColunaTipo && <th>{t('common.type')}</th>}
                  <th>{t('equipamentos.cabecalhoTemp')}</th>
                  <th>{t('common.location')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('equipamentos.cabecalhoRegistado')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtroCategoria === 'Todos' ? (
                  CATEGORIAS.filter((cat) => cat.id !== 'Todos').map((cat) => {
                    const equipsDaCategoria = filtradosPorCategoria.filter((eq) =>
                      (cat.tipos ?? []).includes(eq.tipo)
                    )
                    if (equipsDaCategoria.length === 0) return null

                    const estaColapsada = colapsadas.has(cat.id)

                    const contagens = {
                      Disponível: equipsDaCategoria.filter((eq) =>
                        normalizarEstadoEquipamento(eq.estado_atual) === 'Disponível').length,
                      Avariado: equipsDaCategoria.filter((eq) =>
                        normalizarEstadoEquipamento(eq.estado_atual) === 'Avariado').length,
                      Ocupado: equipsDaCategoria.filter((eq) =>
                        normalizarEstadoEquipamento(eq.estado_atual) === 'Ocupado').length,
                    }

                    return (
                      <React.Fragment key={cat.id}>
                        <tr
                          className={styles.categoryHeaderRow}
                          onClick={() => toggleCategoria(cat.id)}
                        >
                          <td colSpan={mostrarColunaTipo ? 9 : 8}>
                            <div className={styles.categoryHeaderContent}>
                              <div className={styles.categoryHeaderLeft}>
                                <span className={`${styles.categoryChevron} ${estaColapsada ? styles.categoryChevronCollapsed : ''}`}>
                                  ›
                                </span>
                                <span className={styles.categoryHeaderIcon}>{cat.icone}</span>
                                <span className={styles.categoryHeaderLabel}>{t(cat.labelKey)}</span>
                                <span className={styles.categoryHeaderCount}>
                                  ({equipsDaCategoria.length})
                                </span>
                              </div>
                              <div className={styles.categoryHeaderBadges}>
                                {contagens.Disponível > 0 && (
                                  <span className={`${styles.miniStateBadge} ${styles.miniStateBadgeOk}`}>
                                    ● {t('equipamentos.statusDisponivel', { count: contagens.Disponível })}
                                  </span>
                                )}
                                {contagens.Ocupado > 0 && (
                                  <span className={`${styles.miniStateBadge} ${styles.miniStateBadgeOcupado}`}>
                                    ● {t('equipamentos.statusOcupado', { count: contagens.Ocupado })}
                                  </span>
                                )}
                                {contagens.Avariado > 0 && (
                                  <span className={`${styles.miniStateBadge} ${styles.miniStateBadgeNok}`}>
                                    ● {t('equipamentos.statusAvariado', { count: contagens.Avariado })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {!estaColapsada && equipsDaCategoria.map(renderRow)}
                      </React.Fragment>
                    )
                  })
                ) : (
                  filtradosPorCategoria.map(renderRow)
                )}
                {filtradosPorCategoria.length === 0 && (
                  <tr>
                    <td colSpan={mostrarColunaTipo ? 9 : 8} className={styles.emptyCell}>
                      <EmptyState
                        icon="◎"
                        variant="neutral"
                        title={
                          equipamentos.length === 0
                            ? t('equipamentos.semEquipamentos')
                            : t('equipamentos.semResultados')
                        }
                        subtitle={
                          equipamentos.length === 0
                            ? t('equipamentos.semEquipamentosSub')
                            : t('equipamentos.semResultadosSub')
                        }
                        buttonText={
                          equipamentos.length === 0
                            ? t('equipamentos.adicionarEquipamento')
                            : t('equipamentos.limparFiltros')
                        }
                        onButtonClick={() => {
                          if (equipamentos.length === 0) openCreate()
                          else {
                            setFiltro('')
                            setFiltroEstado('Todos')
                            setFiltroCategoria('Todos')
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

      <ModalWrapper
        isOpen={createOpen}
        onClose={closeCreate}
        categoria={t('equipamentos.modalCriarLabel')}
        titulo={t('equipamentos.novoEquipamento')}
        tamanho="max-w-2xl"
      >
            <div className={styles.fields}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoNome')}</span>
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
                  <span className="label">{t('equipamentos.campoCodigo')}</span>
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
                  <span className="label">{t('equipamentos.campoTipo')}</span>
                  <select
                    className={`${styles.input} ${showCreateError('tipo') ? styles.inputError : ''} ${showCreateValid('tipo') ? styles.inputValid : ''}`}
                    value={createForm.tipo}
                    onChange={(e) => updateCreateField('tipo', e.target.value)}
                    onBlur={() => markCreateTouched('tipo')}
                  >
                    <option value="">{t('equipamentos.selecionarTipo')}</option>
                    {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                  </select>
                  {showCreateError('tipo') && <span className={styles.fieldHintError}>{createFieldErrors.tipo}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoLocalizacao')}</span>
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
                <span>{t('equipamentos.fichaLabel')}</span>
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
                <span className="label">{t('equipamentos.estadoInicial')}</span>
                <select
                  className={styles.input}
                  value={createForm.estado_atual}
                  onChange={(e) => updateCreateField('estado_atual', e.target.value)}
                >
                  {ESTADOS_UI.map((e) => <option key={e.value} value={e.value}>{t(e.labelKey)}</option>)}
                </select>
              </label>
            </div>

            <div className={styles.requiredProgress}>
              {t('equipamentos.camposObrigatoriosProgresso')}<strong>{createRequiredDone}/{createRequiredTotal}</strong>
            </div>

            {createErro && <div className={styles.formErro}>{createErro}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={closeCreate} type="button">
                {t('common.cancel')}
              </button>
              <button className={styles.btnPrimary} onClick={handleSubmit} disabled={createSaving || createHasErrors} type="button">
                {createSaving ? t('equipamentos.aGuardar') : t('equipamentos.criarEquipamento')}
              </button>
            </div>
      </ModalWrapper>

      {manualEquipamento && <ModalWrapper
        isOpen
        onClose={closeManual}
        categoria={t('equipamentos.fichaLabel')}
        titulo={manualEquipamento.nome ?? ''}
        tamanho="max-w-3xl"
      >
            <p className={styles.modalSubtitle}>
              {manualEquipamento?.codigo} · {manualEquipamento?.tipo} · {manualEquipamento?.localizacao}
            </p>

            <div className={styles.manualSummary}>
              <div>
                <span className={styles.manualLabel}>{t('equipamentos.estadoLabel')}</span>
                <StatusBadge estado={manualEquipamento.estado_atual} />
              </div>
              <div>
                <span className={styles.manualLabel}>{t('equipamentos.registadoEm')}</span>
                <strong>{manualEquipamento.criado_em ? new Date(manualEquipamento.criado_em).toLocaleDateString(locale) : '—'}</strong>
              </div>
              <div>
                <span className={styles.manualLabel}>{t('equipamentos.temperaturaRange')}</span>
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
                  <div className={styles.manualSectionTitle}>{t('equipamentos.fichaEdicao')}</div>
                  <div className={styles.manualGrid}>
                    {MANUAL_EDIT_FIELDS.map((field) => (
                      field.textField ? (
                        <label key={field.key} className={styles.field}>
                          <span className="label">{field.label}</span>
                          <input
                            className={styles.input}
                            value={manualForm[field.key]}
                            onChange={(e) => updateManualField(field.key, e.target.value)}
                          />
                        </label>
                      ) : (
                        <NumberField
                          key={field.key}
                          label={field.label}
                          unit={field.unit}
                          value={manualForm[field.key]}
                          onChange={(value) => updateManualField(field.key, value)}
                        />
                      )
                    ))}
                    <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                      <span className="label">{t('equipamentos.ligacaoEletrica')}</span>
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
                    {t('common.close')}
                  </button>
                  <button className={styles.btnManual} onClick={() => setManualEdit(true)} type="button">
                    {t('equipamentos.editarFicha')}
                  </button>
                </>
              )}

              {manualEdit && (
                <>
                  <button className={styles.btnSecondary} onClick={() => { setManualEdit(false); setManualForm({
                    codigo: manualEquipamento.codigo || '',
                    fabricante: manualEquipamento.fabricante || '',
                    modelo: manualEquipamento.modelo || '',
                    numero_serie: manualEquipamento.numero_serie || '',
                    ano_fabrico: manualEquipamento.ano_fabrico ?? '',
                    peso_kg: manualEquipamento.peso_kg ?? '',
                    peso_max_kg: manualEquipamento.peso_max_kg ?? '',
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
                    {t('common.cancel')}
                  </button>
                  <button className={styles.btnPrimary} onClick={saveManual} disabled={manualSaving} type="button">
                    {manualSaving ? t('equipamentos.aGuardar') : t('equipamentos.guardarFicha')}
                  </button>
                </>
              )}
            </div>
      </ModalWrapper>}

      {editEquipamento && <ModalWrapper
        isOpen
        onClose={closeEdit}
        categoria={t('equipamentos.editarEquipamento')}
        titulo={editEquipamento.nome ?? ''}
        tamanho="max-w-xl"
      >
            <p className={styles.modalSubtitle}>
              {t('equipamentos.editarSubtitulo')}
            </p>

            <div className={styles.fields}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoNomeEdit')}</span>
                  <input
                    className={`${styles.input} ${showEditError('nome') ? styles.inputError : ''} ${showEditValid('nome') ? styles.inputValid : ''}`}
                    value={editForm.nome}
                    onChange={(e) => updateEditField('nome', e.target.value)}
                    onBlur={() => markEditTouched('nome')}
                  />
                  {showEditError('nome') && <span className={styles.fieldHintError}>{editFieldErrors.nome}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoCodigoEdit')}</span>
                  <input
                    className={styles.input}
                    value={editForm.codigo}
                    onChange={(e) => updateEditField('codigo', e.target.value)}
                    placeholder="ex: T1C-0015"
                  />
                </label>

                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoTipo')}</span>
                  <select
                    className={`${styles.input} ${showEditError('tipo') ? styles.inputError : ''} ${showEditValid('tipo') ? styles.inputValid : ''}`}
                    value={editForm.tipo}
                    onChange={(e) => updateEditField('tipo', e.target.value)}
                    onBlur={() => markEditTouched('tipo')}
                  >
                    <option value="">{t('equipamentos.selecionarTipo')}</option>
                    {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                  </select>
                  {showEditError('tipo') && <span className={styles.fieldHintError}>{editFieldErrors.tipo}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">{t('equipamentos.campoLocalizacao')}</span>
                  <input
                    className={`${styles.input} ${showEditError('localizacao') ? styles.inputError : ''} ${showEditValid('localizacao') ? styles.inputValid : ''}`}
                    value={editForm.localizacao}
                    onChange={(e) => updateEditField('localizacao', e.target.value)}
                    onBlur={() => markEditTouched('localizacao')}
                  />
                  {showEditError('localizacao') && <span className={styles.fieldHintError}>{editFieldErrors.localizacao}</span>}
                </label>

                <label className={styles.field}>
                  <span className="label">{t('equipamentos.estadoLabel')}</span>
                  <select
                    className={styles.input}
                    value={editForm.estado_atual}
                    onChange={(e) => updateEditField('estado_atual', e.target.value)}
                  >
                    {ESTADOS_UI.map((e) => <option key={e.value} value={e.value}>{t(e.labelKey)}</option>)}
                  </select>
                </label>
              </div>

              {/* A Ficha Técnica técnica edita-se no modal "Ficha Técnica" para evitar sobrescritas acidentais */}
            </div>

            {editErro && <div className={styles.formErro}>{editErro}</div>}

            {editForm.estado_atual === 'Avariado' && (
              <div style={{ marginTop: 12 }}>
                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">{t('equipamentos.descricaoAvaria')}</span>
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
                {t('common.cancel')}
              </button>
              <button className={styles.btnPrimary} onClick={handleEditar} disabled={editSaving || editHasErrors} type="button">
                {editSaving ? t('equipamentos.aGuardar') : t('equipamentos.guardarAlteracoes')}
              </button>
            </div>
      </ModalWrapper>}
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