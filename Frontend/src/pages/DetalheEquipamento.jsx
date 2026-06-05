import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { History, LogIn, LogOut, Clock } from 'lucide-react'
import {
  faBuilding,
  faCalendarDays,
  faTriangleExclamation as faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import StatusBadge from '../components/StatusBadge.jsx'
import QRCodeDisplay from '../components/QRCode/QRCodeDisplay.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import CheckInModal from '../components/Modals/CheckInModal.jsx'
import HistoryDrawer from '../components/Modals/HistoryDrawer.jsx'
import ModalWrapper from '../components/ModalWrapper.jsx'
import styles from './DetalheEquipamento.module.css'
import TimelineAvarias from '../components/TimelineAvarias.jsx'
import { formatDateTimeLocal, fmtDateTime as fmt } from '../utils/dateFormat.js'

function formatarDataHora(dt, t) {
  if (!dt) return '—'

  const data = new Date(dt)
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const ano = data.getFullYear()
  const hora = String(data.getHours()).padStart(2, '0')
  const minuto = String(data.getMinutes()).padStart(2, '0')

  return `${dia}/${mes}/${ano} ${t ? t('detalhe.as') : 'às'} ${hora}:${minuto}`
}

function formatTempoRestante(fimAutomatico, t) {
  if (!fimAutomatico) return null
  const diffMs = new Date(fimAutomatico).getTime() - Date.now()
  if (diffMs <= 0) return t ? t('detalhe.tempoPrevUltrapassado') : 'Tempo previsto ultrapassado'

  const totalMin = Math.ceil(diffMs / 60000)
  const dias = Math.floor(totalMin / (24 * 60))
  const horas = Math.floor((totalMin % (24 * 60)) / 60)
  const minutos = totalMin % 60

  if (t) {
    if (dias > 0) return t('detalhe.faltamDHM', { dias, horas, minutos })
    if (horas > 0) return t('detalhe.faltamHM', { horas, minutos })
    return t('detalhe.faltamM', { minutos })
  }
  if (dias > 0) return `Faltam ${dias}d ${horas}h ${minutos}m`
  if (horas > 0) return `Faltam ${horas}h ${minutos}m`
  return `Faltam ${minutos}m`
}

export default function DetalheEquipamento() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const { user, openAuthPrompt } = useAuth()
  const { t, lang } = useLanguage()
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const tCategoria = (tipo) => { const k = `categorias.${tipo}`; const v = t(k); return v === k ? tipo : v }
  // Parâmetro injetado pelo QR Code: ?action=checkin
  const acaoQR = searchParams.get('action')
  const [eq, setEq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [avarias, setAvarias] = useState([])
  const [manutencoes, setManutencoes] = useState([])
  const [calibracoes, setCalibracoes] = useState([])
  const [tab, setTab] = useState('avarias')
  const [modalAvaria, setModalAvaria] = useState(false)
  const [savingAvaria, setSavingAvaria] = useState(false)
  const [msgAvaria, setMsgAvaria] = useState('')
  const [descAvaria, setDescAvaria] = useState('')
  const [dataRegisto, setDataRegisto] = useState(() => formatDateTimeLocal())
  const [empresaExterna, setEmpresaExterna] = useState(false)
  const [paragemEquipamento, setParagemEquipamento] = useState(false)
  const [numRelatorio, setNumRelatorio] = useState('')
  const [custoAvaria, setCustoAvaria] = useState('')
  const [scPoAvaria, setScPoAvaria] = useState('')
  const [modalDuracao, setModalDuracao] = useState(false)
  const [savingCheckin, setSavingCheckin] = useState(false)
  const [sessaoAtiva, setSessaoAtiva] = useState(null)  // Sessão em progresso do utilizador atual
  const [reservaAtiva, setReservaAtiva] = useState(null)
  const [modoEdicao, setModoEdicao] = useState(false)  // true se estamos editando uma sessão existente
  const [oeeData, setOeeData] = useState(null)
  const [modalTermino, setModalTermino] = useState(false)
  const [savingTermino, setSavingTermino] = useState(false)
  const [concluindoCalib, setConcluindoCalib] = useState(null)
  const [concluindoManut, setConcluindoManut] = useState(null)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const [tempoDecorrido, setTempoDecorrido] = useState(null) // minutos desde inicio da sessão
  const [sessaoEmCurso, setSessaoEmCurso] = useState(null)  // sessão ativa pública (sem filtro de utilizador)
  const [modalConfirmacaoCalib, setModalConfirmacaoCalib] = useState(false)
  const autoReloadTimerRef = useRef(null)
  const oeeDataFetchedAtRef = useRef(null)
  const qrRef = useRef(null)
  // Garante que a ação QR só é processada uma vez por montagem do componente
  const qrAcaoProcessadaRef = useRef(false)
  // Registo de exceção: true quando o utilizador avança com calibração inválida
  const calibExcecaoRef = useRef(false)

  // Derivar data_proxima_calibracao: preferir valor do backend; usar calibrações carregadas
  // como alternativa robusta (comparação por String() para evitar erros de tipo int vs string).
  const calibracoesDoEq = calibracoes.filter(c => String(c.equipamento_id) === String(id))
  const dataProximaCalib = eq?.data_proxima_calibracao
    ?? calibracoesDoEq.find(c => c.proxima_data != null)?.proxima_data
    ?? null

  // Flags de calibração — calculadas a partir de dataProximaCalib para uso nos handlers e na UI
  const diasParaCalib = (() => {
    if (!dataProximaCalib) return null
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const data = new Date(dataProximaCalib)
    data.setHours(0, 0, 0, 0)
    return Math.ceil((data.getTime() - hoje.getTime()) / 86400000)
  })()
  const calibExpirada = diasParaCalib !== null && diasParaCalib < 0
  const calibPrestesExp = diasParaCalib !== null && diasParaCalib >= 0 && diasParaCalib < 30

  const resetAvaria = () => {
    setDescAvaria('')
    setDataRegisto(formatDateTimeLocal())
    setEmpresaExterna(false)
    setParagemEquipamento(false)
    setNumRelatorio('')
    setCustoAvaria('')
    setScPoAvaria('')
    setMsgAvaria('')
  }

  const carregar = useCallback(async () => {
    try {
      setLoading(true)
      setErro(null)

      const [eqData, av, mn, cal, sessaoRes, emCurso] = await Promise.all([
        api.detalheEquipamento(id),
        api.listarAvarias(id),
        api.listarManutencoes(id),
        api.listarCalibracoes(id),
        api.obterSessaoAtiva(id).catch(() => ({})),  // Ignora erros se não houver sessão
        api.obterSessaoEmCurso(id).catch(() => ({})),
      ])

      setEq(eqData)
      setAvarias(av)
      setManutencoes(mn)
      setCalibracoes(cal)
      setSessaoAtiva(sessaoRes?.sessao || null)
      setReservaAtiva(sessaoRes?.reserva || null)
      setSessaoEmCurso(emCurso?.inicio ? emCurso : null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    if (!id) return
    api.oeeEquipamento(id, 30).then((data) => {
      oeeDataFetchedAtRef.current = Date.now()
      setOeeData(data)
    }).catch(() => {})
  }, [id])

  // Atualiza o tempo decorrido da sessão ativa a cada minuto
  // Usa sessaoAtiva (user atual) ou sessaoEmCurso (pública) como fallback
  const inicioSessao = sessaoAtiva?.inicio ?? sessaoEmCurso?.inicio ?? null
  useEffect(() => {
    if (!inicioSessao) {
      setTempoDecorrido(null)
      return
    }
    const calcular = () => {
      const diffMs = Date.now() - new Date(inicioSessao).getTime()
      setTempoDecorrido(Math.max(0, Math.floor(diffMs / 60000)))
    }
    calcular()
    const interval = setInterval(calcular, 60000)
    return () => clearInterval(interval)
  }, [inicioSessao])

  // Quando existe fim_automatico, agenda um setTimeout preciso para recarregar
  // assim que o tempo expirar — sem polling e sem flickering.
  useEffect(() => {
    if (autoReloadTimerRef.current) {
      clearTimeout(autoReloadTimerRef.current)
      autoReloadTimerRef.current = null
    }
    if (!reservaAtiva?.fim_automatico) return

    const diffMs = new Date(reservaAtiva.fim_automatico).getTime() - Date.now()
    if (diffMs <= 0) {
      // Já expirou: recarregar de imediato
      carregar()
      return
    }
    autoReloadTimerRef.current = setTimeout(() => {
      carregar()
    }, diffMs)

    return () => {
      if (autoReloadTimerRef.current) clearTimeout(autoReloadTimerRef.current)
    }
  }, [reservaAtiva?.fim_automatico, carregar])

  // Processa a ação proveniente do scan QR (?action=checkin)
  // Só é executado uma vez após os dados carregarem para evitar loops
  useEffect(() => {
    if (loading || !acaoQR || qrAcaoProcessadaRef.current) return
    if (acaoQR !== 'checkin') return

    qrAcaoProcessadaRef.current = true

    if (!user) {
      openAuthPrompt('login', `/equipamentos/${id}?action=checkin`)
      return
    }

    // Operador autenticado: abrir modal de check-in automaticamente se o equipamento o permitir
    if (!sessaoAtiva && eq?.estado_atual !== 'Ocupado') {
      setModoEdicao(false)
      if (diasParaCalib !== null && diasParaCalib < 30) {
        setModalConfirmacaoCalib(true)
      } else {
        setModalDuracao(true)
      }
    } else if (sessaoAtiva) {
      toast.info?.(t('detalhe.sessaoJaAtiva'))
    }
  }, [loading, acaoQR, user, sessaoAtiva, eq, id, openAuthPrompt, toast])

  const handleAvaria = async () => {
    if (!descAvaria.trim()) return
    setSavingAvaria(true)
    try {
      // Mapear o toggle de paragem para o campo severidade esperado pelo backend:
      // toggle activo (paragem total do equipamento) → BLOQUEANTE (impede check-in, protege OEE);
      // toggle inactivo (falha não-bloqueante)        → ALERTA    (activa Modo Limitado, permite check-in com precaução).
      const severidade = paragemEquipamento ? 'BLOQUEANTE' : 'ALERTA'
      const res = await api.registarAvaria(id, {
        descricao: descAvaria,
        severidade,
        custo_reparacao: custoAvaria ? parseFloat(custoAvaria) : undefined,
        num_sc_po: scPoAvaria || undefined,
      })
      setMsgAvaria(res.mensagem || t('detalhe.avariaRegistada'))
      setDescAvaria('')
      setDataRegisto(formatDateTimeLocal())
      setEmpresaExterna(false)
      setParagemEquipamento(false)
      setCustoAvaria('')
      setScPoAvaria('')
      setMsgAvaria('')
      
        setTimeout(() => {
          setModalAvaria(false)
          resetAvaria()
          carregar()
      }, 1200)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSavingAvaria(false)
    }
  }

  const handleCheckin = () => {
    setModoEdicao(!!sessaoAtiva)
    if ((calibExpirada || calibPrestesExp) && !sessaoAtiva) {
      setModalConfirmacaoCalib(true)
    } else {
      setModalDuracao(true)
    }
  }

  const handleForcarTermino = () => {
    setModalTermino(true)
  }

  const handleConcluirCalibracao = async (calibracaoId) => {
    setConcluindoCalib(calibracaoId)
    try {
      await api.concluirCalibracao(id, calibracaoId)
      toast.success(t('detalhe.calibracaoConcluida'))
      carregar()
    } catch (e) {
      toast.error(e.message || t('detalhe.erroConcluirCalibracao'))
    } finally {
      setConcluindoCalib(null)
    }
  }

  const handleConcluirManutencao = async (manutencaoId) => {
    setConcluindoManut(manutencaoId)
    try {
      await api.concluirManutencao(id, manutencaoId)
      toast.success(t('detalhe.manutencaoConcluida'))
      carregar()
    } catch (e) {
      toast.error(e.message || t('detalhe.erroConcluirManutencao'))
    } finally {
      setConcluindoManut(null)
    }
  }

  const confirmarTermino = async () => {
    setSavingTermino(true)
    try {
      await api.checkoutForcado(id)

      // Limpar imediatamente o estado local para que a UI reflita o término
      // sem esperar pelo ciclo completo de carregar().
      setSessaoAtiva(null)
      setReservaAtiva(null)

      setModalTermino(false)
      toast.success(t('detalhe.sessaoTerminada'))
      carregar()
    } catch (e) {
      toast.error(e.message || t('detalhe.erroForcaTermino'))
    } finally {
      setSavingTermino(false)
    }
  }

  const handleEditarSessao = () => {
    setModoEdicao(true)
    setModalDuracao(true)
  }

  // Stub IoT: preparado para integrar com endpoint de relatório da máquina.
  // Quando o backend expuser GET /api/equipamentos/{id}/relatorio-sessao/{sessao_id},
  // basta remover o atributo `disabled` do botão e esta função ficará operacional.
  const handleObterRelatorio = useCallback(async () => {
    if (!sessaoAtiva) return
    try {
      const token = localStorage.getItem('lab_auth_token')
      const res = await fetch(`/api/equipamentos/${id}/relatorio-sessao/${sessaoAtiva.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio_eq${id}_sessao${sessaoAtiva.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('detalhe.relatorioIndisponivel'))
    }
  }, [id, sessaoAtiva, toast])

  const handleConfirmarCheckin = async ({ projeto, metodo, duracaoMinutos }) => {
    const minutos = Math.max(1, duracaoMinutos)
    setSavingCheckin(true)
    try {
      if (modoEdicao) {
        await api.editarDuracaoSessao(id, minutos)
        toast.success(t('detalhe.duracaoAtualizada'))
      } else {
        await api.iniciarCheckin(id, null, minutos, projeto, metodo)
        calibExcecaoRef.current = false
        toast.success(t('detalhe.checkinIniciado'))
      }
      setModalDuracao(false)
      setModoEdicao(false)
      carregar()
    } catch (e) {
      let mensagem = e.message
      if (e.status === 409) {
        mensagem = modoEdicao
          ? e.message || t('detalhe.erroAtualizarDuracao')
          : e.message || t('detalhe.erroCheckinAtivo')
        if (!modoEdicao) setTimeout(() => carregar(), 500)
      } else if (e.status === 400) {
        mensagem = e.message || t('detalhe.erroIniciarEnsaio')
      } else if (e.status === 503) {
        mensagem = t('detalhe.erroLigacaoServidor')
      }
      toast.error(mensagem)
    } finally {
      setSavingCheckin(false)
    }
  }

  if (loading) {
    return (
      <div className={acaoQR === 'checkin' ? styles.loadingQR : styles.loading}>
        {acaoQR === 'checkin' ? (
          <>
            <div className={styles.loadingQRSpinner} aria-hidden="true" />
            <span>{t('detalhe.aValidarAcesso')}</span>
          </>
        ) : t('detalhe.aCarregar')}
      </div>
    )
  }

  if (erro) {
    return (
      <div className={styles.erroContainer}>
        <div className={styles.erroIcon}>!</div>
        <div className={styles.erroTitulo}>{t('detalhe.equipNaoEncontrado')}</div>
        <div className={styles.erroDetalhe}>{erro}</div>
        <button className={styles.back} onClick={() => navigate('/equipamentos')}>
          {t('detalhe.voltarLista')}
        </button>
      </div>
    )
  }

  if (!eq) return null

  const shareUrl = `${window.location.origin}/equipamentos/${id}`
  const avariasAbertas = avarias.filter((a) => !a.resolvida).length

  // OEE dinâmico: incrementa tempo_real_h com o tempo decorrido desde a última fetch da API
  const tempoRealDinamico = (() => {
    if (!oeeData) return 0
    if (eq?.estado_atual !== 'Ocupado' || !inicioSessao || !oeeDataFetchedAtRef.current) return oeeData.tempo_real_h
    const elapsedH = (Date.now() - oeeDataFetchedAtRef.current) / 3600000
    return oeeData.tempo_real_h + elapsedH
  })()
  const oeePctDinamico = oeeData && oeeData.tempo_planeado_h > 0
    ? Math.min(100, (tempoRealDinamico / oeeData.tempo_planeado_h) * 100)
    : (oeeData?.oee_pct ?? 0)

  return (
    <>
    <div className="fade-up">
      <div className={styles.breadcrumb}>
        <button
          onClick={() => navigate('/equipamentos')}
          className={styles.back}
        >
          {t('detalhe.voltarEquipamentos')}
        </button>

        <span className={styles.sep}>/</span>
        <span>{eq.nome}</span>

      </div>

      <div className={styles.header}>
        <div>
          <div className="mono">EQ-{String(eq.id).padStart(3, '0')}</div>
          <h1 className={`${styles.title} text-base font-bold text-gray-800 tracking-wide uppercase`}>{eq.nome}</h1>

          <div className={styles.subInfo}>
            <span>{eq.tipo}</span>
            <span>·</span>
            <span>{eq.localizacao}</span>
          </div>
        </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className={styles.btnRed}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 14px',
                fontSize: '13px',
              }}
              onClick={() => {
                setDataRegisto(formatDateTimeLocal())
                setModalAvaria(true)
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3l-8.47-14.14a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              {t('detalhe.acoesRegistarAvaria')}
            </button>

            <button
              type="button"
              onClick={() => setShowHistoryDrawer(true)}
              title={t('detalhe.historyTooltip')}
              className={styles.btnHistory}
            >
              <History size={16} />
              <span>{t('detalhe.verHistorico')}</span>
            </button>
          </div>
      </div>

      <div className={styles.infoGrid}>
        <Card label={t('detalhe.estadoAtual')}>
          <StatusBadge estado={eq.estado_atual} />
        </Card>

        <Card label={t('common.type')}>{tCategoria(eq.tipo)}</Card>

        <Card label={t('common.location')}>{eq.localizacao}</Card>

        <Card label={t('detalhe.proximaCalib')}>
          {(() => {
            const dataCalib = dataProximaCalib
            if (!dataCalib) return <span style={{ color: 'var(--text-dim)' }}>{t('detalhe.naoDefinida')}</span>
            const hoje = new Date()
            hoje.setHours(0, 0, 0, 0)
            const data = new Date(dataCalib)
            data.setHours(0, 0, 0, 0)
            const diasRestantes = Math.ceil((data.getTime() - hoje.getTime()) / 86400000)
            const formatted = data.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
            const cor = diasRestantes < 0 ? '#dc2626' : diasRestantes < 30 ? '#f59e0b' : 'inherit'
            return <span style={{ color: cor, fontWeight: diasRestantes < 30 ? 600 : 'inherit' }}>{formatted}</span>
          })()}
        </Card>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, paddingLeft: 2 }}>
        {t('detalhe.registadoEm', { data: fmt(eq.criado_em, locale) })}
      </div>

      <div className={styles.section}>
        <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('detalhe.oeeCardTitulo')}
          <span
            title={t('detalhe.oeeTooltip')}
            style={{ cursor: 'help', fontSize: 12, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
          >
            ?
          </span>
        </div>

        {eq.estado_atual === 'Ocupado' && inicioSessao && (() => {
            const fimAuto = reservaAtiva?.fim_automatico ?? sessaoEmCurso?.fim_automatico ?? null
            const tempoRestante = formatTempoRestante(fimAuto, t)
            const tempoExcedido = fimAuto && new Date(fimAuto) <= new Date()
            return (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
                padding: '8px 12px',
                background: 'color-mix(in srgb, #475569 10%, transparent)',
                border: '1px solid #475569',
                borderRadius: 'var(--radius)',
                color: '#475569',
                fontSize: 13,
                flexWrap: 'wrap',
              }}>
                <Clock size={14} strokeWidth={2} />
                <span>
                  <strong>{t('detalhe.emCursoDesde')}</strong> {formatarDataHora(inicioSessao, t)}
                </span>
                <span>·</span>
                <span>
                  <strong>{t('detalhe.duracao')}</strong>{' '}
                  {tempoDecorrido != null
                    ? tempoDecorrido < 60
                      ? `${tempoDecorrido}m`
                      : `${Math.floor(tempoDecorrido / 60)}h ${tempoDecorrido % 60}m`
                    : '—'}
                </span>
                {tempoRestante && (
                  <>
                    <span>·</span>
                    <span style={{ color: tempoExcedido ? '#dc2626' : '#475569' }}>
                      {tempoRestante}
                    </span>
                  </>
                )}
              </div>
            )
          })()}

        {oeeData && (
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('detalhe.oeeCardOeeTemporal')}</span>
              <span style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: 'var(--font-display)',
                color: oeePctDinamico >= 85 ? '#10b981' : oeePctDinamico >= 50 ? '#f59e0b' : '#c8102e',
              }}>
                {`${oeePctDinamico.toFixed(1)}%`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {t('detalhe.oeeCardHorasSufixo', { reais: tempoRealDinamico.toFixed(1), planeadas: oeeData.tempo_planeado_h.toFixed(1) })}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('detalhe.oeeCardTaxaSucesso')}</span>
              <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {oeeData.taxa_sucesso_planeamento_pct != null ? `${oeeData.taxa_sucesso_planeamento_pct.toFixed(1)}%` : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {t('detalhe.oeeCardReservasSufixo', { atual: oeeData.reservas_sucesso, total: oeeData.total_reservas })}
              </span>
            </div>
          </div>
        )}

        <div className={styles.acoes}>
          {/* Mostrar "Iniciar Sessão" quando Disponível ou Limitado (Modo Limitado permite check-in com precaução) */}
          {!sessaoAtiva && (eq.estado_atual === 'Disponível' || eq.estado_atual === 'Limitado') && (
            <>
              {eq.estado_atual === 'Limitado' && (
                <div
                  className={styles.bannerAmber}
                  role="alert"
                  aria-live="polite"
                >
                  {t('detalhe.bannerDegradado')}
                </div>
              )}
              <button
                className={styles.btnCheckIn}
                onClick={handleCheckin}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <LogIn size={18} />
                {eq.estado_atual === 'Limitado'
                  ? t('detalhe.btnCheckInDegradado')
                  : t('detalhe.oeeCardBotaoCheckin')}
              </button>
            </>
          )}

          {/* Bloqueio visual para estados que impedem check-in.
              'Limitado' está intencionalmente ausente: não é um bloqueio — permite check-in em Modo Limitado. */}
          {!sessaoAtiva && eq.estado_atual !== 'Disponível' && eq.estado_atual !== 'Limitado' && eq.estado_atual !== 'Ocupado' && (() => {
            const bloqueios = {
              'Avariado':       { cor: 'var(--red)',   msg: t('detalhe.equipBloqAvaria') },
              'Em manutenção':  { cor: 'var(--amber)',  msg: t('detalhe.equipBloqManutencao') },
              'Em calibração':  { cor: 'var(--amber)',  msg: t('detalhe.equipBloqCalibracao') },
            }
            const info = bloqueios[eq.estado_atual]
            if (!info) return null
            return (
              <div style={{ padding: '10px 14px', background: `color-mix(in srgb, ${info.cor} 10%, transparent)`, border: `1px solid ${info.cor}`, borderRadius: 'var(--radius)', color: info.cor, fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                {info.msg}
              </div>
            )
          })()}

          {/* Botões de controlo: visíveis sempre que exista sessão ativa OU estado=Ocupado */}
          {(sessaoAtiva || eq.estado_atual === 'Ocupado') && (
            <>
              <button
                className={styles.btnRed}
                onClick={handleForcarTermino}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <LogOut size={16} />
                {t('detalhe.finalizarCheckin')}
              </button>

              <button
                className={styles.btnAmber}
                onClick={handleEditarSessao}
              >
                {t('detalhe.ajustarDuracao')}
              </button>

              <button
                className={styles.btnSecondary}
                onClick={handleObterRelatorio}
                title={t('detalhe.obterRelatorioTooltip')}
                disabled
              >
                {t('detalhe.obterRelatorio')}
              </button>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 auto' }}>
            {sessaoAtiva && (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {t('detalhe.sessaoIniciada', { hora: formatarDataHora(sessaoAtiva.inicio, t) })}
              </div>
            )}
            {reservaAtiva?.fim_automatico && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                {t('detalhe.terminaPrevisto')} {fmt(reservaAtiva.fim_automatico, locale)}
                {' · '}
                {formatTempoRestante(reservaAtiva.fim_automatico, t)}
              </div>
            )}
          </div>
        </div>
      </div>

      <QRCodeDisplay ref={qrRef} equipamento={eq} value={shareUrl} />

      <div className={styles.section}>
        <div className={styles.tabs}>
          <TabBtn
            active={tab === 'avarias'}
            onClick={() => setTab('avarias')}
          >
            {t('avarias.title')} ({avariasAbertas})
          </TabBtn>

          <TabBtn
            active={tab === 'manutencoes'}
            onClick={() => setTab('manutencoes')}
          >
            {t('manutencoes.title')} ({manutencoes.length})
          </TabBtn>

          <TabBtn
            active={tab === 'calibracoes'}
            onClick={() => setTab('calibracoes')}
          >
            {t('calibracoes.title')} ({calibracoes.length})
          </TabBtn>
        </div>

        {tab === 'avarias' && (
          <TimelineAvarias avarias={avarias} locale={locale} />
        )}

        {tab === 'manutencoes' && (
          <TabelaManutencoes
            manutencoes={manutencoes}
            locale={locale}
            t={t}
            onConcluir={handleConcluirManutencao}
            concluindo={concluindoManut}
            equipamentoEstado={eq.estado_atual}
          />
        )}

        {tab === 'calibracoes' && (
          <TabelaCalibracoes
            calibracoes={calibracoes}
            locale={locale}
            t={t}
            onConcluir={handleConcluirCalibracao}
            concluindo={concluindoCalib}
            equipamentoEstado={eq.estado_atual}
          />
        )}
      </div>

      <SecaoHistoricoFinanceiro equipamentoId={id} t={t} locale={locale} />
    </div>

    <ModalWrapper
      isOpen={modalAvaria}
      onClose={() => { setModalAvaria(false); resetAvaria() }}
      categoria="AVARIAS"
      titulo={t('detalhe.acoesRegistarAvaria')}
      tamanho="max-w-2xl"
    >
      {msgAvaria ? (
        <div className={styles.sucesso}>{msgAvaria}</div>
      ) : (
        <div className={styles.avariaGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              <span className={styles.fieldTag}>{t('detalhe.campoEquipamento')}</span>
            </span>
            <div className={styles.readonlyField}>
              <strong>{eq?.codigo || '—'}</strong>
              <span>{eq?.nome || t('detalhe.equipEmCarregamento')}</span>
            </div>
          </div>

          <label className={styles.switchField}>
            <span className={styles.switchText}>
              <FontAwesomeIcon icon={faBuilding} className={styles.fieldIcon} aria-hidden="true" />
              {t('detalhe.campoEmpresaExterna')}
            </span>
            <span className={styles.switchControl}>
              <input
                type="checkbox"
                checked={empresaExterna}
                onChange={(e) => setEmpresaExterna(e.target.checked)}
              />
              <span className={styles.switchTrack} aria-hidden="true">
                <span className={styles.switchThumb} />
              </span>
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              <FontAwesomeIcon icon={faCalendarDays} className={styles.fieldIcon} aria-hidden="true" />
              {t('detalhe.campoDataRegisto')}
            </span>
            <input
              className={styles.input}
              type="datetime-local"
              value={dataRegisto}
              onChange={(e) => setDataRegisto(e.target.value)}
            />
          </label>

          <label className={styles.switchField}>
            <span className={styles.switchText}>
              <span className={styles.fieldTag}>{t('detalhe.campoParagem')}</span>
              {t('detalhe.campoParagemEquip')}
            </span>
            <span className={styles.switchControl}>
              <input
                type="checkbox"
                checked={paragemEquipamento}
                onChange={(e) => setParagemEquipamento(e.target.checked)}
              />
              <span className={styles.switchTrack} aria-hidden="true">
                <span className={styles.switchThumb} />
              </span>
            </span>
          </label>

          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>
              <FontAwesomeIcon icon={faExclamationTriangle} className={styles.fieldIcon} aria-hidden="true" />
              {t('detalhe.campoDescricaoProblema')}
            </span>
            <textarea
              rows={4}
              className={styles.textarea}
              placeholder={t('detalhe.placeholderDescricao')}
              value={descAvaria}
              onChange={(e) => setDescAvaria(e.target.value)}
            />
          </label>

          <input
            className={styles.input}
            placeholder={t('detalhe.placeholderRelatorio')}
            value={numRelatorio}
            onChange={(e) => setNumRelatorio(e.target.value)}
          />

          <input
            className={styles.input}
            type="number"
            placeholder={t('detalhe.placeholderCusto')}
            value={custoAvaria}
            onChange={(e) => setCustoAvaria(e.target.value)}
          />

          <input
            className={styles.input}
            placeholder={t('detalhe.placeholderScPo')}
            value={scPoAvaria}
            onChange={(e) => setScPoAvaria(e.target.value)}
          />
        </div>
      )}
      <div className={styles.modalActions}>
        <button
          className={styles.btnSecondary}
          onClick={() => { setModalAvaria(false); resetAvaria() }}
        >
          {t('common.cancel')}
        </button>
        {!msgAvaria && (
          <button
            className={styles.btnRed}
            onClick={handleAvaria}
            disabled={savingAvaria || !descAvaria.trim()}
          >
            {savingAvaria ? t('detalhe.aRegistar') : t('detalhe.registar')}
          </button>
        )}
      </div>
    </ModalWrapper>

    <ModalWrapper
      isOpen={modalConfirmacaoCalib}
      onClose={() => setModalConfirmacaoCalib(false)}
      categoria="CALIBRAÇÃO"
      titulo={t('detalhe.calibAtencaoTitulo', { estado: calibExpirada ? t('detalhe.calibExpirada') : t('detalhe.calibProximaFim') })}
      tamanho="max-w-md"
    >
      <div style={{
        background: calibExpirada
          ? 'color-mix(in srgb, #dc2626 12%, transparent)'
          : 'color-mix(in srgb, #f59e0b 12%, transparent)',
        border: `1px solid ${calibExpirada ? '#dc2626' : '#f59e0b'}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        marginBottom: 20,
      }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          {calibExpirada
            ? t('detalhe.calibExpirouHaDias', { n: Math.abs(diasParaCalib), sufixo: Math.abs(diasParaCalib) !== 1 ? t('detalhe.diasPlural') : t('detalhe.diaSingular') })
            : t('detalhe.calibExpiraEm', { n: diasParaCalib, sufixo: diasParaCalib !== 1 ? t('detalhe.diasPlural') : t('detalhe.diaSingular') })
          }
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('detalhe.calibConfirmacao')}
        </p>
      </div>
      <div className={styles.modalActions}>
        <button
          style={{
            padding: '8px 16px',
            border: '1px solid var(--text-dim)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            fontSize: 14,
          }}
          onClick={() => {
            calibExcecaoRef.current = true
            setModalConfirmacaoCalib(false)
            setModalDuracao(true)
          }}
        >
          {t('detalhe.calibSimIniciar')}
        </button>
        <button
          className={styles.btnGreen}
          onClick={() => {
            setModalConfirmacaoCalib(false)
            setTab('calibracoes')
          }}
        >
          {t('detalhe.calibCancelarVerificar')}
        </button>
      </div>
    </ModalWrapper>

    {modalDuracao && (
      <CheckInModal
        equipamentoNome={eq?.nome}
        equipamentoCodigo={eq?.codigo || `EQ-${String(eq?.id || id).padStart(3, '0')}`}
        modoEdicao={modoEdicao}
        duracaoInicialMinutos={modoEdicao ? (sessaoAtiva?.duracao_prevista_minutos ?? reservaAtiva?.duracao_prevista_minutos ?? null) : null}
        onConfirmar={handleConfirmarCheckin}
        onClose={() => { setModalDuracao(false); setModoEdicao(false) }}
        saving={savingCheckin}
      />
    )}

    <ModalWrapper
      isOpen={modalTermino}
      onClose={() => !savingTermino && setModalTermino(false)}
      categoria="SESSÃO"
      titulo={t('detalhe.finalizarSessaoTitulo')}
      tamanho="max-w-md"
    >
      <p className={styles.modalDesc}>
        {t('detalhe.finalizarSessaoDesc')}
      </p>
      <div className={styles.modalActions}>
        <button
          className={styles.btnSecondary}
          onClick={() => setModalTermino(false)}
          disabled={savingTermino}
        >
          {t('common.cancel')}
        </button>
        <button
          className={styles.btnRed}
          onClick={confirmarTermino}
          disabled={savingTermino}
          style={{ background: '#dc2626', color: '#fff', border: 'none' }}
        >
          {savingTermino ? t('detalhe.aEncerrar') : t('detalhe.confirmarFinalizacao')}
        </button>
      </div>
    </ModalWrapper>

    <HistoryDrawer
      equipamentoId={id}
      open={showHistoryDrawer}
      onClose={() => setShowHistoryDrawer(false)}
    />
  </>
  )
}

const CUSTO_AVISO_EUR = 5000

function SecaoHistoricoFinanceiro({ equipamentoId, t, locale }) {
  const anoAtual = new Date().getFullYear()
  const [dados, setDados] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('lab_auth_token')
    fetch(`/api/financeiro/resumo?ano=${anoAtual}&equipamento_id=${equipamentoId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then(setDados)
      .catch(() => {})
  }, [equipamentoId])

  if (!dados) return null

  const fmtEur = (v) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(v ?? 0)

  const total = dados.total_eur ?? 0
  const avarias = dados.avarias_eur ?? 0
  const manutencoes = dados.manutencoes_eur ?? 0
  const calibracoes = dados.calibracoes_eur ?? 0

  return (
    <div className={styles.section}>
      <div className="label">Histórico Financeiro ({anoAtual})</div>

      {total === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          {t('financeiro.semDados').replace('este período', String(anoAtual))}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, marginBottom: 14 }}>
            {[
              { label: t('financeiro.custoAvarias'), value: avarias },
              { label: t('financeiro.custoManutencoes'), value: manutencoes },
              { label: t('financeiro.custoCalibrações'), value: calibracoes },
              { label: t('financeiro.custoTotal'), value: total },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '8px 12px', minWidth: 120,
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{fmtEur(value)}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
            {avarias > 0 && (
              <div style={{ width: `${(avarias / total) * 100}%`, backgroundColor: '#dc2626' }} />
            )}
            {manutencoes > 0 && (
              <div style={{ width: `${(manutencoes / total) * 100}%`, backgroundColor: '#f59e0b' }} />
            )}
            {calibracoes > 0 && (
              <div style={{ width: `${(calibracoes / total) * 100}%`, backgroundColor: '#3b82f6' }} />
            )}
          </div>

          {total >= CUSTO_AVISO_EUR && (
            <div style={{
              fontSize: 12, color: '#b45309',
              background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
              border: '1px solid #f59e0b', borderRadius: 4, padding: '6px 10px',
            }}>
              ⚠ Custo acumulado elevado. Considerar análise de substituição.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Card({ label, children }) {
  return (
    <div className={styles.infoCard}>
      <div className="label">{label}</div>
      <div className={styles.infoValue}>{children}</div>
    </div>
  )
}

function TabBtn({ children, active, onClick }) {
  return (
    <button
      className={`${styles.tab} ${
        active ? styles.tabActive : ''
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function TabelaAvarias({ avarias, locale, t }) {
  if (avarias.length === 0) {
    return <div className={styles.sucesso}>{t('avarias.noOpen')}</div>
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('common.description')}</th>
          <th>{t('common.status')}</th>
          <th>{t('avarias.reportedAt')}</th>
          <th>{t('avarias.resolvedAt')}</th>
          <th>{t('avarias_page.custo')}</th>
        </tr>
      </thead>
      <tbody>
        {avarias.map((av, i) => (
          <tr
            key={av.id}
            style={!av.resolvida ? { background: 'color-mix(in srgb, var(--red) 5%, transparent)' } : undefined}
          >
            <td>{i + 1}</td>
            <td>{av.descricao}</td>
            <td>
              <StatusBadge variant={av.resolvida ? 'success' : 'danger'}>
                {av.resolvida ? t('avarias.resolved') : t('avarias.open')}
              </StatusBadge>
            </td>
            <td>{fmt(av.data_registo, locale)}</td>
            <td>{fmt(av.data_resolucao, locale)}</td>
            <td>{av.custo_reparacao != null ? `${Number(av.custo_reparacao).toFixed(2)}€` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TabelaManutencoes({ manutencoes, locale, t, onConcluir, concluindo, equipamentoEstado }) {
  const mostrarConcluir = equipamentoEstado === 'Em manutenção'
  if (manutencoes.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('common.noData')}</div>
  }
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('common.description')}</th>
          <th>{t('common.type')}</th>
          <th>{t('manutencoes.performed')}</th>
          <th>{t('manutencoes.next')}</th>
          <th>{t('manutencoes_page.custo')}</th>
          {mostrarConcluir && <th></th>}
        </tr>
      </thead>
      <tbody>
        {manutencoes.map((mn, i) => {
          let proximaCor = 'inherit'
          if (mn.proxima_data) {
            const proxima = new Date(mn.proxima_data)
            proxima.setHours(0, 0, 0, 0)
            const dias = Math.ceil((proxima - hoje) / 86400000)
            proximaCor = dias < 0 ? '#dc2626' : dias <= 30 ? '#f59e0b' : '#10b981'
          }
          return (
            <tr key={mn.id}>
              <td>{i + 1}</td>
              <td>{mn.descricao}</td>
              <td>{mn.tipo_intervencao ?? '—'}</td>
              <td>{fmt(mn.data_realizada, locale)}</td>
              <td style={{ color: proximaCor, fontWeight: mn.proxima_data ? 500 : 'inherit' }}>
                {fmt(mn.proxima_data, locale)}
              </td>
              <td>{mn.custo_eur != null ? `${Number(mn.custo_eur).toFixed(2)} €` : '—'}</td>
              {mostrarConcluir && (
                <td>
                  <button
                    className={styles.btnAmber}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => onConcluir(mn.id)}
                    disabled={concluindo === mn.id}
                  >
                    {concluindo === mn.id ? 'A concluir…' : 'Concluir'}
                  </button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function TabelaCalibracoes({ calibracoes, locale, t, onConcluir, concluindo, equipamentoEstado }) {
  const mostrarConcluir = equipamentoEstado === 'Em calibração'
  if (calibracoes.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('common.noData')}</div>
  }
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('calibracoes.calibratedAt')}</th>
          <th>{t('calibracoes.nextCalibration')}</th>
          <th>{t('calibracoes_page.diasRestantes')}</th>
          <th>{t('calibracoes.certificate')}</th>
          {mostrarConcluir && <th></th>}
        </tr>
      </thead>
      <tbody>
        {calibracoes.map((cal, i) => {
          let diasRestantes = null
          let corDias = 'inherit'
          if (cal.proxima_data) {
            const proxima = new Date(cal.proxima_data)
            proxima.setHours(0, 0, 0, 0)
            diasRestantes = Math.ceil((proxima - hoje) / 86400000)
            corDias = diasRestantes < 0 ? '#dc2626' : diasRestantes <= 30 ? '#f59e0b' : '#10b981'
          }
          return (
            <tr key={cal.id}>
              <td>{i + 1}</td>
              <td>{fmt(cal.data_realizada, locale)}</td>
              <td>{fmt(cal.proxima_data, locale)}</td>
              <td style={{ color: corDias, fontWeight: diasRestantes !== null ? 600 : 'inherit' }}>
                {diasRestantes !== null ? diasRestantes : '—'}
              </td>
              <td>
                {cal.certificado_url
                  ? <a href={cal.certificado_url} target="_blank" rel="noreferrer" style={{ color: 'var(--amber)' }}>Ver →</a>
                  : '—'}
              </td>
              {mostrarConcluir && (
                <td>
                  <button
                    className={styles.btnAmber}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => onConcluir(cal.id)}
                    disabled={concluindo === cal.id}
                  >
                    {concluindo === cal.id ? 'A concluir…' : 'Concluir'}
                  </button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}