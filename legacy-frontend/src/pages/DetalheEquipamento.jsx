import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding,
  faCalendarDays,
  faTriangleExclamation as faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import QRCodeDisplay from '../components/QRCode/QRCodeDisplay.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import CheckInModal from '../components/Modals/CheckInModal.jsx'
import styles from './DetalheEquipamento.module.css'

function formatDateTimeLocal(date = new Date()) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ESTADOS = [
  'Disponível',
  'Ocupado',
  'Avariado',
  'Em calibração',
  'Em manutenção',
]

function fmt(dt) {
  if (!dt) return '—'

  return new Date(dt).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarDataHora(dt) {
  if (!dt) return '—'
  
  const data = new Date(dt)
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const ano = data.getFullYear()
  const hora = String(data.getHours()).padStart(2, '0')
  const minuto = String(data.getMinutes()).padStart(2, '0')
  
  return `${dia}/${mes}/${ano} às ${hora}:${minuto}`
}

function formatTempoRestante(fimAutomatico) {
  if (!fimAutomatico) return null
  const diffMs = new Date(fimAutomatico).getTime() - Date.now()
  if (diffMs <= 0) return 'Tempo previsto ultrapassado'

  const totalMin = Math.ceil(diffMs / 60000)
  const dias = Math.floor(totalMin / (24 * 60))
  const horas = Math.floor((totalMin % (24 * 60)) / 60)
  const minutos = totalMin % 60

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
  // Parâmetro injetado pelo QR Code: ?action=checkin
  const acaoQR = searchParams.get('action')
  const [eq, setEq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [avarias, setAvarias] = useState([])
  const [manutencoes, setManutencoes] = useState([])
  const [calibracoes, setCalibracoes] = useState([])
  const [tab, setTab] = useState('avarias')
  const [modalEstado, setModalEstado] = useState(false)
  const [novoEstado, setNovoEstado] = useState('')
  const [savingEstado, setSavingEstado] = useState(false)
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
  const autoReloadTimerRef = useRef(null)
  const qrRef = useRef(null)
  // Garante que a ação QR só é processada uma vez por montagem do componente
  const qrAcaoProcessadaRef = useRef(false)

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

      const [eqData, av, mn, cal, sessaoRes] = await Promise.all([
        api.detalheEquipamento(id),
        api.listarAvarias(id),
        api.listarManutencoes(id),
        api.listarCalibracoes(id),
        api.obterSessaoAtiva(id).catch(() => ({})),  // Ignora erros se não houver sessão
      ])

      setEq(eqData)
      setNovoEstado(eqData.estado_atual)
      setAvarias(av)
      setManutencoes(mn)
      setCalibracoes(cal)
      setSessaoAtiva(sessaoRes?.sessao || null)
      setReservaAtiva(sessaoRes?.reserva || null)
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
    api.oeeEquipamento(id, 30).then(setOeeData).catch(() => {})
  }, [id])

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
      setModalDuracao(true)
    } else if (sessaoAtiva) {
      toast.info?.('Já existe uma sessão ativa neste equipamento.')
    }
  }, [loading, acaoQR, user, sessaoAtiva, eq, id, openAuthPrompt, toast])

  const handleEstado = async () => {
    try {
      setSavingEstado(true)
      await api.atualizarEstado(id, novoEstado)
      setModalEstado(false)
      toast.success('Estado atualizado.')
      carregar()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSavingEstado(false)
    }
  }

  const handleAvaria = async () => {
    if (!descAvaria.trim()) return
    setSavingAvaria(true)
    try {
      const res = await api.registarAvaria(id, descAvaria)
      setMsgAvaria(res.mensagem || 'Avaria registada!')
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

  const handleCheckin = async () => {
    setModoEdicao(!!sessaoAtiva)
    setModalDuracao(true)
  }

  const handleForcarTermino = () => {
    setModalTermino(true)
  }

  const confirmarTermino = async () => {
    setSavingTermino(true)
    try {
      console.log('[ForçarTérmino] equipamento_id=', id)
      const resposta = await api.checkoutForcado(id)
      console.log('[ForçarTérmino] resposta=', resposta)

      // Limpar imediatamente o estado local para que a UI reflita o término
      // sem esperar pelo ciclo completo de carregar().
      setSessaoAtiva(null)
      setReservaAtiva(null)

      setModalTermino(false)
      toast.success('Sessão terminada com sucesso.')
      carregar()
    } catch (e) {
      console.error('[ForçarTérmino] erro=', e)
      toast.error(e.message || 'Não foi possível forçar término.')
    } finally {
      setSavingTermino(false)
    }
  }

  const handleEditarSessao = () => {
    setModoEdicao(true)
    setModalDuracao(true)
  }

  const handleConfirmarCheckin = async ({ projeto, metodo, duracaoMinutos }) => {
    const minutos = Math.max(1, duracaoMinutos)
    setSavingCheckin(true)
    try {
      if (modoEdicao) {
        await api.editarDuracaoSessao(id, minutos)
        toast.success('Duração atualizada com sucesso.')
      } else {
        await api.iniciarCheckin(id, null, minutos, projeto, metodo)
        toast.success('Check-in iniciado com sucesso.')
      }
      setModalDuracao(false)
      setModoEdicao(false)
      carregar()
    } catch (e) {
      let mensagem = e.message
      if (e.status === 409) {
        mensagem = modoEdicao
          ? e.message || 'Erro ao atualizar a duração.'
          : e.message || 'Equipamento já tem um check-in ativo. Use "Ajustar Duração" para modificar.'
        if (!modoEdicao) setTimeout(() => carregar(), 500)
      } else if (e.status === 400) {
        mensagem = e.message || 'Não é possível iniciar o ensaio neste momento.'
      } else if (e.status === 503) {
        mensagem = 'Erro de ligação ao servidor. Tente novamente.'
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
            <span>A validar acesso ao equipamento...</span>
          </>
        ) : 'A carregar...'}
      </div>
    )
  }

  if (erro) {
    return (
      <div className={styles.erroContainer}>
        <div className={styles.erroIcon}>!</div>
        <div className={styles.erroTitulo}>Equipamento não encontrado</div>
        <div className={styles.erroDetalhe}>{erro}</div>
        <button className={styles.back} onClick={() => navigate('/equipamentos')}>
          ← Voltar à lista
        </button>
      </div>
    )
  }

  if (!eq) return null

  const shareUrl = `${window.location.origin}/equipamentos/${id}`
  const avariasAbertas = avarias.filter((a) => !a.resolvida).length

  return (
    <div className="fade-up">
      <div className={styles.breadcrumb}>
        <button
          onClick={() => navigate('/equipamentos')}
          className={styles.back}
        >
          ← Equipamentos
        </button>

        <span className={styles.sep}>/</span>
        <span>{eq.nome}</span>

        <button
          className={styles.btnPrintLabel}
          onClick={() => qrRef.current?.print()}
          style={{ marginLeft: 'auto' }}
        >
          ⎙ Imprimir Etiqueta
        </button>
      </div>

      <div className={styles.header}>
        <div>
          <div className="mono">EQ-{String(eq.id).padStart(3, '0')}</div>
          <h1 className={styles.title}>{eq.nome}</h1>

          <div className={styles.subInfo}>
            <span>{eq.tipo}</span>
            <span>·</span>
            <span>{eq.localizacao}</span>
          </div>
        </div>

        <StatusBadge estado={eq.estado_atual} />
      </div>

      <div className={styles.infoGrid}>
        <Card label="Estado Atual">
          <StatusBadge estado={eq.estado_atual} />
        </Card>

        <Card label="Tipo">{eq.tipo}</Card>

        <Card label="Localização">{eq.localizacao}</Card>

        <Card label="Registado em">
          {fmt(eq.criado_em)}
        </Card>
      </div>

      <div className={styles.section}>
        <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Controlo OEE
          <span
            title="OEE baseado na relação entre tempo de uso real e tempo reservado"
            style={{ cursor: 'help', fontSize: 12, color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
          >
            ?
          </span>
        </div>

        {oeeData && (
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OEE (Temporal)</span>
              <span style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: 'var(--font-display)',
                color: oeeData.oee_pct >= 85 ? '#10b981' : oeeData.oee_pct >= 50 ? '#f59e0b' : '#c8102e',
              }}>
                {oeeData.oee_pct != null ? `${oeeData.oee_pct.toFixed(1)}%` : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {oeeData.tempo_real_h.toFixed(1)}h reais / {oeeData.tempo_planeado_h.toFixed(1)}h planeadas
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Taxa Sucesso Planeamento</span>
              <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {oeeData.taxa_sucesso_planeamento_pct != null ? `${oeeData.taxa_sucesso_planeamento_pct.toFixed(1)}%` : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {oeeData.reservas_sucesso}/{oeeData.total_reservas} reservas concluídas
              </span>
            </div>
          </div>
        )}

        <div className={styles.acoes}>
          {/* Mostrar "Iniciar Check-in" apenas quando disponível e sem sessão ativa */}
          {!sessaoAtiva && eq.estado_atual === 'Disponível' && (
            <button
              className={styles.btnGreen}
              onClick={handleCheckin}
            >
              Iniciar Check-in
            </button>
          )}

          {/* Bloqueio visual para estados que impedem check-in */}
          {!sessaoAtiva && eq.estado_atual !== 'Disponível' && eq.estado_atual !== 'Ocupado' && (() => {
            const bloqueios = {
              'Avariado':       { cor: 'var(--red)',   msg: '⚠ Equipamento interdito por avaria' },
              'Em manutenção':  { cor: 'var(--amber)',  msg: '⚙ Equipamento em manutenção' },
              'Em calibração':  { cor: 'var(--amber)',  msg: '◎ Equipamento em calibração' },
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
                }}
              >
                Forçar Término
              </button>

              <button
                className={styles.btnAmber}
                onClick={handleEditarSessao}
              >
                Ajustar Duração
              </button>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 auto' }}>
            {sessaoAtiva && (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                ✓ Check-in iniciado a {formatarDataHora(sessaoAtiva.inicio)}
              </div>
            )}
            {reservaAtiva?.fim_automatico && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                Termina previsto: {fmt(reservaAtiva.fim_automatico)}
                {' · '}
                {formatTempoRestante(reservaAtiva.fim_automatico)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className="label">Ações</div>

        <div className={styles.acoes}>
          <button
            className={styles.btnGreen}
            onClick={() => setModalEstado(true)}
          >
            Atualizar Estado
          </button>

          <button
            className={styles.btnRed}
            onClick={() => {
              setDataRegisto(formatDateTimeLocal())
              setModalAvaria(true)
            }}
          >
            {avariasAbertas > 0 ? 'Ver Detalhes da Avaria' : 'Registar Avaria'}
          </button>
        </div>
      </div>

      <QRCodeDisplay ref={qrRef} equipamento={eq} value={shareUrl} />

      <div className={styles.section}>
        <div className={styles.tabs}>
          <TabBtn
            active={tab === 'avarias'}
            onClick={() => setTab('avarias')}
          >
            Avarias ({avariasAbertas})
          </TabBtn>

          <TabBtn
            active={tab === 'manutencoes'}
            onClick={() => setTab('manutencoes')}
          >
            Manutenções ({manutencoes.length})
          </TabBtn>

          <TabBtn
            active={tab === 'calibracoes'}
            onClick={() => setTab('calibracoes')}
          >
            Calibrações ({calibracoes.length})
          </TabBtn>
        </div>

        {tab === 'avarias' && (
          <TabelaAvarias avarias={avarias} />
        )}

        {tab === 'manutencoes' && (
          <TabelaManutencoes manutencoes={manutencoes} />
        )}

        {tab === 'calibracoes' && (
          <TabelaCalibracoes calibracoes={calibracoes} />
        )}
      </div>

      {modalEstado && (
        <div
          className={styles.overlay}
          onClick={() => setModalEstado(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Atualizar Estado</h2>

            <div className={styles.stateOptions}>
              {ESTADOS.map((estado) => (
                <label key={estado}>
                  <input
                    type="radio"
                    checked={novoEstado === estado}
                    onChange={() => setNovoEstado(estado)}
                  />
                  {estado}
                </label>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setModalEstado(false)}
              >
                Cancelar
              </button>

              <button
                className={styles.btnAmber}
                onClick={handleEstado}
                disabled={savingEstado}
              >
                {savingEstado ? 'A guardar...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAvaria && (
        <div
          className={styles.overlay}
          onClick={() => setModalAvaria(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Registar Avaria</h2>

            {msgAvaria ? (
              <div className={styles.sucesso}>{msgAvaria}</div>
            ) : (
              <div className={styles.avariaGrid}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <span className={styles.fieldTag}>Equipamento</span>
                  </span>
                  <div className={styles.readonlyField}>
                    <strong>{eq?.codigo || '—'}</strong>
                    <span>{eq?.nome || 'Equipamento em carregamento'}</span>
                  </div>
                </div>

                <label className={styles.switchField}>
                  <span className={styles.switchText}>
                    <FontAwesomeIcon icon={faBuilding} className={styles.fieldIcon} aria-hidden="true" />
                    Empresa Externa
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
                    Data de Registo
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
                    <span className={styles.fieldTag}>Paragem</span>
                    Paragem de Equipamento
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
                    Descrição do Problema
                  </span>
                  <textarea
                    rows={4}
                    className={styles.textarea}
                    placeholder="Descreve o problema com o máximo de detalhe possível..."
                    value={descAvaria}
                    onChange={(e) =>
                      setDescAvaria(e.target.value)
                    }
                  />

                </label>

                <input
                  className={styles.input}
                  placeholder="Nº relatório"
                  value={numRelatorio}
                  onChange={(e) =>
                    setNumRelatorio(e.target.value)
                  }
                />

                <input
                  className={styles.input}
                  type="number"
                  placeholder="Custo"
                  value={custoAvaria}
                  onChange={(e) =>
                    setCustoAvaria(e.target.value)
                  }
                />

                <input
                  className={styles.input}
                  placeholder="SC / PO"
                  value={scPoAvaria}
                  onChange={(e) =>
                    setScPoAvaria(e.target.value)
                  }
                />
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => {
                  setModalAvaria(false)
                  resetAvaria()
                }}
              >
                Cancelar
              </button>

              {!msgAvaria && (
                <button
                  className={styles.btnRed}
                  onClick={handleAvaria}
                  disabled={
                    savingAvaria || !descAvaria.trim()
                  }
                >
                  {savingAvaria
                    ? 'A registar...'
                    : 'Registar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

      {modalTermino && (
        <div
          className={styles.overlay}
          onClick={() => !savingTermino && setModalTermino(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle}>Forçar Término</h2>

            <p className={styles.modalDesc}>
              A sessão de utilização será encerrada imediatamente e o equipamento
              ficará disponível. Esta ação não pode ser revertida.
            </p>

            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setModalTermino(false)}
                disabled={savingTermino}
              >
                Cancelar
              </button>

              <button
                className={styles.btnRed}
                onClick={confirmarTermino}
                disabled={savingTermino}
                style={{ background: '#dc2626', color: '#fff', border: 'none' }}
              >
                {savingTermino ? 'A encerrar...' : 'Confirmar Término'}
              </button>
            </div>
          </div>
        </div>
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

function TabelaAvarias({ avarias }) {
  return <div>Avarias: {avarias.length}</div>
}

function TabelaManutencoes({ manutencoes }) {
  return <div>Manutenções: {manutencoes.length}</div>
}

function TabelaCalibracoes({ calibracoes }) {
  return <div>Calibrações: {calibracoes.length}</div>
}