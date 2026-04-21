import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from './ToastProvider.jsx'
import styles from './LoginModal.module.css'

export default function LoginModal() {
  const toast = useToast()
  const { login, lastUserId, user, alterarPin, promptOpen, promptMode, closeAuthPrompt, openBootstrapPrompt } = useAuth()
  const [utilizadores, setUtilizadores] = useState([])
  const [carregarLista, setCarregarLista] = useState(true)
  const [userId, setUserId] = useState('')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [trocaPin, setTrocaPin] = useState(false)
  const [pinAtual, setPinAtual] = useState('')
  const [pinNovo, setPinNovo] = useState('')
  const [bootstrapNome, setBootstrapNome] = useState('')
  const [bootstrapNumero, setBootstrapNumero] = useState('')
  const [bootstrapDepartamento, setBootstrapDepartamento] = useState('')
  const [bootstrapPin, setBootstrapPin] = useState('')
  const [bootstrapSucesso, setBootstrapSucesso] = useState(false)

  useEffect(() => {
    if (promptMode === 'bootstrap-admin') {
      setCarregarLista(false)
      return
    }

    setCarregarLista(true)
    api.authListaUtilizadores()
      .then((lista) => {
        setUtilizadores(lista)
        if (lista.length > 0) {
          const existeUltimo = lista.some((u) => String(u.id) === String(lastUserId))
          setUserId(existeUltimo ? String(lastUserId) : String(lista[0].id))
        }
      })
      .catch((e) => {
        setErro(e.message)
      })
      .finally(() => setCarregarLista(false))
  }, [lastUserId])

  useEffect(() => {
    if (promptMode === 'change-pin' || user?.forcar_troca_pin) {
      setTrocaPin(true)
      setPinAtual('')
      setPinNovo('')
    } else {
      setTrocaPin(false)
    }
  }, [promptMode, user])

  useEffect(() => {
    if (promptMode !== 'bootstrap-admin') {
      setBootstrapSucesso(false)
      return
    }
    setErro('')
    setBootstrapNome('')
    setBootstrapNumero('')
    setBootstrapDepartamento('')
    setBootstrapPin('')
    setTrocaPin(false)
  }, [promptMode])

  const utilizadorSelecionado = useMemo(
    () => utilizadores.find((u) => String(u.id) === String(userId)),
    [utilizadores, userId],
  )

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!userId) {
      setErro('Seleciona um utilizador.')
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      setErro('PIN deve ter 4 dígitos.')
      return
    }

    setSubmitting(true)
    setErro('')
    try {
      await login({ userId: Number(userId), pin })
      setPin('')
      toast.success('Sessão iniciada com sucesso.')
    } catch (e2) {
      setErro(e2.message)
      toast.error(e2.message || 'Falha no login.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleTrocaPin = async (e) => {
    e.preventDefault()
    if (!/^\d{4}$/.test(pinAtual) || !/^\d{4}$/.test(pinNovo)) {
      setErro('PIN atual e novo PIN devem ter 4 dígitos.')
      return
    }
    if (pinAtual === pinNovo) {
      setErro('Novo PIN deve ser diferente do atual.')
      return
    }

    setSubmitting(true)
    setErro('')
    try {
      await alterarPin(pinAtual, pinNovo)
      setTrocaPin(false)
      setPinAtual('')
      setPinNovo('')
      toast.success('PIN alterado com sucesso.')
    } catch (e2) {
      setErro(e2.message)
      toast.error(e2.message || 'Não foi possível alterar o PIN.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleBootstrapAdmin = async (e) => {
    e.preventDefault()
    if (!bootstrapNome || !bootstrapNumero || !bootstrapDepartamento) {
      setErro('Preenche nome, número de colaborador e departamento.')
      return
    }
    if (!/^\d{4}$/.test(bootstrapPin)) {
      setErro('O PIN inicial deve ter 4 dígitos.')
      return
    }

    setSubmitting(true)
    setErro('')
    try {
      const resposta = await api.authBootstrapAdmin({
        nome: bootstrapNome,
        numero_colaborador: bootstrapNumero,
        departamento: bootstrapDepartamento,
        pin: bootstrapPin,
      })
      setBootstrapSucesso(true)
      await login({ userId: resposta.utilizador_id, pin: bootstrapPin })
      toast.success('Administrador inicial criado e sessão iniciada.')
    } catch (e2) {
      setErro(e2.message)
      toast.error(e2.message || 'Não foi possível criar o administrador.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!promptOpen && !trocaPin) {
    return null
  }

  if (promptMode === 'bootstrap-admin') {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className="label">Primeira configuração</div>
          <h1 className={styles.title}>Criar administrador da empresa</h1>
          <p className={styles.helper}>Ainda não existe nenhum administrador. Cria o primeiro utilizador com permissões totais.</p>

          <form className={styles.form} onSubmit={handleBootstrapAdmin}>
            <label className={styles.field}>
              <span>Nome</span>
              <input value={bootstrapNome} onChange={(e) => setBootstrapNome(e.target.value)} placeholder="Ex: Tiago Silva" />
            </label>

            <label className={styles.field}>
              <span>Nº colaborador</span>
              <input value={bootstrapNumero} onChange={(e) => setBootstrapNumero(e.target.value)} placeholder="Ex: 7700205" />
            </label>

            <label className={styles.field}>
              <span>Departamento</span>
              <input value={bootstrapDepartamento} onChange={(e) => setBootstrapDepartamento(e.target.value)} placeholder="Ex: Testing" />
            </label>

            <label className={styles.field}>
              <span>PIN inicial</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={bootstrapPin}
                onChange={(e) => setBootstrapPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
              />
            </label>

            {bootstrapSucesso && <div className={styles.helper}>Administrador criado. A entrar no sistema...</div>}
            {erro && <div className={styles.error}>{erro}</div>}

            <button className={styles.primary} type="submit" disabled={submitting}>
              {submitting ? 'A criar...' : 'Criar administrador'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (!trocaPin) {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className="label">Autenticação</div>
          <h1 className={styles.title}>Entrar no sistema</h1>
          {carregarLista ? (
            <p className={styles.loading}>A carregar utilizadores...</p>
          ) : (
            <form className={styles.form} onSubmit={handleLogin}>
              <label className={styles.field}>
                <span>Utilizador</span>
                <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  {utilizadores.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                />
              </label>

              {utilizadorSelecionado && (
                <p className={styles.helper}>Selecionado: <strong>{utilizadorSelecionado.nome}</strong></p>
              )}

              {utilizadores.length === 0 && (
                <div className={styles.helper}>
                  Ainda não há utilizadores configurados. Usa a primeira configuração para criar o administrador.
                </div>
              )}

              {erro && <div className={styles.error}>{erro}</div>}

              {utilizadores.length === 0 && (
                <button className={styles.secondary} type="button" onClick={openBootstrapPrompt}>
                  Ir para primeira configuração
                </button>
              )}

              <button className={styles.primary} type="submit" disabled={submitting}>
                {submitting ? 'A entrar...' : 'Entrar'}
              </button>
              <button className={styles.secondary} type="button" onClick={closeAuthPrompt}>
                Cancelar
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className="label">Primeiro acesso</div>
        <h1 className={styles.title}>Altera o teu PIN</h1>
        <p className={styles.helper}>O PIN inicial tem de ser alterado antes de continuar.</p>

        <form className={styles.form} onSubmit={handleTrocaPin}>
          <label className={styles.field}>
            <span>PIN atual</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinAtual}
              onChange={(e) => setPinAtual(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>

          <label className={styles.field}>
            <span>Novo PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinNovo}
              onChange={(e) => setPinNovo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>

          {erro && <div className={styles.error}>{erro}</div>}

          <button className={styles.primary} type="submit" disabled={submitting}>
            {submitting ? 'A atualizar...' : 'Guardar novo PIN'}
          </button>
          <button className={styles.secondary} type="button" onClick={closeAuthPrompt}>
            Cancelar
          </button>
        </form>
      </div>
    </div>
  )
}
