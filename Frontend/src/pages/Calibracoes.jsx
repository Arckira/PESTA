import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import ModalWrapper from '../components/ModalWrapper.jsx'
import styles from './Calibracoes.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'

function fmt(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

function diasRestantes(dt) {
  if (!dt) return null
  return Math.ceil((new Date(dt) - new Date()) / (1000 * 60 * 60 * 24))
}

const EMPTY = { data_realizada: '', proxima_data: '', certificado_url: '' }

export default function Calibracoes() {
  const toast = useToast()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const { map: equipamentos, list: equipamentosList, loading: eqLoading, reload: reloadEquipamentos } = useEquipamentos()

  const [calibracoes, setCalibracoes] = useState([])
  const [proximas, setProximas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [eqSel, setEqSel] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErro, setFormErro] = useState('')
  const [formFornecedor, setFormFornecedor] = useState('')
  const [formCusto, setFormCusto] = useState('')

  const fornecedoresExistentes = useMemo(
    () => [...new Set(calibracoes.map((c) => c.fornecedor).filter(Boolean))],
    [calibracoes],
  )
  const [pesquisa, setPesquisa] = useState('')
  const [filtroUrgencia, setFiltroUrgencia] = useState('todas')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [cal, prox] = await Promise.all([
        api.listarTodasCalibracoes(),
        api.calibracoesProximas(30),
      ])
      setCalibracoes(cal)
      setProximas(prox)
      if (equipamentosList.length > 0 && !eqSel) setEqSel(String(equipamentosList[0].id))
    } catch (e) {
      toast.error(`${t('calibracoes.errorLoad')}: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [equipamentosList, eqSel, toast, t])

  useEffect(() => { carregar() }, [carregar])

  const pesquisaLower = pesquisa.trim().toLowerCase()

  const calibracoesFiltradas = useMemo(() => {
    return calibracoes.filter(cal => {
      const eq = equipamentos[cal.equipamento_id]
      const dias = diasRestantes(cal.proxima_data)
      const vencida = dias !== null && dias < 0
      const urgente = dias !== null && dias >= 0 && dias <= 30
      const ok = dias !== null && dias > 30

      const matchUrgencia =
        filtroUrgencia === 'todas' ||
        (filtroUrgencia === 'vencidas' && vencida) ||
        (filtroUrgencia === 'urgentes' && urgente) ||
        (filtroUrgencia === 'ok' && ok)

      if (!matchUrgencia) return false

      if (!pesquisaLower) return true

      const haystack = [
        String(cal.id),
        eq?.nome,
        cal.proxima_data,
        cal.certificado_url,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(pesquisaLower)
    })
  }, [calibracoes, equipamentos, pesquisaLower, filtroUrgencia])

  const fmtCsv = useCallback((dt) => {
    if (!dt) return ''
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }, [])

  const handleExportPdf = useCallback(async () => {
    try {
      const urgencia = filtroUrgencia === 'todas' ? '' : filtroUrgencia
      const blob = await api.exportarCalibracesPdf({ filtro: pesquisa, urgencia })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `calibrações_${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(t('calibracoes_page.pdfExportado'))
    } catch (e) {
      toast.error(t('calibracoes_page.erroPdf', { msg: e.message }))
    }
  }, [pesquisa, filtroUrgencia, toast])

  const handleSubmit = useCallback(async () => {
    if (!eqSel || !form.data_realizada) {
      setFormErro(t('calibracoes_page.erroCamposObrigatorios'))
      toast.error(t('calibracoes_page.erroCamposObrigatoriosToast'))
      return
    }
    setSaving(true)
    setFormErro('')
    try {
      const payload = {
        data_realizada: new Date(form.data_realizada).toISOString(),
        proxima_data: form.proxima_data ? new Date(form.proxima_data).toISOString() : null,
        certificado_url: form.certificado_url || null,
        fornecedor: formFornecedor || null,
        custo_eur: formCusto ? parseFloat(formCusto) : null,
      }
      await api.registarCalibracao(eqSel, payload)
      toast.success(t('calibracoes.successCreate'))
      setModal(false)
      setForm(EMPTY)
      setFormFornecedor('')
      setFormCusto('')
      carregar()
      reloadEquipamentos()
    } catch (e) {
      setFormErro(e.message)
      toast.error(e.message || t('calibracoes_page.erroRegistar'))
    } finally {
      setSaving(false)
    }
  }, [eqSel, form, formFornecedor, formCusto, carregar, reloadEquipamentos, toast, t])

  const loadingPage = loading || eqLoading

  const renderRow = useCallback((cal) => {
    const eq = equipamentos[cal.equipamento_id]
    const dias = diasRestantes(cal.proxima_data)
    const vencida = dias !== null && dias < 0
    const urgente = dias !== null && dias >= 0 && dias <= 30

    return (
      <tr key={cal.id}>
        <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(cal.id).padStart(3,'0')}</td>
        <td>
          {eq
            ? <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
            : `EQ-${cal.equipamento_id}`
          }
        </td>
        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(cal.data_realizada, locale)}</td>
        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(cal.proxima_data, locale)}</td>
        <td>
          {dias !== null ? (
            <StatusBadge variant={vencida ? 'danger' : urgente ? 'occupied' : 'success'}>
              {vencida
                ? t('calibracoes_page.overdueHa', { dias: Math.abs(dias) })
                : urgente
                  ? t('calibracoes_page.aVencerEm', { dias })
                  : t('calibracoes_page.emDiaDias', { dias })}
            </StatusBadge>
          ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>
        <td>
          {cal.certificado_url
            ? <a href={cal.certificado_url} target="_blank" rel="noreferrer" className={styles.certLink}>Ver →</a>
            : <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
          }
        </td>
      </tr>
    )
  }, [equipamentos, locale, t])

  return (
    <div className="fade-up">
      <PageHeader
        categoria={t('calibracoes_page.subtitulo')}
        titulo={t('calibracoes.title')}
        secondaryActionText={t('calibracoes_page.exportarPdf')}
        onSecondaryActionClick={handleExportPdf}
        actionText={t('calibracoes.new')}
        onActionClick={() => setModal(true)}
      />

      {proximas.length > 0 && (
        <div className={styles.alerta}>
          <span className={styles.alertaIcon}>◎</span>
          <div>
            <strong>{t('calibracoes_page.alertaBannerCount', { count: proximas.length })}</strong>{t('calibracoes_page.alertaBannerSufixo')}
            {proximas.map(c => {
              const eq = equipamentos[c.equipamento_id]
              const dias = diasRestantes(c.proxima_data)
              return (
                <span key={c.id} className={styles.alertaItem}>
                  {eq && <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>}
                  <span className="mono" style={{ fontSize: 11 }}>
                    {dias <= 0 ? ` — ${t('calibracoes_page.vencida')}` : ` — ${dias}d`}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder={t('common.search')}
          value={pesquisa}
          onChange={(e) => setPesquisa(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroUrgencia}
          onChange={(e) => setFiltroUrgencia(e.target.value)}
        >
          <option value="todas">{t('calibracoes_page.todasUrgencias')}</option>
          <option value="vencidas">{t('calibracoes_page.vencidas')}</option>
          <option value="urgentes">{t('calibracoes_page.aVencer30')}</option>
          <option value="ok">{t('calibracoes_page.emDia')}</option>
        </select>
      </div>

      {loadingPage && <div className={styles.empty}>{t('common.loading')}</div>}

      {!loadingPage && (
        <ResourceTable
          columns={[ '#', t('common.equipment'), t('calibracoes.calibratedAt'), t('calibracoes.nextCalibration'), t('calibracoes_page.diasRestantes'), t('calibracoes.certificate') ]}
          items={calibracoesFiltradas}
          renderRow={renderRow}
          loading={false}
          emptyNode={(
            <EmptyState
              variant={calibracoes.length === 0 ? 'positive' : 'neutral'}
              icon="◎"
              title={
                calibracoes.length === 0
                  ? t('calibracoes_page.semCalibracoes')
                  : t('calibracoes_page.semResultados')
              }
              subtitle={
                calibracoes.length === 0
                  ? t('calibracoes_page.semCalibracoesSub')
                  : t('calibracoes_page.semResultadosSub')
              }
              buttonText={calibracoes.length === 0 ? `+ ${t('calibracoes.new')}` : t('calibracoes_page.limparFiltros')}
              onButtonClick={() => {
                if (calibracoes.length === 0) setModal(true)
                else {
                  setPesquisa('')
                  setFiltroUrgencia('todas')
                }
              }}
            />
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      <ModalWrapper
        isOpen={modal}
        onClose={() => { setModal(false); setFormErro('') }}
        categoria={t('calibracoes.title')}
        titulo={t('calibracoes.new')}
      >
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className="label">{t('common.equipment')} *</span>
            <select className={styles.input} value={eqSel} onChange={e => setEqSel(e.target.value)}>
              {Object.values(equipamentos).map(eq => (
                <option key={eq.id} value={eq.id}>{eq.nome}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className="label">{t('calibracoes.calibratedAt')} *</span>
            <input type="datetime-local" className={styles.input} value={form.data_realizada}
              onChange={e => setForm(f => ({ ...f, data_realizada: e.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className="label">{t('calibracoes.nextCalibration')} (opcional)</span>
            <input type="datetime-local" className={styles.input} value={form.proxima_data}
              onChange={e => setForm(f => ({ ...f, proxima_data: e.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className="label">{t('calibracoes_page.urlCertificado')}</span>
            <input type="url" className={styles.input} value={form.certificado_url}
              onChange={e => setForm(f => ({ ...f, certificado_url: e.target.value }))}
              placeholder="https://..." />
          </label>
          <label className={styles.field}>
            <span className="label">{t('calibracoes_page.fornecedor')}</span>
            <input
              type="text"
              className={styles.input}
              value={formFornecedor}
              onChange={(e) => setFormFornecedor(e.target.value)}
              placeholder={t('calibracoes_page.fornecedorPlaceholder')}
              list="cal-fornecedores-list"
            />
            <datalist id="cal-fornecedores-list">
              {fornecedoresExistentes.map((f) => <option key={f} value={f} />)}
            </datalist>
          </label>
          <label className={styles.field}>
            <span className="label">{t('calibracoes_page.custo')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className={styles.input}
              value={formCusto}
              onChange={(e) => setFormCusto(e.target.value)}
              placeholder={t('calibracoes_page.custoPlaceholder')}
            />
          </label>
        </div>

        {formErro && <div className={styles.formErro}>{formErro}</div>}

        <div className={styles.modalActions}>
          <button className={styles.btnSecondary} onClick={() => { setModal(false); setFormErro('') }}>{t('common.cancel')}</button>
          <button className={styles.btnPrimary} onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </ModalWrapper>
    </div>
  )
}
