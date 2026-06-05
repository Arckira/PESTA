import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.js'
import EmptyState from '../components/EmptyState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import ResourceTable from '../components/ResourceTable.jsx'
import ModalWrapper from '../components/ModalWrapper.jsx'
import styles from './Verificacoes.module.css'
import { useEquipamentos } from '../hooks/useEquipamentos.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'

function fmt(dt, locale = 'pt-PT') {
  if (!dt) return '—'
  return new Date(dt).toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const EXTENSOES_PERMITIDAS = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx']
const TOKEN_KEY = 'lab_auth_token'

function AnexosPanel({ verificacaoId, t }) {
  const [anexos, setAnexos] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const inputRef = useRef(null)

  const fetchAnexos = useCallback(async () => {
    try {
      const token = localStorage.getItem(TOKEN_KEY) || ''
      const res = await fetch(`/api/verificacoes/${verificacaoId}/anexos`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      setAnexos(await res.json())
    } catch {
      // silencia — endpoint pode não estar acessível
    }
  }, [verificacaoId])

  useEffect(() => { fetchAnexos() }, [fetchAnexos])

  const handleFicheiro = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!e.target) return
    e.target.value = ''
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!EXTENSOES_PERMITIDAS.includes(ext)) {
      setErro(t('verificacoes.extInvalida') || 'Extensão não permitida.')
      return
    }
    setErro(null)
    setCarregando(true)
    try {
      const token = localStorage.getItem(TOKEN_KEY) || ''
      const form = new FormData()
      form.append('ficheiro', file)
      const res = await fetch(`/api/verificacoes/${verificacaoId}/anexo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) throw new Error()
      await fetchAnexos()
    } catch {
      setErro(t('verificacoes.erroUpload') || 'Não foi possível carregar o ficheiro.')
    } finally {
      setCarregando(false)
    }
  }, [verificacaoId, fetchAnexos, t])

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{t('verificacoes.anexos') || 'Anexos'}</strong>
        <button
          type="button"
          disabled={carregando}
          onClick={() => inputRef.current?.click()}
          style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 6,
            background: 'var(--accent, #6366f1)', color: '#fff',
            border: 'none', cursor: carregando ? 'not-allowed' : 'pointer',
            opacity: carregando ? 0.7 : 1,
          }}
        >
          {carregando
            ? (t('verificacoes.aCarregarFicheiro') || 'A carregar ficheiro…')
            : (t('verificacoes.adicionarFicheiro') || 'Adicionar Ficheiro')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
          style={{ display: 'none' }}
          onChange={handleFicheiro}
        />
      </div>
      {erro && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 6 }}>{erro}</div>}
      {anexos.length === 0 ? (
        <div style={{ color: 'var(--text-dim, #888)', fontSize: 12 }}>
          {t('verificacoes.semAnexos') || 'Sem anexos.'}
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {anexos.map((a) => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {a.nome_original}
              </span>
              <a
                href={`/api/verificacoes/anexos/${a.id}/download`}
                download={a.nome_original}
                style={{ fontSize: 12, color: 'var(--accent, #6366f1)', textDecoration: 'none' }}
              >
                {t('verificacoes.download') || 'Descarregar'}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ViewModal({ view, eqMap, locale, t, onClose, styles }) {
  return (
    <ModalWrapper
      isOpen={!!view}
      onClose={onClose}
      categoria={`#${String(view.id).slice(-6)}`}
      titulo={view.pass ? t('verificacoes.conform') : t('verificacoes.nonConform')}
    >
      <div className={styles.modalDesc}>
        <div><strong>{t('common.date')}:</strong> {fmt(view.data, locale)}</div>
        <div><strong>{t('common.equipment')}:</strong> {eqMap[view.equipamento_id]?.nome || '—'}</div>
        <div><strong>{t('verificacoes.technician')}:</strong> {view.tecnico}</div>
        <div style={{ marginTop: 8 }}><strong>{t('common.notes')}:</strong><div style={{ marginTop: 6 }}>{view.notas || '—'}</div></div>
      </div>
      {view.id && typeof view.id === 'number' && (
        <AnexosPanel verificacaoId={view.id} t={t} />
      )}
      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onClose}>{t('common.close')}</button>
      </div>
    </ModalWrapper>
  )
}

export default function Verificacoes() {
  const { list: equipamentos, map: eqMap, loading: eqLoading } = useEquipamentos()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'

  const [verificacoes, setVerificacoes] = useState([])
  const [loading] = useState(false)

  const [filtro, setFiltro] = useState('')
  const [filtroResultado, setFiltroResultado] = useState('Todos')

  const [openModal, setOpenModal] = useState(false)
  const [formEq, setFormEq] = useState('')
  const [formData, setFormData] = useState(() => new Date().toISOString().slice(0, 10))
  const [formNotas, setFormNotas] = useState('')
  const [formPass, setFormPass] = useState(true)

  const [view, setView] = useState(null)

  const verificacoesFiltradas = useMemo(() => {
    return verificacoes.filter((v) => {
      const eq = eqMap[v.equipamento_id]
      const nomeEq = eq ? eq.nome : `EQ-${v.equipamento_id}`
      const matchTexto = nomeEq.toLowerCase().includes(filtro.toLowerCase()) || v.tecnico.toLowerCase().includes(filtro.toLowerCase()) || v.notas.toLowerCase().includes(filtro.toLowerCase())
      const matchResultado = filtroResultado === 'Todos' || (filtroResultado === 'Conforme' && v.pass) || (filtroResultado === 'Não Conforme' && !v.pass)
      return matchTexto && matchResultado
    })
  }, [verificacoes, eqMap, filtro, filtroResultado])

  const handleExportPdf = useCallback(async () => {
    try {
      const resultado = filtroResultado === 'Todos' ? '' : (filtroResultado === 'Conforme' ? 'pass' : 'fail')
      const blob = await api.exportarVerificacoesPdf({ filtro, resultado })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `verificações_${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      // PDF export não disponível
    }
  }, [filtro, filtroResultado])

  const handleSubmit = useCallback((e) => {
    e?.preventDefault()
    const nova = {
      id: Date.now(),
      data: new Date(formData).toISOString(),
      equipamento_id: formEq || null,
      tecnico: user ? `${user.nome || user.username || user.id}` : '—',
      notas: formNotas,
      pass: Boolean(formPass),
    }
    setVerificacoes(prev => [nova, ...prev])
    setOpenModal(false)
    setFormEq('')
    setFormNotas('')
    setFormPass(true)
  }, [formData, formEq, formNotas, formPass, user])

  const renderRow = useCallback((v) => {
    const eq = eqMap[v.equipamento_id]
    return (
      <tr key={v.id} className={v.pass ? styles.rowPass : styles.rowFail}>
        <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmt(v.data, locale)}</td>
        <td>{eq ? (<Link to={`/equipamentos/${eq.id}`} className={styles.eqLink}>{eq.nome}</Link>) : '—'}</td>
        <td style={{ color: 'var(--text-secondary)' }}>{v.tecnico}</td>
        <td>
          <StatusBadge variant={v.pass ? 'success' : 'danger'}>
            {v.pass ? t('verificacoes.conform') : t('verificacoes.nonConform')}
          </StatusBadge>
        </td>
        <td>
          <button className={styles.btnSecondary} onClick={() => setView(v)}>{t('verificacoes.details')}</button>
        </td>
      </tr>
    )
  }, [eqMap, locale, t])

  return (
    <div className="fade-up">
      <PageHeader
        categoria={t('verificacoes_page.subtitulo')}
        titulo={t('verificacoes.title')}
        secondaryActionText={t('common.exportCsv')}
        onSecondaryActionClick={handleExportPdf}
        actionText={t('verificacoes.new')}
        onActionClick={() => setOpenModal(true)}
      />

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder={t('common.search')}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <select
          className={styles.select}
          value={filtroResultado}
          onChange={(e) => setFiltroResultado(e.target.value)}
        >
          <option value="Todos">{t('verificacoes.allResults')}</option>
          <option value="Conforme">{t('verificacoes.conform')}</option>
          <option value="Não Conforme">{t('verificacoes.nonConform')}</option>
        </select>
      </div>

      {!eqLoading && (
        <ResourceTable
          columns={[ t('common.date'), t('common.equipment'), t('verificacoes.technician'), t('verificacoes.result'), '' ]}
          items={verificacoesFiltradas}
          renderRow={renderRow}
          loading={loading}
          emptyNode={(
            <EmptyState
              variant={verificacoesFiltradas.length === 0 && verificacoes.length > 0 ? 'neutral' : verificacoes.length === 0 ? 'positive' : 'neutral'}
              icon="✓"
              title={verificacoes.length === 0 ? t('verificacoes.noData') : t('common.noData')}
              subtitle={verificacoes.length === 0 ? t('verificacoes.noDataSub') : t('common.filter')}
              buttonText={verificacoes.length === 0 ? t('verificacoes.new') : t('common.filter')}
              onButtonClick={() => {
                if (verificacoes.length === 0) setOpenModal(true)
                else {
                  setFiltro('')
                  setFiltroResultado('Todos')
                }
              }}
            />
          )}
          wrapperClass={styles.tableWrap}
          tableClass={styles.table}
        />
      )}

      <ModalWrapper
        isOpen={openModal}
        onClose={() => setOpenModal(false)}
        categoria={t('verificacoes.modalLabel')}
        titulo={t('verificacoes.modalTitle')}
      >
        <form onSubmit={handleSubmit}>
          <label className={styles.fieldLabel}>
            <span className="label">{t('common.equipment')}</span>
            <select value={formEq} onChange={e => setFormEq(e.target.value)} className={styles.textarea}>
              <option value="">{t('verificacoes.selectEq')}</option>
              {equipamentos.map(eq => (
                <option key={eq.id} value={eq.id}>{eq.nome}</option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
            <span className="label">{t('verificacoes.date')}</span>
            <input type="date" value={formData} onChange={e => setFormData(e.target.value)} className={styles.textarea} style={{ height: 40 }} />
          </label>

          <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
            <span className="label">{t('verificacoes.notes')}</span>
            <textarea rows={3} className={styles.textarea} placeholder={t('common.notes')} value={formNotas} onChange={e => setFormNotas(e.target.value)} />
          </label>

          <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
            <span className="label">{t('verificacoes.result')}</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="radio" name="passfail" checked={formPass === true} onChange={() => setFormPass(true)} /> {t('verificacoes.conform')}
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="radio" name="passfail" checked={formPass === false} onChange={() => setFormPass(false)} /> {t('verificacoes.nonConform')}
              </label>
            </div>
          </label>

          <div className={styles.modalActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => setOpenModal(false)}>{t('common.cancel')}</button>
            <button type="submit" className={styles.btnPrimary}>{t('common.save')}</button>
          </div>
        </form>
      </ModalWrapper>

      {view && (
        <ViewModal
          view={view}
          eqMap={eqMap}
          locale={locale}
          t={t}
          onClose={() => setView(null)}
          styles={styles}
        />
      )}
    </div>
  )
}
