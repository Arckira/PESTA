import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para gerir reservas: eventos para calendário, lista de equipamentos e utilizadores, actions.
 * Retorna: { eventos, equipamentos, utilizadores, loading, reload, createReserva, reservasPorDia, exportPdf }
 */
export function useReservas(userRole) {
  const [eventos, setEventos] = useState([])
  const [reservas, setReservas] = useState([])
  const [equipamentos, setEquipamentos] = useState([])
  const [utilizadores, setUtilizadores] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reservas, eqs, uts] = await Promise.all([
        api.listarReservas(),
        api.listarEquipamentos(),
        userRole === 'admin' ? api.listarUtilizadores() : Promise.resolve([]),
      ])
      setReservas(reservas)
      setEquipamentos(eqs)
      setUtilizadores(uts)

      const COR_PLANEADO = { bg: '#1e3a5f', border: '#378ADD' }

      const evs = []
      reservas.forEach(r => {
        const iniciais = r.utilizador_iniciais || (r.utilizador_nome ? r.utilizador_nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : '')

        // Evento A — Planeado: intervalo original da reserva, sempre presente
        evs.push({
          id: `planeado-${r.id}`,
          title: iniciais,
          start: r.data_inicio,
          end: r.data_fim,
          backgroundColor: COR_PLANEADO.bg,
          borderColor: COR_PLANEADO.border,
          textColor: '#e8eaf0',
          zIndex: 1,
          extendedProps: { ...r, tipo: 'planeado' },
        })

        // Evento B — Real: só existe se houve check-in (sessao_inicio preenchido)
        if (r.sessao_inicio) {
          const emCurso = r.esta_ativa === true
          const fimReal = emCurso ? new Date().toISOString() : r.sessao_fim
          evs.push({
            id: `real-${r.id}`,
            title: iniciais,
            start: r.sessao_inicio,
            end: fimReal,
            backgroundColor: '#0e2a1a',
            borderColor: '#1D9E75',
            textColor: '#e8eaf0',
            zIndex: 2,
            classNames: ['fc-event-real', emCurso ? 'fc-event-real--curso' : 'fc-event-real--concluido'],
            extendedProps: { ...r, tipo: 'real', emCurso },
          })
        }
      })
      setEventos(evs)
    } catch (e) {
      throw e
    } finally {
      setLoading(false)
    }
  }, [userRole])

  useEffect(() => { load() }, [load])

  const createReserva = useCallback(async (payload) => {
    await api.criarReserva(payload)
    await load()
  }, [load])

  const reservasPorDia = useCallback(async (data) => {
    return api.reservasPorDia(data)
  }, [])

  const exportPdf = useCallback(async () => {
    return api.exportarReservasPdf()
  }, [])

  return useMemo(() => ({ eventos, reservas, equipamentos, utilizadores, loading, reload: load, createReserva, reservasPorDia, exportPdf }), [eventos, reservas, equipamentos, utilizadores, loading, load, createReserva, reservasPorDia, exportPdf])
}
