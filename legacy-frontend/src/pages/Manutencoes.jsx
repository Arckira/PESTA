import { useCallback, useEffect, useState } from 'react'
import { Plus, Download } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './Manutencoes.module.css'
import eqStyles from './Equipamentos.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import ResourceTable from '../components/ResourceTable.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isProxima(dt) {
  if (!dt) return false
  const diff = (new Date(dt) - new Date()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 30
}

function isVencida(dt) {
  if (!dt) return false
  return new Date(dt) < new Date()
}

const TIPOS_INTERVENCAO = ['Diagnóstico', 'Reparação', 'Outro']

const EMPTY = {
  descricao: '',
  data_realizada: '',
  proxima_data: '',
  tipo_intervencao: '',
  custo_eur: '',
  referencia_sc_po: '',
  observacoes_externas: '',
}

export default function Manutencoes() {
  const toast = useToast()
  const { map: equipamentos, list: equipamentosList, loading: eqLoading } = useEquipamentos()

  const [manutencoes, setManutencoes] = useState([])
  const [loading, setLoading] = useState(true)

  // Porque (PT-PT): estados para filtros em tempo real
  const [filtro, setFiltro] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('Todos')

  const [modal, setModal] = useState(false)
  const [eqSel, setEqSel] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const mn = await api.listarTodasManutencoes()
      setManutencoes(mn)
    } catch (e) {
      toast.error(`Falha ao carregar manutenções: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { carregar() }, [carregar])

  // Porque (PT-PT): filtragem em tempo real com base no texto e tipo selecionado
  const manutencoesFiltered = manutencoes.filter((mn) => {
    const eq = equipamentos[mn.equipamento_id]
    const nomeEq = eq ? eq.nome : `EQ-${mn.equipamento_id}`
    const matchTexto = nomeEq.toLowerCase().includes(filtro.toLowerCase()) || mn.descricao.toLowerCase().includes(filtro.toLowerCase())
    const matchTipo = filtroTipo === 'Todos' || mn.tipo_intervencao === filtroTipo
    return matchTexto && matchTipo
  })

  const handleExportPdf = useCallback(async () => {
    try {
      const tipo = filtroTipo === 'Todos' ? '' : filtroTipo
      const blob = await api.exportarManutencoesPdf({ filtro, tipo })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `manutenções_${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('PDF exportado com sucesso.')
    } catch (e) {
      toast.error(`Falha ao exportar: ${e.message}`)
    }
  }, [filtro, filtroTipo, toast])

  const openModal = () => {
    setEqSel(equipamentosList.length > 0 ? String(equipamentosList[0].id) : '')
    setForm(EMPTY)
    setFormErro('')
    setModal(true)
  }

  const closeModal = () => {
    setModal(false)
    setFormErro('')
  }

  const handleSubmit = useCallback(async () => {
    if (!eqSel || !form.descricao || !form.data_realizada) {
      setFormErro('Preenche os campos obrigatórios.')
      toast.error('Faltam campos obrigatórios na manutenção.')
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      const payload = {
        descricao: form.descricao,
        data_realizada: new Date(form.data_realizada).toISOString(),
        proxima_data: form.proxima_data ? new Date(form.proxima_data).toISOString() : null,
        tipo_intervencao: form.tipo_intervencao || null,
        custo_eur: form.custo_eur !== '' && form.custo_eur != null ? Number(form.custo_eur) : null,
        referencia_sc_po: form.referencia_sc_po || null,
        observacoes_externas: form.observacoes_externas || null,
      }
      await api.registarManutencao(eqSel, payload)
      toast.success('Manutenção registada com sucesso.')
      closeModal()
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || 'Não foi possível registar manutenção.')
    } finally {
      setSaving(false)
    }
  }, [eqSel, form, carregar, toast])

  const loadingPage = loading || eqLoading

  const renderRow = useCallback((mn) => {
    const eq = equipamentos[mn.equipamento_id]
    const proxVencida = isVencida(mn.proxima_data)
    const proxProxima = isProxima(mn.proxima_data)
    return (
      <tr key={mn.id}>
        <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(mn.id).padStart(3, '0')}</td>
        <td>
          {eq
            ? <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
            : `EQ-${mn.equipamento_id}`}
        </td>
        <td className={styles.descricao}>{mn.descricao}</td>
        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {mn.tipo_intervencao || <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(mn.data_realizada)}</td>
        <td>
          {mn.proxima_data ? (
            <StatusBadge variant={proxVencida ? 'danger' : proxProxima ? 'occupied' : 'success'}>
              {proxVencida && '⚠ '}{proxProxima && '● '}{fmt(mn.proxima_data)}
            </StatusBadge>
          ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
        <td className="mono" style={{ fontSize: 12 }}>
          {mn.custo_eur != null
            ? <span>{Number(mn.custo_eur).toFixed(2)} €</span>
            : <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
        <td style={{ fontSize: 12 }}>
          {mn.referencia_sc_po || <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
      </tr>
    )
  }, [equipamentos])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">Registos</div>
          <h1 className={styles.title}>Manutenções</h1>
        </div>
        <button type="button" className={styles.registerBtn} onClick={openModal}>
          <Plus size={18} strokeWidth={2.5} />
          Registar Manutenção
        </button>
      </div>

      {/* Porque (PT-PT): barra de filtros replicando o padrão de Equipamentos */}
      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Pesquisar por equipamento ou descrição…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
        >
          <option value="Todos">Todos os tipos</option>
          {TIPOS_INTERVENCAO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
        </select>
        <button
          className={styles.btnExport}
          onClick={handleExportPdf}
          disabled={manutencoesFiltered.length === 0}
          type="button"
        >
          <Download size={14} strokeWidth={2} />
          Exportar PDF
        </button>
      </div>

      {loadingPage && <div className={styles.empty}>A carregar…</div>}

      {!loadingPage && (
        <ResourceTable
          columns={['#', 'Equipamento', 'Descrição', 'Tipo', 'Data Realizada', 'Próxima Manutenção', 'Custo (€)', 'SC/PO']}
          items={manutencoesFiltered}
          renderRow={renderRow}
          loading={false}
          emptyNode={(
            manutencoesFiltered.length === 0 && (filtro || filtroTipo !== 'Todos')
              ? <div className={styles.empty}>Nenhum resultado para os filtros atuais.</div>
              : <div className={styles.empty}>Nenhuma manutenção registada.</div>
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {modal && createPortal(
        <div className={eqStyles.overlay} onClick={closeModal}>
          <div className={`${eqStyles.modal} ${eqStyles.modalWide}`} onClick={(e) => e.stopPropagation()}>

            <div className={eqStyles.modalHeader}>
              <div className="label">Manutenção</div>
              <h2 className={eqStyles.modalTitle}>Registar Manutenção</h2>
            </div>

            <div className={eqStyles.fields}>
              <div className={eqStyles.formGrid}>

                <label className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Equipamento *</span>
                  <select
                    className={eqStyles.input}
                    value={eqSel}
                    onChange={(e) => setEqSel(e.target.value)}
                  >
                    {equipamentosList.map((eq) => (
                      <option key={eq.id} value={eq.id}>{eq.nome}</option>
                    ))}
                  </select>
                </label>

                <label className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Descrição *</span>
                  <textarea
                    className={eqStyles.input}
                    rows={3}
                    style={{ resize: 'vertical' }}
                    value={form.descricao}
                    onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                    placeholder="O que foi feito…"
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">Tipo de Intervenção</span>
                  <select
                    className={eqStyles.input}
                    value={form.tipo_intervencao}
                    onChange={(e) => setForm((f) => ({ ...f, tipo_intervencao: e.target.value }))}
                  >
                    <option value="">— Selecionar —</option>
                    {TIPOS_INTERVENCAO.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                <label className={eqStyles.field}>
                  <span className="label">Data Realizada *</span>
                  <input
                    type="datetime-local"
                    className={eqStyles.input}
                    value={form.data_realizada}
                    onChange={(e) => setForm((f) => ({ ...f, data_realizada: e.target.value }))}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">Próxima Manutenção</span>
                  <input
                    type="datetime-local"
                    className={eqStyles.input}
                    value={form.proxima_data}
                    onChange={(e) => setForm((f) => ({ ...f, proxima_data: e.target.value }))}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">Custo (€)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={eqStyles.input}
                    value={form.custo_eur}
                    onChange={(e) => setForm((f) => ({ ...f, custo_eur: e.target.value }))}
                    placeholder="0.00"
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">Referência SC/PO</span>
                  <input
                    type="text"
                    className={eqStyles.input}
                    value={form.referencia_sc_po}
                    onChange={(e) => setForm((f) => ({ ...f, referencia_sc_po: e.target.value }))}
                    placeholder="Ex: SC-12345 / PO-98765"
                  />
                </label>

                <label className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Observações</span>
                  <textarea
                    className={eqStyles.input}
                    rows={2}
                    style={{ resize: 'vertical' }}
                    value={form.observacoes_externas}
                    onChange={(e) => setForm((f) => ({ ...f, observacoes_externas: e.target.value }))}
                    placeholder="Empresa externa, nº de proposta, observações adicionais…"
                  />
                </label>

              </div>
            </div>

            {formErro && <div className={eqStyles.formErro}>{formErro}</div>}

            <div className={eqStyles.modalActions}>
              <button className={eqStyles.btnSecondary} onClick={closeModal} type="button">
                Cancelar
              </button>
              <button
                className={eqStyles.btnPrimary}
                onClick={handleSubmit}
                disabled={saving}
                type="button"
              >
                {saving ? 'A guardar...' : 'Registar Manutenção'}
              </button>
            </div>

          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
