import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import ModalWrapper from '../components/ModalWrapper.jsx'
import styles from './Avarias.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'
import { fmtDateTime as fmt, fmtEur } from '../utils/dateFormat.js'

function PainelDistribuicaoAvarias({ avarias, equipMap, locale }) {
  const [expandido, setExpandido] = useState(() => {
    try { return localStorage.getItem('industrial-testing-lab_dist_avarias_expandido') !== 'false' } catch { return true }
  })

  const distribuicao = useMemo(() => {
    const mapa = {}
    for (const av of avarias) {
      const id = av.equipamento_id
      if (!mapa[id]) mapa[id] = { equipamento_id: id, total: 0, abertas: 0, resolvidas: 0, custo_total: 0 }
      mapa[id].total += 1
      if (av.resolvida) mapa[id].resolvidas += 1
      else mapa[id].abertas += 1
      mapa[id].custo_total += av.custo_reparacao ?? 0
    }
    return Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, 10)
  }, [avarias])

  const toggle = () => {
    setExpandido(v => {
      try { localStorage.setItem('industrial-testing-lab_dist_avarias_expandido', String(!v)) } catch {}
      return !v
    })
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
      <div
        onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--surface)', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Distribuição por Equipamento
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{expandido ? '▾ recolher' : '▸ expandir'}</span>
      </div>

      {expandido && (
        <div style={{ padding: '12px 16px', background: 'var(--bg)' }}>
          {distribuicao.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>Sem avarias registadas.</p>
          ) : (
            distribuicao.map(d => {
              const eq = equipMap[d.equipamento_id]
              const nome = eq?.nome ?? `EQ-${d.equipamento_id}`
              const pctAbertas = d.total > 0 ? (d.abertas / d.total) * 100 : 0
              const pctResolvidas = d.total > 0 ? (d.resolvidas / d.total) * 100 : 0
              return (
                <div key={d.equipamento_id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Link to={`/equipamentos/${d.equipamento_id}`} style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                      {nome}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {d.total} avaria{d.total !== 1 ? 's' : ''} · {d.abertas} abertas · {fmtEur(d.custo_total, locale)}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginTop: 4, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${pctAbertas}%`, background: '#dc2626', transition: 'width 0.3s' }} />
                    <div style={{ width: `${pctResolvidas}%`, background: '#10b981', transition: 'width 0.3s' }} />
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
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
  const [ficheiroAnexo, setFicheiroAnexo] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

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

  const handleExportPdf = useCallback(() => {
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
      let res
      if (ficheiroAnexo) {
        res = await api.resolverAvariaComAnexo(modal.id, { relatorioTecnico: relatorio, custo: custoNum, ficheiro: ficheiroAnexo })
      } else {
        res = await api.resolverAvaria(modal.id, { relatorioTecnico: relatorio, custo: custoNum })
      }
      setAvarias(prev => prev.map(a =>
        a.id === modal.id
          ? { ...a, resolvida: true, data_resolucao: new Date().toISOString(), notas_resolucao: relatorio || null, custo_reparacao: custoNum }
          : a
      ))
      if (res?.manutencao_criada) {
        toast.success(t('avarias.successResolveComManutencao'))
      } else {
        toast.success(t('avarias.successResolve'))
      }
      setSucesso(t('avarias.successResolve'))
      setTimeout(() => { setModal(null); setRelatorio(''); setCusto(''); setFicheiroAnexo(null); setSucesso('') }, 1200)
      carregar()
    } catch (e) {
      toast.error(e.message || t('avarias_page.erroResolver'))
    } finally {
      setSaving(false)
    }
  }, [modal, relatorio, custo, ficheiroAnexo, carregar, toast, t])

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
            <button className={styles.btnResolver} onClick={() => { setModal(av); setRelatorio(''); setCusto(''); setFicheiroAnexo(null) }}>
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
        <PageHeader
          categoria={t('avarias_page.subtituloHistorico')}
          titulo={t('avarias.title')}
          secondaryActionText={t('avarias_page.exportarPdf')}
          onSecondaryActionClick={handleExportPdf}
        />
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
          </div>
        </div>
      </div>

      <PainelDistribuicaoAvarias avarias={avarias} equipMap={equipamentos} locale={locale} />

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

      <ModalWrapper
        isOpen={!!modal}
        onClose={() => { setModal(null); setFicheiroAnexo(null); setIsDragging(false) }}
        categoria={modal ? t('avarias_page.modalLabel', { id: String(modal.id).padStart(3,'0') }) : ''}
        titulo={t('avarias.resolve')}
      >
        {modal && (
          <>
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
                <div className={styles.fieldLabel} style={{ marginTop: 10 }}>
                  <span className="label">Anexo (opcional)</span>
                  {ficheiroAnexo ? (
                    <div className={styles.fileBadge}>
                      <svg className={styles.fileBadgeIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <div className={styles.fileBadgeInfo}>
                        <span className={styles.fileBadgeName}>{ficheiroAnexo.name}</span>
                        <span className={styles.fileBadgeSize}>{(ficheiroAnexo.size / 1024).toFixed(1)} KB</span>
                      </div>
                      <button
                        type="button"
                        className={styles.fileBadgeRemove}
                        onClick={() => setFicheiroAnexo(null)}
                        title="Remover ficheiro"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
                      onDragEnter={e => { e.preventDefault(); setIsDragging(true) }}
                      onDragLeave={e => { e.preventDefault(); setIsDragging(false) }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        setIsDragging(false)
                        const file = e.dataTransfer.files[0]
                        if (file) setFicheiroAnexo(file)
                      }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        className={styles.hiddenInput}
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={e => {
                          const file = e.target.files[0]
                          if (file) setFicheiroAnexo(file)
                          e.target.value = ''
                        }}
                      />
                      <div className={styles.dropzoneIcon}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                      </div>
                      <p className={styles.dropzoneText}>Clique para carregar ou arraste o ficheiro</p>
                      <p className={styles.dropzoneHint}>PDF, PNG, JPG</p>
                    </div>
                  )}
                </div>

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
          </>
        )}
      </ModalWrapper>
    </div>
  )
}
