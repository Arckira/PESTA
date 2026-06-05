import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para gerir calibrações: lista, próximas e registo.
 * Retorna: { items, proximas, loading, reload, registar }
 */
export function useCalibracoes() {
  const [items, setItems] = useState([])
  const [proximas, setProximas] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cal, prox] = await Promise.all([
        api.listarTodasCalibracoes(),
        api.calibracoesProximas(30),
      ])
      setItems(cal)
      setProximas(prox)
    } catch (e) {
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registar = useCallback(async (eqId, payload) => {
    await api.registarCalibracao(eqId, payload)
    await load()
  }, [load])

  return useMemo(() => ({ items, proximas, loading, reload: load, registar }), [items, proximas, loading, load, registar])
}
