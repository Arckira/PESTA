/**
 * Tempo disponível = janela total − downtime de avarias, em horas.
 * @param {number} janelaHoras  - duração total da janela em horas
 * @param {number} downtimeH    - soma do downtime de avarias na janela em horas
 */
export function calcularTempoDisponivelH(janelaHoras, downtimeH) {
  return Math.max(janelaHoras - downtimeH, 0)
}

/**
 * OEE dinâmico baseado no denominador temporal disponível até ao momento.
 * Devolve null se disponivelH == 0, evitando divisão por zero e exclusão
 * injusta da média global.
 */
export function calcularOEEDinamico(tempoRealH, disponivelH) {
  if (disponivelH <= 0) return null
  return Math.min(tempoRealH / disponivelH, 1) * 100
}

/**
 * Desvio de planeamento: quanto é que o tempo real excedeu o disponível até agora.
 * Devolve 0 se não houver excesso; null se o denominador for zero.
 */
export function calcularDesvioDinamico(tempoRealH, disponivelH) {
  if (disponivelH <= 0) return null
  return Math.max(0, (tempoRealH / disponivelH - 1) * 100)
}
