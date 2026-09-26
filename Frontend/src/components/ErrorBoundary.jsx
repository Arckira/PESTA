import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { temErro: false }
  }

  static getDerivedStateFromError() {
    return { temErro: true }
  }

  componentDidCatch(erro, info) {
    console.error('[ErrorBoundary] Erro capturado:', erro, info)
  }

  render() {
    if (this.state.temErro) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Ocorreu um erro inesperado. Recarrega a página.</p>
          <button onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
