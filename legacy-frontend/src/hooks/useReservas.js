import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para gerir reservas: eventos para calendário, lista de equipamentos e utilizadores, actions.
 * Retorna: { eventos, equipamentos, utilizadores, loading, reload, createReserva, reservasPorDia, exportPdf }
 */
export function useReservas(userRole) {
  const [eventos, setEventos] = useState([])
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
      setEquipamentos(eqs)
      setUtilizadores(uts)

      const CORES = [
        { bg: '#1e3a5f', border: '#378ADD' },
        { bg: '#1a3a2a', border: '#1D9E75' },
        { bg: '#3a1a1a', border: '#E24B4A' },
        { bg: '#3a2a0a', border: '#EF9F27' },
        { bg: '#2a1a3a', border: '#7F77DD' },
      ]
      const corMap = {}
      eqs.forEach((eq, i) => { corMap[eq.id] = CORES[i % CORES.length] })

      const evs = reservas.map(r => ({
        id: String(r.id),
        title: r.utilizador_iniciais || (r.utilizador_nome ? r.utilizador_nome.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase() : ''),
        start: r.data_inicio,
        end: r.data_fim,
        backgroundColor: corMap[r.equipamento_id]?.bg ?? '#1e3a5f',
        borderColor: corMap[r.equipamento_id]?.border ?? '#378ADD',
        textColor: '#e8eaf0',
        extendedProps: { ...r },
      }))
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

  return useMemo(() => ({ eventos, equipamentos, utilizadores, loading, reload: load, createReserva, reservasPorDia, exportPdf }), [eventos, equipamentos, utilizadores, loading, load, createReserva, reservasPorDia, exportPdf])
}
