export const CORES_UTILIZADOR = [
  // Tier 1 — 8 cores espaçadas ~45° no círculo cromático (máxima distinção)
  '#E53935', // 0  H≈  0° Vermelho
  '#FF6F00', // 1  H≈ 42° Âmbar
  '#2E7D32', // 2  H≈123° Verde-floresta
  '#00695C', // 3  H≈172° Teal
  '#1565C0', // 4  H≈210° Azul
  '#3949AB', // 5  H≈235° Índigo
  '#6A1B9A', // 6  H≈280° Violeta
  '#880E4F', // 7  H≈330° Magenta

  // Tier 2 — preenchem os interstícios (~22° de gap)
  '#D84315', // 8  H≈ 20° Laranja-avermelhado
  '#F57F17', // 9  H≈ 43° Amarelo-escuro
  '#00897B', // 10 H≈174° Verde-teal
  '#0097A7', // 11 H≈187° Ciano
  '#283593', // 12 H≈227° Azul-índigo
  '#5E35B1', // 13 H≈262° Púrpura
  '#8E24AA', // 14 H≈292° Violeta-rosado
  '#AD1457', // 15 H≈336° Rosa-escuro

  // Tier 3 — variantes escuras dos tons base
  '#C62828', // 16 Vermelho-escuro
  '#E65100', // 17 Laranja-queimado
  '#33691E', // 18 Verde-musgo
  '#1B5E20', // 19 Verde-muito-escuro
  '#004D40', // 20 Teal-escuro
  '#0288D1', // 21 Azul-claro
  '#1E88E5', // 22 Azul-médio
  '#4527A0', // 23 Índigo-escuro

  // Tier 4 — complementares (início de sobreposição de hue)
  '#FF5722', // 24 Laranja-vivo
  '#BF360C', // 25 Castanho-alaranjado
  '#006064', // 26 Ciano-escuro
  '#00838F', // 27 Ciano-médio
  '#0277BD', // 28 Azul-escuro
  '#01579B', // 29 Azul-navy
  '#4A148C', // 30 Roxo-muito-escuro
  '#D81B60', // 31 Rosa-vivo

  // Tier 5 — similares, só usadas quando a equipa ultrapassa 32 pessoas
  '#F4511E', // 32 ≈ Tier1[0]
  '#E64A19', // 33 ≈ Tier1[0]
  '#6D4C41', // 34 Castanho
  '#4E342E', // 35 Castanho-escuro
  '#546E7A', // 36 Azul-acinzentado
  '#455A64', // 37 Azul-acinzentado-escuro
  '#37474F', // 38 Cinzento-azulado
  '#1A237E', // 39 Azul-muito-escuro
]

export function corDoUtilizador(userId) {
  const id = Number(userId)
  if (!Number.isFinite(id)) return CORES_UTILIZADOR[0]
  return CORES_UTILIZADOR[Math.abs(Math.trunc(id)) % CORES_UTILIZADOR.length]
}
