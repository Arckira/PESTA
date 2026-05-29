/**
 * Tempo planeado até ao momento atual para uma reserva, em milissegundos.
 * Reservas futuras devolvem 0; reservas em curso contam desde o início até agora;
 * reservas concluídas contam a duração total.
 */
export function calcularPlaneadoAteAgoraMs(reserva) {
  const agora = new Date()
  const inicio = new Date(reserva.data_inicio)
  const fim = new Date(reserva.data_fim)
  if (agora <= inicio) return 0
  return Math.min(agora.getTime(), fim.getTime()) - inicio.getTime()
}

/**
 * Soma o tempo planeado até agora (em horas) para um conjunto de reservas de
 * um mesmo equipamento.
 */
export function calcularTotalPlaneadoAteAgoraH(reservasDoEquipamento) {
  const totalMs = (reservasDoEquipamento || []).reduce(
    (acc, r) => acc + calcularPlaneadoAteAgoraMs(r),
    0,
  )
  return totalMs / 3_600_000
}

/**
 * OEE dinâmico baseado no denominador temporal até ao momento.
 * Devolve null se planeadoAteAgoraH == 0 (reserva futura), evitando divisão
 * por zero e exclusão injusta da média global.
 */
export function calcularOEEDinamico(tempoRealH, planeadoAteAgoraH) {
  if (planeadoAteAgoraH <= 0) return null
  return Math.min(tempoRealH / planeadoAteAgoraH, 1) * 100
}

/**
 * Desvio de planeamento: quanto é que o tempo real excedeu o planeado até agora.
 * Devolve 0 se não houver excesso; null se o denominador for zero.
 */
export function calcularDesvioDinamico(tempoRealH, planeadoAteAgoraH) {
  if (planeadoAteAgoraH <= 0) return null
  return Math.max(0, (tempoRealH / planeadoAteAgoraH - 1) * 100)
}
