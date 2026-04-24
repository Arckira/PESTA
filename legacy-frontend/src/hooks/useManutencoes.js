import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para gerir manutenções: lista e registo.
 * Retorna: { items, loading, reload, registar }
 */
export function useManutencoes() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const mn = await api.listarTodasManutencoes()
      setItems(mn)
    } catch (e) {
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registar = useCallback(async (eqId, payload) => {
    await api.registarManutencao(eqId, payload)
    await load()
  }, [load])

  return useMemo(() => ({ items, loading, reload: load, registar }), [items, loading, load, registar])
}
