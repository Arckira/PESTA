let toastHandler = null

export function setToastHandler(handler) {
  toastHandler = handler
}

export function requestToast(message, type = 'error') {
  if (toastHandler) toastHandler(message, type)
}
