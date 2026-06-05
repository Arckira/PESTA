let promptHandler = null

export function setAuthPromptHandler(handler) {
  promptHandler = handler
}

export function requestAuthPrompt(mode = 'login') {
  if (!promptHandler) {
    return Promise.reject(new Error('Autenticação indisponível'))
  }
  return promptHandler(mode)
}