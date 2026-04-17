/**
 * Configurações de Rede para a Intranet do Laboratorio
 * O Hostname permite que os telemóveis encontrem o teu PC sem fixar o IP.
 */
export const NETWORK_HOSTNAME = window.location.hostname; // Deteta automaticamente o nome do PC ou IP
export const API_PORT = '8000';
export const FRONTEND_PORT = '5173';

// URL que será embutido no QR Code para os operadores
export const QR_FRONTEND_BASE = `http://${NETWORK_HOSTNAME}:${FRONTEND_PORT}`;

// URL base para as chamadas à API (FastAPI)
export const API_BASE_URL = `http://${NETWORK_HOSTNAME}:${API_PORT}`;