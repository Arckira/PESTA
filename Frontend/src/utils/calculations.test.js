import { describe, expect, it } from 'vitest'
import {
  calcularDesvioDinamico,
  calcularOEEDinamico,
} from './calculations.js'

// ─── calcularOEEDinamico ──────────────────────────────────────────────────────

describe('calcularOEEDinamico', () => {
  it('devolve null quando o denominador é 0', () => {
    // Edge case: divisão por zero — sem tempo planeado até agora (reserva futura),
    // o OEE não é calculável; null sinaliza "sem dados" em vez de NaN ou Infinity,
    // evitando que o equipamento seja excluído injustamente da média global.
    expect(calcularOEEDinamico(5, 0)).toBeNull()
  })

  it('limita o OEE a 100 % em caso de overrun', () => {
    // Edge case: overrun — o ensaio demorou o dobro do planeado; o OEE não deve
    // ultrapassar 100 % porque valores acima sugeriram "super-eficiência",
    // distorcendo a métrica de forma enganosa.
    const resultado = calcularOEEDinamico(200, 100) // ratio = 2 → deve ser limitado a 1
    expect(resultado).toBe(100)
  })
})

// ─── calcularDesvioDinamico ───────────────────────────────────────────────────

describe('calcularDesvioDinamico', () => {
  it('devolve 0 quando o tempo real não excede o planeado', () => {
    // Edge case: sem excesso — quando o ensaio termina dentro do tempo reservado,
    // o desvio deve ser exactamente 0 (não negativo), porque um valor negativo
    // implicaria "poupança de tempo", conceito sem significado nesta métrica.
    const resultado = calcularDesvioDinamico(80, 100) // usou 80 % do planeado
    expect(resultado).toBe(0)
  })
})
