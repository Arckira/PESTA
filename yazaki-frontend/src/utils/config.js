/**
 * Configurações de Rede para a Intranet Yazaki
 * O Hostname permite que os telemóveis encontrem o teu PC sem fixar o IP.
 *
 * Porquê window.location.hostname:
 *   Quando o utilizador acede via http://192.168.1.50:5173, este valor
 *   devolve "192.168.1.50" automaticamente. O QR Code gerado vai conter
 *   esse IP real, sem necessidade de configuração manual.
 */
export const NETWORK_HOSTNAME = window.location.hostname
export const API_PORT = '8000'
export const FRONTEND_PORT = '5173'

// URL que será embutido no QR Code para os operadores
export const QR_FRONTEND_BASE = `http://${NETWORK_HOSTNAME}:${FRONTEND_PORT}`

// URL base para as chamadas à API (FastAPI)
export const API_BASE_URL = `http://${NETWORK_HOSTNAME}:${API_PORT}`
