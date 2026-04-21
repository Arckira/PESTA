// BASE sem /api — o proxy do Vite trata de redirecionar /api/* → FastAPI:8000/*
// Porquê: centralizar aqui evita inconsistências entre páginas
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

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...fetchOptions,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (isAuthError(res.status) && attempt === 0 && !noAuthPrompt) {
      const { requestAuthPrompt } = await import('../contexts/authBridge.js')
      const mode = String(err.detail || '').includes('PIN inicial') ? 'change-pin' : 'login'
      await requestAuthPrompt(mode)
      return request(path, options, 1)
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
  authLogin:              (user_id, pin) => request('/auth/login', { method: 'POST', body: JSON.stringify({ user_id, pin }) }),
  authBootstrapAdmin:     (data) => request('/auth/bootstrap-admin', { method: 'POST', body: JSON.stringify(data), noAuthPrompt: true }),
  authMe:                 () => request('/auth/me', { noAuthPrompt: true }),
  authAlterarPin:         (pin_atual, novo_pin) => request('/auth/pin', { method: 'PATCH', body: JSON.stringify({ pin_atual, novo_pin }) }),
  authLogout:             () => request('/auth/logout', { method: 'POST', noAuthPrompt: true }),
  authLogs:               () => request('/auth/logs'),

  // ── Equipamentos ──
  listarEquipamentos:     ()            => request('/equipamentos'),
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
  iniciarCheckin:         (id, reserva_id = null) =>
    request(`/equipamentos/${id}/checkin`, { method: 'POST', body: JSON.stringify({ reserva_id }) }),
  terminarCheckout:       (id)          => request(`/equipamentos/${id}/checkout`, { method: 'PATCH' }),
  listarSessoes:          (id)          => request(`/equipamentos/${id}/sessoes`),
  eficienciaEquipamento:  (id, dias=30) => request(`/equipamentos/${id}/eficiencia?dias=${dias}`),

  // ── Avarias ──
  listarAvarias:          (equipamentoId) => request(`/equipamentos/${equipamentoId}/avarias`),
  listarTodasAvarias:     (resolvida)     => request(`/avarias${resolvida !== undefined ? `?resolvida=${resolvida}` : ''}`),
  registarAvaria:         (id, descricao) => request(`/equipamentos/${id}/avaria`, { method: 'POST', body: JSON.stringify({ descricao }) }),
  resolverAvaria:         (id, notas)     => request(`/avarias/${id}/resolver`, { method: 'PATCH', body: JSON.stringify({ notas_resolucao: notas }) }),

  // ── Manutenções ──
  listarManutencoes:      (equipamentoId) => request(`/equipamentos/${equipamentoId}/manutencoes`),
  listarTodasManutencoes: ()              => request('/manutencoes'),
  registarManutencao:     (id, data)      => request(`/equipamentos/${id}/manutencao`, { method: 'POST', body: JSON.stringify(data) }),

  // ── Calibrações ──
  listarCalibracoes:      (equipamentoId) => request(`/equipamentos/${equipamentoId}/calibracoes`),
  listarTodasCalibracoes: ()              => request('/calibracoes'),
  calibracoesProximas:    (dias = 30)     => request(`/calibracoes/proximas?dias=${dias}`),
  registarCalibracao:     (id, data)      => request(`/equipamentos/${id}/calibracao`, { method: 'POST', body: JSON.stringify(data) }),

  // ── Reservas ──
  listarReservas:         ()              => request('/reservas'),
  reservasPorDia:         (data)          => request(`/reservas/por-dia?data=${data}`),
  criarReserva:           (data)          => request('/reservas', { method: 'POST', body: JSON.stringify(data) }),
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
  cancelarReserva:        (id)            => request(`/reservas/${id}`, { method: 'DELETE' }),

  // ── Utilizadores ──
  listarUtilizadores:     ()              => request('/utilizadores'),
  criarUtilizador:        (data)          => request('/utilizadores', { method: 'POST', body: JSON.stringify(data) }),
  adminAlterarPinUtilizador: (id, novo_pin) => request(`/utilizadores/${id}/pin`, { method: 'PATCH', body: JSON.stringify({ novo_pin }) }),
  adminAlterarRoleUtilizador: (id, role, pin_atual) => request(`/utilizadores/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role, pin_atual }) }),
  eliminarUtilizador:     (id)            => request(`/utilizadores/${id}`, { method: 'DELETE' }),

  // ── Dashboard OEE ──
  oeeGlobal:              (dias = 30)     => request(`/dashboard/oee?dias=${dias}`),
}