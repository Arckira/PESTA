import { requestAuthPrompt } from '../contexts/authBridge.js'
import { requestToast } from '../contexts/toastBridge.js'

// Estratégia de caminhos relativos:
//   Em desenvolvimento, o Vite faz proxy de /api/* → FastAPI:8000/* (vite.config.js).
//   Em produção, se o FastAPI servir o frontend na mesma porta/origem, os pedidos
//   /api/* chegam directamente sem proxy — sem qualquer alteração de código.
//   Desta forma nunca há hostnames ou portos hardcoded neste ficheiro.
const BASE = '/api'

const TOKEN_STORAGE_KEY = 'lab_auth_token'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
  else localStorage.removeItem(TOKEN_STORAGE_KEY)
}

function isAuthError(status) {
  return status === 401 || status === 403
}

const SERVER_ERROR_CODES = new Set([500, 502, 503])

async function request(path, options = {}, attempt = 0) {
  const { noAuthPrompt, ...fetchOptions } = options
  const token = getStoredToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(`${BASE}${path}`, { headers, ...fetchOptions })
  } catch {
    // Sem resposta do servidor (rede inacessível, CORS falhou, servidor desligado)
    requestToast('Sem ligação ao servidor. Verifica a rede.', 'error')
    const err = new Error('Network Error')
    err.status = 0
    throw err
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (isAuthError(res.status) && attempt === 0 && !noAuthPrompt) {
      const mode = String(err.detail || '').includes('PIN inicial') ? 'change-pin' : 'login'
      await requestAuthPrompt(mode)
      return request(path, options, 1)
    }
    if (SERVER_ERROR_CODES.has(res.status)) {
      requestToast('Erro de servidor. Tenta novamente.', 'error')
    }
    const error = new Error(err.detail || `Erro ${res.status}`)
    error.status = res.status
    throw error
  }
  return res.json()
}

export const api = {
  // ── Auth ──
  authListaUtilizadores: () => request('/auth/utilizadores'),
  authBootstrapStatus:    () => request('/auth/bootstrap-status', { noAuthPrompt: true }),
  authLogin:              (user_id, pin) => request('/auth/login', { method: 'POST', body: JSON.stringify({ user_id, pin }), noAuthPrompt: true }),
  authBootstrapAdmin:     (data) => request('/auth/bootstrap-admin', { method: 'POST', body: JSON.stringify(data), noAuthPrompt: true }),
  authAutoRegisto:        (data) => request('/auth/auto-registo', { method: 'POST', body: JSON.stringify(data), noAuthPrompt: true }),
  authMe:                 () => request('/auth/me', { noAuthPrompt: true }),
  authAlterarPin:         (pin_atual, novo_pin) => request('/auth/pin', { method: 'PATCH', body: JSON.stringify({ pin_atual, novo_pin }), noAuthPrompt: true }),
  authLogout:             () => request('/auth/logout', { method: 'POST', noAuthPrompt: true }),
  authLogs:               () => request('/auth/logs'),

  // ── Equipamentos ──
  listarEquipamentos:     (seccao)      => request(`/equipamentos${seccao ? `?seccao=${encodeURIComponent(seccao)}` : ''}`),
  exportarEquipamentosPdf: async ({ filtro = '', estado = '' } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams()
    if (filtro) params.set('filtro', filtro)
    if (estado) params.set('estado', estado)
    const query = params.toString()
    const res = await fetch(`${BASE}/equipamentos/exportar/pdf${query ? `?${query}` : ''}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  detalheEquipamento:     (id)          => request(`/equipamentos/${id}`),
  criarEquipamento:       (data)        => request('/equipamentos', { method: 'POST', body: JSON.stringify(data) }),
  atualizarEquipamento:   (id, data)    => request(`/equipamentos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  eliminarEquipamento:    (id)          => request(`/equipamentos/${id}`, { method: 'DELETE' }),
  atualizarEstado:        (id, novo_estado) => request(`/equipamentos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ novo_estado }) }),

  // ── Check-in / Check-out ──
  iniciarCheckin:         (id, reserva_id = null, duracao_prevista_minutos = null, projeto = null, metodo = null) =>
    request(`/equipamentos/${id}/checkin`, { method: 'POST', body: JSON.stringify({ reserva_id, duracao_prevista_minutos, projeto, metodo }) }),
  obterSessaoAtiva:       (id)          => request(`/equipamentos/${id}/sessao-ativa`),
  obterSessaoEmCurso:     (id)          => request(`/equipamentos/${id}/sessao-em-curso`),
  editarDuracaoSessao:    (id, duracao_prevista_minutos) =>
    request(`/equipamentos/${id}/sessao-ativa/duracao`, { method: 'PATCH', body: JSON.stringify({ duracao_prevista_minutos }) }),
  terminarCheckout:       (id)          => request(`/equipamentos/${id}/checkout`, { method: 'PATCH' }),
  checkoutForcado:        (id)          => request(`/equipamentos/${id}/checkout-forcado`, { method: 'PATCH' }),
  listarSessoes:          (id)          => request(`/equipamentos/${id}/sessoes`),
  eficienciaEquipamento:  (id, dias=30) => request(`/equipamentos/${id}/eficiencia?dias=${dias}`),

  // ── Avarias ──
  listarAvarias:          (equipamentoId) => request(`/equipamentos/${equipamentoId}/avarias`),
  listarTodasAvarias:     (resolvida)     => request(`/avarias${resolvida !== undefined ? `?resolvida=${resolvida}` : ''}`),
  registarAvaria:         (id, payload) => request(`/equipamentos/${id}/avaria`, { method: 'POST', body: JSON.stringify(payload) }),
  exportarAvariasPdf:     async ({ resolvida, pesquisa } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams()
    if (resolvida !== undefined) params.set('resolvida', resolvida)
    if (pesquisa) params.set('pesquisa', pesquisa)
    const query = params.toString()
    const res = await fetch(`${BASE}/avarias/exportar/pdf${query ? `?${query}` : ''}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  resolverAvaria:         (id, { relatorioTecnico, custo } = {}) => request(`/avarias/${id}/resolver`, { method: 'PUT', body: JSON.stringify({ relatorio_tecnico: relatorioTecnico || null, custo: custo ?? null }) }),
  resolverAvariaComAnexo: async (id, { relatorioTecnico, custo, ficheiro } = {}, attempt = 0) => {
    const token = getStoredToken()
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const fd = new FormData()
    fd.append('relatorio_tecnico', relatorioTecnico || '')
    if (custo != null) fd.append('custo', String(custo))
    if (ficheiro) fd.append('ficheiro', ficheiro)
    const res = await fetch(`${BASE}/avarias/${id}/resolver`, { method: 'PUT', headers, body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (isAuthError(res.status) && attempt === 0) {
        const mode = String(err.detail || '').includes('PIN inicial') ? 'change-pin' : 'login'
        await requestAuthPrompt(mode)
        return api.resolverAvariaComAnexo(id, { relatorioTecnico, custo, ficheiro }, 1)
      }
      const error = new Error(err.detail || `Erro ${res.status}`)
      error.status = res.status
      throw error
    }
    return res.json()
  },

  // ── Manutenções ──
  listarManutencoes:      (equipamentoId) => request(`/equipamentos/${equipamentoId}/manutencoes`),
  listarTodasManutencoes: ()              => request('/manutencoes'),
  registarManutencao: async (id, data, ficheiro = null, attempt = 0) => {
    const token = getStoredToken()
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const fd = new FormData()
    Object.entries(data).forEach(([key, val]) => {
      if (val !== null && val !== undefined) fd.append(key, String(val))
    })
    if (ficheiro) fd.append('ficheiro', ficheiro)
    const res = await fetch(`${BASE}/equipamentos/${id}/manutencao`, { method: 'POST', headers, body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (isAuthError(res.status) && attempt === 0) {
        const mode = String(err.detail || '').includes('PIN inicial') ? 'change-pin' : 'login'
        await requestAuthPrompt(mode)
        return api.registarManutencao(id, data, ficheiro, attempt + 1)
      }
      const error = new Error(err.detail || `Erro ${res.status}`)
      error.status = res.status
      throw error
    }
    return res.json()
  },
  concluirManutencao:     (equipamentoId, manutencaoId) => request(`/equipamentos/${equipamentoId}/manutencao/${manutencaoId}/concluir`, { method: 'PATCH' }),
  exportarManutencoesPdf: async ({ filtro = '', tipo = '' } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams()
    if (filtro) params.set('filtro', filtro)
    if (tipo) params.set('tipo', tipo)
    const query = params.toString()
    const res = await fetch(`${BASE}/manutencoes/exportar/pdf${query ? `?${query}` : ''}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },

  // ── Calibrações ──
  listarCalibracoes:      (equipamentoId) => request(`/equipamentos/${equipamentoId}/calibracoes`),
  listarTodasCalibracoes: ()              => request('/calibracoes'),
  calibracoesProximas:    (dias = 30)     => request(`/calibracoes/proximas?dias=${dias}`),
  registarCalibracao:     (id, data)      => request(`/equipamentos/${id}/calibracao`, { method: 'POST', body: JSON.stringify(data) }),
  concluirCalibracao:     (equipamentoId, calibracaoId) => request(`/equipamentos/${equipamentoId}/calibracao/${calibracaoId}/concluir`, { method: 'PATCH' }),
  exportarCalibracesPdf:  async ({ filtro = '', urgencia = '' } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams()
    if (filtro) params.set('filtro', filtro)
    if (urgencia) params.set('urgencia', urgencia)
    const query = params.toString()
    const res = await fetch(`${BASE}/calibracoes/exportar/pdf${query ? `?${query}` : ''}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },

  // ── Reservas ──
  listarReservas:         ()              => request('/reservas'),
  reservasPorDia:         (data)          => request(`/reservas/por-dia?data=${data}`),
  criarReserva:           (data)          => request('/reservas', { method: 'POST', body: JSON.stringify(data) }),
  atualizarReserva:       (id, data)      => request(`/reservas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  exportarReservasPdf:    async ()        => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const res = await fetch(`${BASE}/reservas/exportar/pdf`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  exportarPlaneamentoPdf: async ()        => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const res = await fetch(`${BASE}/planeamento/exportar/pdf`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  exportarVerificacoesPdf: async ({ filtro = '', resultado = '' } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams()
    if (filtro)    params.append('filtro', filtro)
    if (resultado) params.append('resultado', resultado)
    const query = params.toString()
    const res = await fetch(`${BASE}/verificacoes/exportar/pdf${query ? `?${query}` : ''}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  cancelarReserva:        (id)            => request(`/reservas/${id}`, { method: 'DELETE' }),

  // ── Utilizadores ──
  listarUtilizadores:     ()              => request('/utilizadores'),
  criarUtilizador:        (data)          => request('/utilizadores', { method: 'POST', body: JSON.stringify(data) }),
  atualizarUtilizador:    (id, data)      => request(`/utilizadores/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminAlterarPinUtilizador: (id, novo_pin) => request(`/utilizadores/${id}/pin`, { method: 'PATCH', body: JSON.stringify({ novo_pin }) }),
  adminAlterarRoleUtilizador: (id, role, pin_atual) => request(`/utilizadores/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role, pin_atual }) }),
  eliminarUtilizador:     (id)            => request(`/utilizadores/${id}`, { method: 'DELETE' }),

  // ── Verificações ──
  listarVerificacoesEquipamento: (equipamentoId) => request(`/equipamentos/${equipamentoId}/verificacoes`),
  registarVerificacao:           (equipamentoId, data) => request(`/equipamentos/${equipamentoId}/verificacao`, { method: 'POST', body: JSON.stringify(data) }),
  listarAnexosVerificacao:       (verificacaoId) => request(`/verificacoes/${verificacaoId}/anexos`),

  // ── Fornecedores ──
  listarFornecedores:      ()         => request('/fornecedores'),
  criarFornecedor:         (data)     => request('/fornecedores', { method: 'POST', body: JSON.stringify(data) }),
  actualizarFornecedor:    (id, data) => request(`/fornecedores/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  eliminarFornecedor:      (id)       => request(`/fornecedores/${id}`, { method: 'DELETE' }),

  // ── Financeiro ──
  resumoFinanceiro: ({ ano, mes, equipamentoId } = {}) => {
    const params = new URLSearchParams({ ano: ano ?? new Date().getFullYear() })
    if (mes != null) params.set('mes', mes)
    if (equipamentoId) params.set('equipamento_id', equipamentoId)
    return request(`/financeiro/resumo?${params}`)
  },
  exportarFinanceiroPdf: async ({ ano, mes, equipamentoId } = {}) => {
    const token = getStoredToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const params = new URLSearchParams({ ano: ano ?? new Date().getFullYear() })
    if (mes != null) params.set('mes', mes)
    if (equipamentoId) params.set('equipamento_id', equipamentoId)
    const res = await fetch(`${BASE}/financeiro/resumo/exportar/pdf?${params}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },

  // ── Dashboard OEE ──
  oeeGlobal:              (dias = 30)     => request(`/dashboard/oee?dias=${dias}`),
  oeeGlobalSummary:       (dias = 30)     => request(`/stats/oee_summary?dias=${dias}`),
  oeeHistorico:           (dias = 30)     => request(`/stats/oee_historico?dias=${dias}`),
  oeeEquipamento:         (id, dias = 30) => request(`/metricas/oee/${id}?dias=${dias}`),
}