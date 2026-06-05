import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para gerir avarias: lista, reload e ações (resolver).
 * Retorna: { items, loading, reload, resolveAvaria }
 */
export function useAvarias(filtro = undefined) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (f = filtro) => {
    setLoading(true)
    try {
      const resolvida = f === 'abertas' ? false : f === 'resolvidas' ? true : undefined
      const av = await api.listarTodasAvarias(resolvida)
      setItems(av)
    } catch (e) {
      throw e
    } finally {
      setLoading(false)
    }
  }, [filtro])

  useEffect(() => { load() }, [load])

  const resolveAvaria = useCallback(async (id, notas) => {
    await api.resolverAvaria(id, notas)
    await load()
  }, [load])

  return useMemo(() => ({ items, loading, reload: load, resolveAvaria }), [items, loading, load, resolveAvaria])
}
