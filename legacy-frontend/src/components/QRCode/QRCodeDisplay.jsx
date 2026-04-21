import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { QR_FRONTEND_BASE } from '../../utils/config.js'
import styles from './QRCodeDisplay.module.css'

/**
 * Componente de exibição e impressão de QR Code.
 *
 * Porquê QRCodeCanvas em vez de QRCodeSVG:
 *   O canvas permite extrair os dados como imagem PNG via toDataURL(),
 *   garantindo que a etiqueta impressa é idêntica ao ecrã,
 *   independentemente das folhas de estilo do browser.
 *
 * Porquê QR_FRONTEND_BASE do config.js:
 *   O URL no QR tem de ser o IP real da rede interna (ex: http://192.168.1.50:5173)
 *   para que o telemóvel consiga abrir a página — localhost não funciona fora do PC.
 */
export default function QRCodeDisplay({ equipamento }) {
  const canvasRef = useRef(null)

  const url = `${QR_FRONTEND_BASE}/equipamentos/${equipamento.id}`

  const handlePrint = () => {
    const canvas = canvasRef.current?.querySelector('canvas')
    const qrDataUrl = canvas ? canvas.toDataURL('image/png') : ''

    const janela = window.open('', '_blank', 'width=420,height=580')
    janela.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiqueta — ${equipamento.codigo}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;display:flex;justify-content:center;
         align-items:center;min-height:100vh;background:#fff}
    .etiqueta{border:2px solid #111;border-radius:8px;padding:20px 24px;
               text-align:center;width:260px}
    .industrial-testing-lab{font-size:11px;font-weight:700;letter-spacing:.15em;
             color:#c8102e;margin-bottom:12px}
    .codigo{font-size:24px;font-weight:700;letter-spacing:.1em;
             font-family:'Courier New',monospace;margin-bottom:2px}
    .nome{font-size:12px;color:#444;margin-bottom:16px;font-weight:500}
    .tipo{font-size:11px;color:#777;margin-bottom:16px}
    img.qr{width:180px;height:180px;display:block;margin:0 auto 12px}
    .url{font-size:8px;color:#aaa;word-break:break-all;
          font-family:'Courier New',monospace;margin-top:8px}
    @media print{body{margin:0}}
  </style>
</head>
<body>
  <div class="etiqueta">
    <div class="industrial-testing-lab">INDUSTRIAL TESTING LAB · TESTING CENTRE</div>
    <div class="codigo">${equipamento.codigo}</div>
    <div class="nome">${equipamento.nome}</div>
    <div class="tipo">${equipamento.tipo} · ${equipamento.localizacao}</div>
    <img class="qr" src="${qrDataUrl}" alt="QR Code">
    <div class="url">${url}</div>
  </div>
  <script>window.onload=()=>{window.print();window.close()}<\/script>
</body>
</html>`)
    janela.document.close()
  }

  return (
    <div className={styles.wrap}>
      <div className="label" style={{ marginBottom: 12 }}>QR Code do Equipamento</div>

      <div className={styles.preview}>
        <div ref={canvasRef}>
          <QRCodeCanvas
            value={url}
            size={160}
            level="H"
            includeMargin
            bgColor="#ffffff"
            fgColor="#111111"
          />
        </div>
        <div className={styles.previewCodigo}>{equipamento.codigo}</div>
        <div className={styles.previewNome}>{equipamento.nome}</div>
        <div className={styles.previewUrl}>{url}</div>
      </div>

      <button className={styles.btnPrint} onClick={handlePrint}>
        ⎙ Imprimir Etiqueta
      </button>

      <p className={styles.hint}>
        Lê com a câmara do telemóvel para abrir directamente no browser.
      </p>
    </div>
  )
}
