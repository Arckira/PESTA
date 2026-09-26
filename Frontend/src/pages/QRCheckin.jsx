import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/index.js'
import StatusBadge from '../components/StatusBadge.jsx'
import { useToast } from '../components/ToastProvider.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useLanguage } from '../contexts/useLanguage.js'
import styles from './QRCheckin.module.css'

const ESTADOS_BLOQUEANTES = ['Avariado', 'Em manutenção', 'Em calibração']

function minutosParaValorUnidade(minutos) {
  if (!minutos || minutos <= 0) return { valor: '', unidade: 'horas' }
  const horas = minutos / 60
  if (horas >= 24 && horas % 24 === 0) return { valor: String(horas / 24), unidade: 'dias' }
  return { valor: String(horas % 1 === 0 ? horas : horas.toFixed(1)), unidade: 'horas' }
}

export default function QRCheckin() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, openAuthPrompt } = useAuth()
  const { lang, setLang } = useLanguage()
  const { error: toastError } = useToast()

  const [equipamento, setEquipamento] = useState(null)
  const [sessaoAtiva, setSessaoAtiva] = useState(null)
  // pageState: 'loading' | 'unauth' | 'form' | 'active' | 'blocked' | 'success' | 'error'
  const [pageState, setPageState] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const [projeto, setProjeto] = useState('')
  const [metodo, setMetodo] = useState('')
  const [duracaoValor, setDuracaoValor] = useState('')
  const [duracaoUnidade, setDuracaoUnidade] = useState('horas')

  useEffect(() => {
    let cancelado = false
    setPageState('loading')

    async function carregar() {
      try {
        const eq = await api.detalheEquipamento(id)
        if (cancelado) return
        setEquipamento(eq)

        if (!user) {
          setPageState('unauth')
          return
        }

        const sessao = await api.obterSessaoAtiva(id).catch(() => null)
        if (cancelado) return

        if (sessao?.id) {
          setSessaoAtiva(sessao)
          setPageState('active')
          return
        }

        const estado = eq.estado ?? 'Disponível'
        if (ESTADOS_BLOQUEANTES.includes(estado)) {
          setPageState('blocked')
          return
        }

        setPageState('form')
      } catch {
        if (!cancelado) {
          setErrorMsg('Não foi possível carregar o equipamento.')
          setPageState('error')
        }
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [id, user])

  const rawDuracao = parseFloat(String(duracaoValor).replace(',', '.'))
  const duracaoMinutos = !isNaN(rawDuracao) && rawDuracao > 0
    ? Math.max(1, Math.round(rawDuracao * (duracaoUnidade === 'dias' ? 1440 : 60)))
    : 0
  const podeConfirmar = projeto.trim() !== '' && metodo.trim() !== '' && duracaoMinutos > 0 && !saving

  async function handleConfirmar() {
    if (!podeConfirmar) return
    setSaving(true)
    try {
      await api.iniciarCheckin(id, null, duracaoMinutos, projeto.trim(), metodo.trim())
      setPageState('success')
    } catch (err) {
      const msg = err?.message || 'Erro ao registar check-in.'
      setErrorMsg(msg)
      toastError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>LAB TC</span>
        <button
          className={styles.btnLang}
          onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
          aria-label="Mudar idioma"
        >
          🌐 {lang === 'pt' ? 'EN' : 'PT'}
        </button>
      </header>

      <main className={styles.body}>
        {pageState === 'loading' && (
          <div className={styles.centrado}>
            <div className={styles.spinner} />
            <p className={styles.spinnerTexto}>A carregar equipamento…</p>
          </div>
        )}

        {pageState === 'error' && !equipamento && (
          <div className={styles.blockedCard}>
            <p className={styles.blockedTitulo}>Erro</p>
            <p className={styles.blockedTexto}>{errorMsg}</p>
          </div>
        )}

        {equipamento && pageState !== 'loading' && (
          <>
            {/* Identificação do equipamento */}
            <div className={styles.equipCard}>
              <StatusBadge estado={equipamento.estado} />
              <div className={styles.equipCodigo}>{equipamento.codigo}</div>
              <div className={styles.equipNome}>{equipamento.nome}</div>
              {equipamento.localizacao && (
                <div className={styles.equipLocal}>{equipamento.localizacao}</div>
              )}
            </div>

            {/* Não autenticado */}
            {pageState === 'unauth' && (
              <button
                className={styles.btnPrimary}
                onClick={() => openAuthPrompt('login', `/checkin/${id}`)}
              >
                Entrar para fazer Check-in
              </button>
            )}

            {/* Sessão já activa */}
            {pageState === 'active' && sessaoAtiva && (
              <div className={styles.successCard}>
                <p className={styles.successTitulo}>Sessão já activa</p>
                {sessaoAtiva.inicio && (
                  <p className={styles.successSub}>
                    Iniciada às{' '}
                    {new Date(sessaoAtiva.inicio).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Equipamento bloqueante */}
            {pageState === 'blocked' && (
              <div className={styles.blockedCard}>
                <p className={styles.blockedTitulo}>Equipamento indisponível</p>
                <p className={styles.blockedTexto}>
                  Estado actual: <strong>{equipamento.estado}</strong>.
                  Não é possível iniciar um ensaio.
                </p>
              </div>
            )}

            {/* Sucesso */}
            {pageState === 'success' && (
              <div className={styles.successCard}>
                <p className={styles.successIcone}>✓</p>
                <p className={styles.successTitulo}>Check-in registado</p>
                <p className={styles.successSub}>Ensaio iniciado com sucesso.</p>
              </div>
            )}

            {/* Formulário de check-in */}
            {pageState === 'form' && user && (
              <div className={styles.form}>
                <div className={styles.field}>
                  <span className={styles.label}>Utilizador</span>
                  <div className={styles.readonlyRow}>
                    {user.nome ?? user.email ?? '—'}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="qr-projeto">
                    Projecto <span className={styles.obrigatorio}>*</span>
                  </label>
                  <input
                    id="qr-projeto"
                    className={styles.input}
                    type="text"
                    value={projeto}
                    onChange={(e) => setProjeto(e.target.value)}
                    placeholder="Nome do projecto"
                    autoComplete="off"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="qr-metodo">
                    Método de ensaio <span className={styles.obrigatorio}>*</span>
                  </label>
                  <input
                    id="qr-metodo"
                    className={styles.input}
                    type="text"
                    value={metodo}
                    onChange={(e) => setMetodo(e.target.value)}
                    placeholder="Ex: ISO 1234, IEC 60068-2"
                    autoComplete="off"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="qr-duracao">
                    Duração prevista <span className={styles.obrigatorio}>*</span>
                  </label>
                  <div className={styles.duracaoRow}>
                    <input
                      id="qr-duracao"
                      className={styles.input}
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={duracaoValor}
                      onChange={(e) => setDuracaoValor(e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                    <select
                      className={styles.input}
                      value={duracaoUnidade}
                      onChange={(e) => setDuracaoUnidade(e.target.value)}
                    >
                      <option value="horas">horas</option>
                      <option value="dias">dias</option>
                    </select>
                  </div>
                </div>

                {pageState === 'error' && errorMsg && (
                  <p className={styles.erroInline}>{errorMsg}</p>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer com acções */}
      {pageState !== 'loading' && (
        <footer className={styles.footer}>
          {pageState === 'form' && (
            <button
              className={styles.btnPrimary}
              onClick={handleConfirmar}
              disabled={!podeConfirmar}
            >
              {saving ? 'A registar…' : 'Confirmar Check-in'}
            </button>
          )}

          {(pageState === 'active' || pageState === 'blocked' || pageState === 'success') && (
            <button
              className={styles.btnPrimary}
              onClick={() => navigate(`/equipamentos/${id}`)}
            >
              Ver Detalhes
            </button>
          )}

          {pageState !== 'success' && pageState !== 'unauth' && (
            <button
              className={styles.btnSecondary}
              onClick={() => navigate(-1)}
            >
              Cancelar
            </button>
          )}
        </footer>
      )}
    </div>
  )
}
