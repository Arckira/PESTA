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

  const registar = useCallback(async (eqId, form) => {
    const payload = {
      descricao: form.descricao,
      data_realizada: new Date(form.data_realizada).toISOString(),
      proxima_data: form.proxima_data ? new Date(form.proxima_data).toISOString() : null,
      periodicidade_dias: form.periodicidade_dias ? Number(form.periodicidade_dias) : null,
      executado_por_id: form.executado_por_id ?? null,
      tipo_intervencao: form.tipo_intervencao || null,
      custo_eur: form.custo_eur !== '' && form.custo_eur != null ? Number(form.custo_eur) : null,
      referencia_sc_po: form.referencia_sc_po || null,
      observacoes_externas: form.observacoes_externas || null,
    }
    await api.registarManutencao(eqId, payload)
    await load()
  }, [load])

  return useMemo(() => ({ items, loading, reload: load, registar }), [items, loading, load, registar])
}
