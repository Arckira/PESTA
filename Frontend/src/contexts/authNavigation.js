export const LOGIN_PATH = '/login'
export const PUBLIC_FALLBACK_PATH = '/manutencoes'
export const PUBLIC_PATHS = new Set(['/equipamentos', '/avarias', '/manutencoes', '/calibracoes'])

/**
 * Define a rota principal após autenticação.
 * Admin entra no dashboard; utilizador normal entra em equipamentos.
 */
export function getPostLoginPath(user) {
  if (!user) return LOGIN_PATH
  return user.role === 'admin' ? '/dashboard' : '/equipamentos'
}
