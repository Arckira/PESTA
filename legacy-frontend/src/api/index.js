// BASE sem /api — o proxy do Vite trata de redirecionar /api/* → FastAPI:8000/*
// Porquê: centralizar aqui evita inconsistências entre páginas
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Erro ${res.status}`)
  }
  return res.json()
}

export const api = {
  // ── Equipamentos ──
  listarEquipamentos:     ()            => request('/equipamentos'),
  detalheEquipamento:     (id)          => request(`/equipamentos/${id}`),
  criarEquipamento:       (data)        => request('/equipamentos', { method: 'POST', body: JSON.stringify(data) }),
  atualizarEquipamento:   (id, data)    => request(`/equipamentos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  eliminarEquipamento:    (id)          => request(`/equipamentos/${id}`, { method: 'DELETE' }),
  atualizarEstado:        (id, novo_estado) => request(`/equipamentos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ novo_estado }) }),

  // ── Check-in / Check-out ──
  iniciarCheckin:         (id, utilizador, reserva_id = null) =>
    request(`/equipamentos/${id}/checkin`, { method: 'POST', body: JSON.stringify({ utilizador, reserva_id }) }),
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
    const res = await fetch(`${BASE}/reservas/exportar/pdf`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Erro ${res.status}`)
    }
    return res.blob()
  },
  exportarPlaneamentoPdf: async ()        => {
    const res = await fetch(`${BASE}/planeamento/exportar/pdf`)
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
  eliminarUtilizador:     (id)            => request(`/utilizadores/${id}`, { method: 'DELETE' }),

  // ── Dashboard OEE ──
  oeeGlobal:              (dias = 30)     => request(`/dashboard/oee?dias=${dias}`),
}