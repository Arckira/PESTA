import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'

/**
 * Hook para carregar lista de equipamentos e mapa por id.
 * Retorna: { list, map, loading, reload }
 */
export function useEquipamentos() {
  const [list, setList] = useState([])
  const [map, setMap] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const eqs = await api.listarEquipamentos()
      setList(eqs)
      const m = {}
      eqs.forEach(e => { m[e.id] = e })
      setMap(m)
    } catch (e) {
      // caller should handle toast/erro
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return useMemo(() => ({ list, map, loading, reload: load }), [list, map, loading, load])
}
