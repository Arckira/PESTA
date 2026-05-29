import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './Avarias.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'

function fmt(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Avarias() {
  const toast = useToast()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const { map: equipamentos, loading: eqLoading } = useEquipamentos()
  const [avarias, setAvarias] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('abertas')
  const [pesquisa, setPesquisa] = useState('')

  const [modal, setModal] = useState(null)
  const [relatorio, setRelatorio] = useState('')
  const [custo, setCusto] = useState('')
  const [saving, setSaving] = useState(false)
  const [sucesso, setSucesso] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const resolvida = filtro === 'abertas' ? false : filtro === 'resolvidas' ? true : undefined
      const av = await api.listarTodasAvarias(resolvida)
      setAvarias(av)
    } catch (e) {
      toast.error(`${t('avarias.errorLoad')}: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [filtro, toast, t])

  useEffect(() => { carregar() }, [carregar])

  const navigate = useNavigate()
  const pesquisaLower = pesquisa.trim().toLowerCase()
  const avariasFiltradas = useMemo(() => {
    if (!pesquisaLower) return avarias

    return avarias.filter(a => {
      const eq = equipamentos[a.equipamento_id]
      const haystack = [
        String(a.id),
        eq?.nome,
        a.descricao,
        a.empresa_externa,
        a.num_sc_po,
        a.resolvida ? 'resolvida' : 'aberta',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(pesquisaLower)
    })
  }, [avarias, equipamentos, pesquisaLower])

  const handleExport = useCallback(() => {
    if (!avariasFiltradas || avariasFiltradas.length === 0) return

    const resolvida = filtro === 'abertas' ? false : filtro === 'resolvidas' ? true : undefined
    api.exportarAvariasPdf({ resolvida, pesquisa })
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
        a.href = url
        a.download = `avarias-${stamp}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast.success(t('avarias_page.pdfExportado'))
      })
      .catch((e) => {
        toast.error(e.message || t('avarias_page.erroPdf'))
      })
  }, [avariasFiltradas, filtro, pesquisa, toast])

  const handleResolver = useCallback(async () => {
    if (!modal) return
    setSaving(true)
    try {
      const custoNum = custo !== '' ? parseFloat(custo) : null
      await api.resolverAvaria(modal.id, { relatorioTecnico: relatorio, custo: custoNum })
      setAvarias(prev => prev.map(a =>
        a.id === modal.id
          ? { ...a, resolvida: true, data_resolucao: new Date().toISOString(), notas_resolucao: relatorio || null, custo_reparacao: custoNum }
          : a
      ))
      toast.success(t('avarias.successResolve'))
      setSucesso(t('avarias.successResolve'))
      setTimeout(() => { setModal(null); setRelatorio(''); setCusto(''); setSucesso('') }, 1200)
      carregar()
    } catch (e) {
      toast.error(e.message || t('avarias_page.erroResolver'))
    } finally {
      setSaving(false)
    }
  }, [modal, relatorio, custo, carregar, toast, t])

  const abertas   = avarias.filter(a => !a.resolvida).length
  const resolvidas = avarias.filter(a => a.resolvida).length

  const loadingPage = loading || eqLoading

  const renderRow = useCallback((av) => {
    const eq = equipamentos[av.equipamento_id]
    return (
      <tr key={av.id} className={av.resolvida ? styles.rowResolvida : styles.rowAberta}>
        <td className="mono" style={{ color: 'var(--text-dim)' }}>{String(av.id).padStart(3,'0')}</td>
        <td>
          {eq ? (
            <Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>
          ) : `EQ-${av.equipamento_id}`}
        </td>
        <td className={styles.descricao}>{av.descricao === 'Avaria detetada via alteração de estado' ? t('avarias_page.mensagens.avariaAutomatica') : av.descricao}</td>
        <td style={{ color: av.empresa_externa ? 'inherit' : 'var(--text-dim)' }}>
          {av.empresa_externa || '—'}
        </td>
        <td className="mono" style={{ color: av.custo_reparacao ? 'var(--text-primary)' : 'var(--text-dim)' }}>
          {av.custo_reparacao ? `${av.custo_reparacao.toFixed(2)}€` : '—'}
        </td>
        <td className="mono" style={{ fontSize: 11, color: av.num_sc_po ? 'inherit' : 'var(--text-dim)' }}>
          {av.num_sc_po || '—'}
        </td>
        <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_registo, locale)}</td>
        <td>
          <StatusBadge variant={av.resolvida ? 'success' : 'danger'}>{av.resolvida ? t('avarias.resolved') : t('avarias.open')}</StatusBadge>
        </td>
        <td className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(av.data_resolucao, locale)}</td>
        <td>
          {!av.resolvida && (
            <button className={styles.btnResolver} onClick={() => { setModal(av); setRelatorio(''); setCusto('') }}>
              {t('avarias.resolve')}
            </button>
          )}
        </td>
      </tr>
    )
  }, [equipamentos, locale, t])

  return (
    <div className="fade-up">
      <div className={styles.header}>
        <div>
          <div className="label">{t('avarias_page.subtituloHistorico')}</div>
          <h1 className={styles.title}>{t('avarias.title')}</h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.pills}>
            {[['abertas', t('avarias.open'), abertas], ['resolvidas', t('avarias.resolved'), resolvidas], ['todas', t('avarias.all'), avarias.length]].map(([val, label, count]) => (
              <button
                key={val}
                className={`${styles.pill} ${filtro === val ? styles.pillActive : ''}`}
                onClick={() => setFiltro(val)}
              >
                {label} <span className={styles.pillCount}>{count}</span>
              </button>
            ))}
          </div>

          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder={t('common.search')}
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
            />
            <button
              type="button"
              className={styles.btnExport}
              disabled={avariasFiltradas.length === 0}
              onClick={handleExport}
            >
              {t('avarias_page.exportarPdf')}
            </button>
          </div>
        </div>
      </div>

      {loadingPage && <div className={styles.empty}>{t('common.loading')}</div>}

      {!loadingPage && (
        <ResourceTable
          columns={[ '#', t('common.equipment'), t('common.description'), t('avarias_page.empresa'), t('avarias_page.custo'), t('avarias_page.scPo'), t('avarias.reportedAt'), t('common.status'), t('avarias.resolvedAt'), '' ]}
          items={avariasFiltradas}
          renderRow={renderRow}
          loading={false}
          emptyNode={(
            <EmptyState
              variant={avarias.length === 0 ? 'positive' : 'neutral'}
              icon="◎"
              title={
                avarias.length === 0
                  ? t('avarias_page.semAvariasTitle')
                  : t('avarias_page.semResultadosTitle')
              }
              subtitle={
                avarias.length === 0
                  ? t('avarias_page.semAvariasSub')
                  : t('avarias_page.semResultadosSub')
              }
              buttonText={avarias.length === 0 ? t('avarias_page.verEquipamentos') : t('avarias_page.limparPesquisa')}
              onButtonClick={() => {
                if (avarias.length === 0) navigate('/equipamentos')
                else setPesquisa('')
              }}
            />
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      {modal && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 6 }}>{t('avarias_page.modalLabel', { id: String(modal.id).padStart(3,'0') })}</div>
            <h2 className={styles.modalTitle}>{t('avarias.resolve')}</h2>
            <div className={styles.modalDesc}>{modal.descricao}</div>

            {sucesso ? (
              <div className={styles.sucesso}>{sucesso}</div>
            ) : (
              <>
                <label className={styles.fieldLabel}>
                  <span className="label">{t('avarias_page.relatorioTecnico')}</span>
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    placeholder={t('avarias_page.relatorioPlaceholder')}
                    value={relatorio}
                    onChange={e => setRelatorio(e.target.value)}
                  />
                </label>
                <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
                  <span className="label">{t('avarias_page.custoReparacao')}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={styles.textarea}
                    style={{ rows: undefined, height: 36, padding: '0 10px' }}
                    placeholder="0.00"
                    value={custo}
                    onChange={e => setCusto(e.target.value)}
                  />
                </label>
                <p className={styles.aviso}>
                  {t('avarias_page.avisoAutoPre')}<strong>{t('status.disponivel')}</strong>{t('avarias_page.avisoAutoPost')}
                </p>
              </>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal(null)}>{t('common.cancel')}</button>
              {!sucesso && (
                <button className={styles.btnGreen} onClick={handleResolver} disabled={saving}>
                  {saving ? t('avarias_page.aResolver') : `✓ ${t('avarias.resolveConfirm')}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
