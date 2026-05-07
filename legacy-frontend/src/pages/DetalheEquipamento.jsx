import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import QRCodeDisplay from '../components/QRCode/QRCodeDisplay.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import styles from './DetalheEquipamento.module.css'

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
  const { user, openAuthPrompt, setRedirectPath } = useAuth()
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
  const [empresaExterna, setEmpresaExterna] = useState('')
  const [numRelatorio, setNumRelatorio] = useState('')
  const [custoAvaria, setCustoAvaria] = useState('')
  const [scPoAvaria, setScPoAvaria] = useState('')
  const [modalDuracao, setModalDuracao] = useState(false)
  const [duracaoEstimada, setDuracaoEstimada] = useState('')
  const [duracaoUnidade, setDuracaoUnidade] = useState('horas')
  const [savingCheckin, setSavingCheckin] = useState(false)
  const [sessaoAtiva, setSessaoAtiva] = useState(null)  // Sessão em progresso do utilizador atual
  const [reservaAtiva, setReservaAtiva] = useState(null)
  const [modoEdicao, setModoEdicao] = useState(false)  // true se estamos editando uma sessão existente
  const [modalTermino, setModalTermino] = useState(false)
  const [savingTermino, setSavingTermino] = useState(false)
  const autoReloadTimerRef = useRef(null)
  // Garante que a ação QR só é processada uma vez por montagem do componente
  const qrAcaoProcessadaRef = useRef(false)

  const resetAvaria = () => {
    setDescAvaria('')
    setEmpresaExterna('')
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
      // Operador não autenticado: guardar destino e abrir modal de login
      setRedirectPath(`/equipamentos/${id}?action=checkin`)
      openAuthPrompt('login')
      return
    }

    // Operador autenticado: abrir modal de check-in automaticamente se o equipamento o permitir
    if (!sessaoAtiva && eq?.estado_atual !== 'Ocupado') {
      setDuracaoEstimada('')
      setDuracaoUnidade('horas')
      setModoEdicao(false)
      setModalDuracao(true)
    } else if (sessaoAtiva) {
      toast.info?.('Já existe uma sessão ativa neste equipamento.')
    }
  }, [loading, acaoQR, user, sessaoAtiva, eq, id, openAuthPrompt, setRedirectPath, toast])

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
    // Mostrar modal para pedir a duração estimada (novo check-in ou edição)
    if (sessaoAtiva) {
      // Modo edição: pré-preencher com duração atual
      setDuracaoEstimada('')
      setDuracaoUnidade('horas')
      setModoEdicao(true)
    } else {
      // Modo criação: limpar campos
      setDuracaoEstimada('')
      setDuracaoUnidade('horas')
      setModoEdicao(false)
    }
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
    if (reservaAtiva?.duracao_prevista_minutos) {
      setDuracaoEstimada(String(reservaAtiva.duracao_prevista_minutos))
      setDuracaoUnidade('minutos')
    } else {
      setDuracaoEstimada('')
      setDuracaoUnidade('horas')
    }
    setModalDuracao(true)
  }

  const handleConfirmarCheckin = async () => {
    const raw = parseFloat(String(duracaoEstimada).replace(',', '.'))
    if (!raw || raw <= 0) {
      toast.error('Introduza uma duração válida.')
      return
    }

    // converter para minutos conforme unidade selecionada
    let minutos = 0
    switch (duracaoUnidade) {
      case 'minutos':
        minutos = Math.max(1, Math.ceil(raw))
        break
      case 'horas':
        minutos = Math.max(1, Math.ceil(raw * 60))
        break
      case 'dias':
        minutos = Math.max(1, Math.ceil(raw * 24 * 60))
        break
      case 'semanas':
        minutos = Math.max(1, Math.ceil(raw * 7 * 24 * 60))
        break
      default:
        minutos = Math.max(1, Math.ceil(raw))
    }

    setSavingCheckin(true)
    try {
      if (modoEdicao) {
        // Editar duração com base na data_inicio original da reserva
        const token = localStorage.getItem('lab_auth_token')
        const res = await fetch(`/api/atualizar-duracao/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ duracao_prevista_minutos: minutos }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          const error = new Error(err.detail || `Erro ${res.status}`)
          error.status = res.status
          throw error
        }
        toast.success('Duração atualizada com sucesso.')
      } else {
        // Criar novo check-in
        await api.iniciarCheckin(id, null, minutos)
        toast.success('Check-in iniciado com sucesso.')
      }
      setModalDuracao(false)
      setDuracaoEstimada('')
      setDuracaoUnidade('horas')
      setModoEdicao(false)
      carregar()
    } catch (e) {
      // Tratamento específico de erros com melhor feedback ao utilizador
      let mensagem = e.message
      
      if (e.status === 409) {
        // 409: Conflito - já existe check-in ativo (se modoEdicao=false) ou outro utilizador em uso
        if (!modoEdicao) {
          mensagem = e.message || 'Equipamento já tem um check-in ativo. Use "Editar Duração" para modificar.'
          // Recarregar para atualizar a sessão ativa
          setTimeout(() => carregar(), 500)
        } else {
          mensagem = e.message || 'Erro ao atualizar a duração.'
        }
      } else if (e.status === 400) {
        // Erro de validação (estado inválido, etc)
        mensagem = e.message || 'Não é possível iniciar o ensaio neste momento.'
      } else if (e.status === 503) {
        // Erro de base de dados
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
        <div className="label">Controlo OEE</div>

        <div className={styles.acoes}>
          {/* Mostrar "Iniciar Check-in" apenas quando não existe sessão ativa */}
          {!sessaoAtiva && eq.estado_atual !== 'Ocupado' && eq.estado_atual !== 'Avariado' && (
            <button
              className={styles.btnGreen}
              onClick={handleCheckin}
            >
              Iniciar Check-in
            </button>
          )}

          {/* Bloqueio visual se Avariado */}
          {eq.estado_atual === 'Avariado' && !sessaoAtiva && (
            <button
              className={styles.btnRed}
              disabled
              title="Equipamento interdito por avaria"
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              Iniciar Check-in
            </button>
          )}

          {/* Mostrar aviso se Avariado */}
          {eq.estado_atual === 'Avariado' && (
            <div style={{ padding: '10px 14px', background: 'var(--red-glow)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
              ⚠ Equipamento interdito por avaria
            </div>
          )}

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
            onClick={() => setModalAvaria(true)}
          >
            {avariasAbertas > 0 ? 'Ver Detalhes da Avaria' : 'Registar Avaria'}
          </button>
        </div>
      </div>

      <QRCodeDisplay equipamento={eq} />

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
              <>
                <textarea
                  rows={4}
                  className={styles.input}
                  placeholder="Descrição do problema..."
                  value={descAvaria}
                  onChange={(e) =>
                    setDescAvaria(e.target.value)
                  }
                />

                <input
                  className={styles.input}
                  placeholder="Empresa externa"
                  value={empresaExterna}
                  onChange={(e) =>
                    setEmpresaExterna(e.target.value)
                  }
                />

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
              </>
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
        <div
          className={styles.overlay}
          onClick={() => setModalDuracao(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{modoEdicao ? 'Editar Duração' : 'Duração Estimada do Ensaio'}</h2>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '13px' }}>
              {modoEdicao 
                ? 'Qual é a nova duração estimada?'
                : 'Qual é a duração estimada?'
              }
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input
                type="number"
                className={styles.input}
                placeholder="ex: 2"
                min="0"
                step="any"
                value={duracaoEstimada}
                onChange={(e) => setDuracaoEstimada(e.target.value)}
                style={{ flex: 1, padding: '10px 12px' }}
              />

              <select
                className={styles.input}
                value={duracaoUnidade}
                onChange={(e) => setDuracaoUnidade(e.target.value)}
                style={{ width: 140 }}
              >
                <option value="minutos">Minutos</option>
                <option value="horas">Horas</option>
                <option value="dias">Dias</option>
                <option value="semanas">Semanas</option>
              </select>
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => {
                  setModalDuracao(false)
                  setDuracaoEstimada('')
                  setDuracaoUnidade('horas')
                }}
              >
                Cancelar
              </button>

              <button
                className={styles.btnGreen}
                onClick={handleConfirmarCheckin}
                disabled={savingCheckin || !duracaoEstimada}
              >
                {savingCheckin 
                  ? (modoEdicao ? 'A guardar...' : 'A iniciar...')
                  : (modoEdicao ? 'Guardar' : 'Confirmar')
                }
              </button>
            </div>
          </div>
        </div>
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