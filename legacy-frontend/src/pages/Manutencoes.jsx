import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Download } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Manutencoes.module.css'
import eqStyles from './Equipamentos.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import ResourceTable from '../components/ResourceTable.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

function fmt(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
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

function PainelFinanceiroManutencoes({ t, locale }) {
  const anoAtual = new Date().getFullYear()

  const [dados, setDados] = useState(null)
  const [loadingPainel, setLoadingPainel] = useState(true)
  const [expandido, setExpandido] = useState(() => {
    try { return localStorage.getItem('lab_painel_fin_expandido') !== 'false' }
    catch { return true }
  })

  useEffect(() => {
    api.resumoFinanceiro({ ano: anoAtual })
      .then(setDados)
      .catch(() => {})
      .finally(() => setLoadingPainel(false))
  }, [])

  const toggleExpandido = () => {
    setExpandido((prev) => {
      const next = !prev
      try { localStorage.setItem('lab_painel_fin_expandido', String(next)) } catch {}
      return next
    })
  }

  const fmtEur = (v) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(v ?? 0)

  if (!loadingPainel && !dados) return null

  if (loadingPainel) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 72, background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, opacity: 0.5,
            }}
          />
        ))}
      </div>
    )
  }

  const topEq = [...(dados?.top_equipamentos ?? [])].sort((a, b) => b.total_eur - a.total_eur).slice(0, 3)
  const maxEq = topEq[0]?.total_eur ?? 1
  const topForn = [...(dados?.por_fornecedor ?? [])].sort((a, b) => b.total_eur - a.total_eur).slice(0, 4)
  const vazio = (dados?.total_eur ?? 0) === 0 || (topEq.length === 0 && topForn.length === 0)

  return (
    <div style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: expandido ? '1px solid var(--border)' : 'none',
        background: 'var(--surface)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Resumo Financeiro {anoAtual}
        </span>
        <button
          type="button"
          onClick={toggleExpandido}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}
        >
          {expandido ? '▾ recolher' : '▸ Resumo Financeiro'}
        </button>
      </div>

      {expandido && (
        <div style={{ padding: '12px 16px', background: 'var(--bg)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: t('financeiro.totalGasto'), value: dados?.total_eur },
              { label: t('financeiro.avariasYtd'), value: dados?.avarias_eur },
              { label: t('financeiro.manutencoesYtd'), value: dados?.manutencoes_eur },
              { label: t('financeiro.calibracoesYtd'), value: dados?.calibracoes_eur },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{fmtEur(value)}</div>
              </div>
            ))}
          </div>

          {vazio ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, padding: '8px 0' }}>
              {t('financeiro.semDados')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {t('financeiro.topEquipamentos')}
                </div>
                {topEq.map((eq) => (
                  <div key={eq.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <Link to={`/equipamentos/${eq.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {eq.nome}
                      </Link>
                      <span style={{ color: 'var(--text-secondary)' }}>{fmtEur(eq.total_eur)}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${Math.round((eq.total_eur / maxEq) * 100)}%`, background: 'var(--accent)', borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {t('financeiro.porFornecedor')}
                </div>
                {topForn.map((f) => (
                  <div key={f.nome} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: 'var(--text)' }}>{f.nome}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {fmtEur(f.total_eur)} ({f.n_intervencoes} {t('financeiro.nIntervencoes')})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const tTipo = (tipo) => {
    const map = { 'Diagnóstico': t('manutencoes_page.tiposDiagnostico'), 'Reparação': t('manutencoes_page.tiposReparacao'), 'Outro': t('manutencoes_page.tiposOutro') }
    return map[tipo] ?? tipo
  }
  const { map: equipamentos, list: equipamentosList, loading: eqLoading } = useEquipamentos()

  const [manutencoes, setManutencoes] = useState([])
  const [loading, setLoading] = useState(true)

  const [filtro, setFiltro] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('Todos')

  const [modal, setModal] = useState(false)
  const [eqSel, setEqSel] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [formFornecedor, setFormFornecedor] = useState('')

  const fornecedoresExistentes = useMemo(
    () => [...new Set(manutencoes.map((m) => m.fornecedor).filter(Boolean))],
    [manutencoes],
  )

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const mn = await api.listarTodasManutencoes()
      setManutencoes(mn)
    } catch (e) {
      toast.error(`${t('manutencoes.errorLoad')}: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => { carregar() }, [carregar])

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
      toast.success(t('manutencoes_page.pdfExportado'))
    } catch (e) {
      toast.error(t('manutencoes_page.erroPdf', { msg: e.message }))
    }
  }, [filtro, filtroTipo, toast])

  const openModal = () => {
    setEqSel(equipamentosList.length > 0 ? String(equipamentosList[0].id) : '')
    setForm(EMPTY)
    setFormErro('')
    setFormFornecedor('')
    setModal(true)
  }

  const closeModal = () => {
    setModal(false)
    setFormErro('')
  }

  const handleSubmit = useCallback(async () => {
    if (!eqSel || !form.descricao || !form.data_realizada) {
      setFormErro(t('manutencoes_page.erroCamposObrigatorios'))
      toast.error(t('manutencoes_page.erroCamposObrigatoriosToast'))
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
        fornecedor: formFornecedor || null,
      }
      await api.registarManutencao(eqSel, payload)
      toast.success(t('manutencoes.successCreate'))
      closeModal()
      carregar()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || t('manutencoes_page.erroRegistar'))
    } finally {
      setSaving(false)
    }
  }, [eqSel, form, carregar, toast, t])

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
          {mn.tipo_intervencao ? tTipo(mn.tipo_intervencao) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(mn.data_realizada, locale)}</td>
        <td>
          {mn.proxima_data ? (
            <StatusBadge variant={proxVencida ? 'danger' : proxProxima ? 'occupied' : 'success'}>
              {proxVencida && '⚠ '}{proxProxima && '● '}{fmt(mn.proxima_data, locale)}
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
  }, [equipamentos, locale])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">{t('manutencoes_page.subtitulo')}</div>
          <h1 className={styles.title}>{t('manutencoes.title')}</h1>
        </div>
        <button type="button" className={styles.registerBtn} onClick={openModal}>
          <Plus size={18} strokeWidth={2.5} />
          {t('manutencoes.new')}
        </button>
      </div>

      <PainelFinanceiroManutencoes t={t} locale={locale} />

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder={t('common.search')}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
        >
          <option value="Todos">{t('common.allTypes')}</option>
          {TIPOS_INTERVENCAO.map((tipo) => <option key={tipo} value={tipo}>{tTipo(tipo)}</option>)}
        </select>
        <button
          className={styles.btnExport}
          onClick={handleExportPdf}
          disabled={manutencoesFiltered.length === 0}
          type="button"
        >
          <Download size={14} strokeWidth={2} />
          {t('manutencoes_page.exportarPdf')}
        </button>
      </div>

      {loadingPage && <div className={styles.empty}>{t('common.loading')}</div>}

      {!loadingPage && (
        <ResourceTable
          columns={['#', t('common.equipment'), t('common.description'), t('common.type'), t('manutencoes.performed'), t('manutencoes.next'), t('manutencoes_page.custo'), t('manutencoes_page.scPo')]}
          items={manutencoesFiltered}
          renderRow={renderRow}
          loading={false}
          emptyNode={(
            manutencoesFiltered.length === 0 && (filtro || filtroTipo !== 'Todos')
              ? <div className={styles.empty}>{t('manutencoes_page.semResultados')}</div>
              : <div className={styles.empty}>{t('manutencoes_page.semManutencoes')}</div>
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {modal && createPortal(
        <div className={eqStyles.overlay} onClick={closeModal}>
          <div className={`${eqStyles.modal} ${eqStyles.modalWide}`} onClick={(e) => e.stopPropagation()}>

            <div className={eqStyles.modalHeader}>
              <div className="label">{t('manutencoes_page.modalLabel')}</div>
              <h2 className={eqStyles.modalTitle}>{t('manutencoes.new')}</h2>
            </div>

            <div className={eqStyles.fields}>
              <div className={eqStyles.formGrid}>

                <label className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">{t('common.equipment')} *</span>
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
                  <span className="label">{t('common.description')} *</span>
                  <textarea
                    className={eqStyles.input}
                    rows={3}
                    style={{ resize: 'vertical' }}
                    value={form.descricao}
                    onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                    placeholder={t('manutencoes_page.descricaoPlaceholder')}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">{t('manutencoes_page.tipoIntervencao')}</span>
                  <select
                    className={eqStyles.input}
                    value={form.tipo_intervencao}
                    onChange={(e) => setForm((f) => ({ ...f, tipo_intervencao: e.target.value }))}
                  >
                    <option value="">{t('manutencoes_page.selecionarTipo')}</option>
                    {TIPOS_INTERVENCAO.map((tp) => (
                      <option key={tp} value={tp}>{tTipo(tp)}</option>
                    ))}
                  </select>
                </label>

                <label className={eqStyles.field}>
                  <span className="label">{t('manutencoes.performed')} *</span>
                  <input
                    type="datetime-local"
                    className={eqStyles.input}
                    value={form.data_realizada}
                    onChange={(e) => setForm((f) => ({ ...f, data_realizada: e.target.value }))}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">{t('manutencoes.next')}</span>
                  <input
                    type="datetime-local"
                    className={eqStyles.input}
                    value={form.proxima_data}
                    onChange={(e) => setForm((f) => ({ ...f, proxima_data: e.target.value }))}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">{t('manutencoes_page.custoLabel')}</span>
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
                  <span className="label">{t('manutencoes_page.referenciaSCPO')}</span>
                  <input
                    type="text"
                    className={eqStyles.input}
                    value={form.referencia_sc_po}
                    onChange={(e) => setForm((f) => ({ ...f, referencia_sc_po: e.target.value }))}
                    placeholder={t('manutencoes_page.referenciaSCPOPlaceholder')}
                  />
                </label>

                <label className={eqStyles.field}>
                  <span className="label">{t('manutencoes_page.fornecedor')}</span>
                  <input
                    type="text"
                    className={eqStyles.input}
                    value={formFornecedor}
                    onChange={(e) => setFormFornecedor(e.target.value)}
                    placeholder={t('manutencoes_page.fornecedorPlaceholder')}
                    list="mnt-fornecedores-list"
                  />
                  <datalist id="mnt-fornecedores-list">
                    {fornecedoresExistentes.map((f) => <option key={f} value={f} />)}
                  </datalist>
                </label>

                <label className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className="label">{t('manutencoes_page.observacoes')}</span>
                  <textarea
                    className={eqStyles.input}
                    rows={2}
                    style={{ resize: 'vertical' }}
                    value={form.observacoes_externas}
                    onChange={(e) => setForm((f) => ({ ...f, observacoes_externas: e.target.value }))}
                    placeholder={t('manutencoes_page.observacoesPlaceholder')}
                  />
                </label>

              </div>
            </div>

            {formErro && <div className={eqStyles.formErro}>{formErro}</div>}

            <div className={eqStyles.modalActions}>
              <button className={eqStyles.btnSecondary} onClick={closeModal} type="button">
                {t('common.cancel')}
              </button>
              <button
                className={eqStyles.btnPrimary}
                onClick={handleSubmit}
                disabled={saving}
                type="button"
              >
                {saving ? `${t('common.loading')}` : t('manutencoes.new')}
              </button>
            </div>

          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
