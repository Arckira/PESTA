import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import { useToast } from '../components/ToastProvider.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import ModalWrapper from '../components/ModalWrapper.jsx'
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

const TIPOS_INTERVENCAO = ['Preventiva', 'Corretiva', 'Diagnóstico', 'Reparação', 'Reparação Externa', 'Outro']

function PainelFinanceiroManutencoes({ t, locale, onFiltrarFornecedor }) {
  const anoAtual = new Date().getFullYear()

  const [dados, setDados] = useState(null)
  const [loadingPainel, setLoadingPainel] = useState(true)
  const [expandido, setExpandido] = useState(() => {
    try { return localStorage.getItem('lab_painel_fin_expandido') !== 'false' }
    catch { return true }
  })
  const [mesSel, setMesSel] = useState(0)
  const LABELS_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

  useEffect(() => {
    setLoadingPainel(true)
    api.resumoFinanceiro({ ano: anoAtual, mes: mesSel || undefined })
      .then(setDados)
      .catch(() => {})
      .finally(() => setLoadingPainel(false))
  }, [mesSel])

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={mesSel}
            onChange={e => setMesSel(Number(e.target.value))}
            style={{ fontSize: 12, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
          >
            <option value={0}>Todos os meses</option>
            {LABELS_MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <button
            type="button"
            onClick={toggleExpandido}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}
          >
            {expandido ? '▾ recolher' : '▸ Resumo Financeiro'}
          </button>
        </div>
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

          {dados?.por_mes?.some(m => m.total_eur > 0) && (() => {
            const maxVal = Math.max(...dados.por_mes.map(x => x.total_eur), 1)
            const slot = 520 / 12
            const bw = 26
            return (
              <svg viewBox="0 0 520 72" style={{ width: '100%', display: 'block', marginBottom: 12 }}>
                {dados.por_mes.map((m, i) => {
                  const cx = i * slot + slot / 2
                  const bh = Math.max(m.total_eur > 0 ? 3 : 0, (m.total_eur / maxVal) * 52)
                  const by = 53 - bh
                  const dimmed = mesSel > 0 && mesSel !== m.mes
                  return (
                    <g key={m.mes} style={{ cursor: 'pointer' }} onClick={() => setMesSel(mesSel === m.mes ? 0 : m.mes)}>
                      <rect x={cx - bw / 2} y={by} width={bw} height={bh || 0}
                        fill="var(--accent)" opacity={dimmed ? 0.25 : 1} rx={2}>
                        <title>{fmtEur(m.total_eur)}</title>
                      </rect>
                      <text x={cx} y={70} textAnchor="middle" fontSize={9}
                        fill="var(--text-dim)" opacity={dimmed ? 0.45 : 1}>
                        {LABELS_MESES[i]}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )
          })()}

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
                  <div
                    key={f.fornecedor ?? f.nome}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, cursor: onFiltrarFornecedor ? 'pointer' : 'default' }}
                    onClick={() => onFiltrarFornecedor?.(f.fornecedor ?? f.nome)}
                  >
                    <span style={{ color: onFiltrarFornecedor ? 'var(--accent)' : 'var(--text)' }}>{f.fornecedor ?? f.nome}</span>
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

function PainelFornecedores({ manutencoes, equipMap, setFiltro, locale }) {
  const [expandido, setExpandido] = useState(() => {
    try { return localStorage.getItem('lab_fornecedores_expandido') !== 'false' } catch { return true }
  })

  const analise = useMemo(() => {
    const mapa = {}
    for (const mn of manutencoes) {
      const nomeEq = equipMap[mn.equipamento_id]?.nome ?? ''
      const chave = nomeEq.split(/\s+/)[0] || '?'
      if (!mapa[chave]) mapa[chave] = { nome: chave, n_intervencoes: 0, custo_total: 0, tipos: new Set(), ultima_intervencao: null, equipamentos_ids: new Set() }
      mapa[chave].n_intervencoes += 1
      mapa[chave].custo_total += mn.custo_eur ?? 0
      if (mn.tipo_intervencao) mapa[chave].tipos.add(mn.tipo_intervencao)
      if (mn.data_realizada) {
        const d = new Date(mn.data_realizada)
        if (!mapa[chave].ultima_intervencao || d > mapa[chave].ultima_intervencao) mapa[chave].ultima_intervencao = d
      }
      mapa[chave].equipamentos_ids.add(mn.equipamento_id)
    }
    return Object.values(mapa).sort((a, b) => b.custo_total - a.custo_total)
  }, [manutencoes, equipMap])

  const toggle = () => {
    setExpandido(v => {
      try { localStorage.setItem('lab_fornecedores_expandido', String(!v)) } catch {}
      return !v
    })
  }

  const fmtEur = (v) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(v ?? 0)
  const fmtData = (d) => d ? new Date(d).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const totalCusto = analise.reduce((s, r) => s + r.custo_total, 0)
  const totalIntervencoes = analise.reduce((s, r) => s + r.n_intervencoes, 0)

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
      <div
        onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--surface)', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Análise por Fornecedor</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{expandido ? '▾ recolher' : '▸ expandir'}</span>
      </div>

      {expandido && (
        <div style={{ padding: '12px 16px', background: 'var(--bg)' }}>
          {analise.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>Sem dados de fornecedores.</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Fornecedor', 'Intervenções', 'Custo Total', 'Tipos', 'Últ. Intervenção', 'Equipamentos', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', paddingBottom: 6, paddingRight: 12, borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analise.map(row => {
                    const tipos = [...row.tipos]
                    const tiposVisiveis = tipos.slice(0, 2)
                    const tiposExtra = tipos.length - 2
                    return (
                      <tr key={row.nome} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px 8px 0', color: 'var(--text)' }}>{row.nome}</td>
                        <td style={{ padding: '8px 12px 8px 0', fontWeight: 600, color: 'var(--accent)' }}>{row.n_intervencoes}</td>
                        <td style={{ padding: '8px 12px 8px 0' }}>{fmtEur(row.custo_total)}</td>
                        <td style={{ padding: '8px 12px 8px 0' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {tiposVisiveis.map(tp => (
                              <span key={tp} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>{tp}</span>
                            ))}
                            {tiposExtra > 0 && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>+{tiposExtra}</span>}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px 8px 0', fontSize: 12, color: 'var(--text-secondary)' }}>{fmtData(row.ultima_intervencao)}</td>
                        <td style={{ padding: '8px 12px 8px 0', fontSize: 12 }}>{row.equipamentos_ids.size}</td>
                        <td style={{ padding: '8px 0' }}>
                          <button
                              type="button"
                              onClick={() => setFiltro(row.nome)}
                              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                            >
                              Filtrar
                            </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'right', paddingTop: 6 }}>
                Total: {fmtEur(totalCusto)} · {totalIntervencoes} intervenções
              </div>
            </>
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
  const [fornecedores, setFornecedores] = useState([])
  const [fornecedorSelId, setFornecedorSelId] = useState('')
  const [novoFornNome, setNovoFornNome] = useState('')
  const [criandoForn, setCriandoForn] = useState(false)
  const [ficheiroAnexo, setFicheiroAnexo] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

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

  useEffect(() => {
    api.listarFornecedores().then(data => setFornecedores(data)).catch(() => {})
  }, [])

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
    setFornecedorSelId('')
    setNovoFornNome('')
    setFicheiroAnexo(null)
    setIsDragging(false)
    setModal(true)
  }

  const closeModal = () => {
    setModal(false)
    setFormErro('')
    setFicheiroAnexo(null)
    setIsDragging(false)
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
        fornecedor: fornecedores.find(f => String(f.id) === fornecedorSelId)?.nome || null,
        fornecedor_id: fornecedorSelId && fornecedorSelId !== '__novo__' ? Number(fornecedorSelId) : null,
      }
      await api.registarManutencao(eqSel, payload, ficheiroAnexo || null)
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
      <PageHeader
        categoria={t('manutencoes_page.subtitulo')}
        titulo={t('manutencoes.title')}
        secondaryActionText={t('manutencoes_page.exportarPdf')}
        onSecondaryActionClick={handleExportPdf}
        actionText={t('manutencoes.new')}
        onActionClick={openModal}
      />

      <PainelFinanceiroManutencoes t={t} locale={locale} onFiltrarFornecedor={(nome) => setFiltro(nome)} />

      <PainelFornecedores manutencoes={manutencoes} equipMap={equipamentos} setFiltro={setFiltro} locale={locale} />

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

      <ModalWrapper
        isOpen={modal}
        onClose={closeModal}
        categoria={t('manutencoes_page.modalLabel')}
        titulo={t('manutencoes.new')}
        wide
      >
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
              {fornecedorSelId === '__novo__' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    className={eqStyles.input}
                    style={{ flex: 1 }}
                    value={novoFornNome}
                    onChange={e => setNovoFornNome(e.target.value)}
                    placeholder="Nome do fornecedor"
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    style={{ whiteSpace: 'nowrap' }}
                    disabled={!novoFornNome.trim() || criandoForn}
                    onClick={async () => {
                      if (!novoFornNome.trim()) return
                      setCriandoForn(true)
                      try {
                        const criado = await api.criarFornecedor({ nome: novoFornNome.trim() })
                        setFornecedores(prev => [...prev, criado].sort((a, b) => a.nome.localeCompare(b.nome)))
                        setFornecedorSelId(String(criado.id))
                        setNovoFornNome('')
                      } catch (e) {
                        toast.error(e.message || 'Erro ao criar fornecedor')
                      } finally {
                        setCriandoForn(false)
                      }
                    }}
                  >
                    {criandoForn ? '…' : 'Criar'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => { setFornecedorSelId(''); setNovoFornNome('') }}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <select
                  className={eqStyles.input}
                  value={fornecedorSelId}
                  onChange={e => setFornecedorSelId(e.target.value)}
                >
                  <option value="">— Sem fornecedor —</option>
                  {fornecedores.map(f => (
                    <option key={f.id} value={String(f.id)}>{f.nome}</option>
                  ))}
                  <option value="__novo__">＋ Novo fornecedor…</option>
                </select>
              )}
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

            <div className={eqStyles.field} style={{ gridColumn: '1 / -1' }}>
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
      </ModalWrapper>
    </div>
  )
}
