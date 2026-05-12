import { forwardRef, useImperativeHandle, useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import labLogo from '../../assets/industrial-testing-lab-logo.png'
import styles from './QRCodeDisplay.module.css'

const QRCodeDisplay = forwardRef(function QRCodeDisplay({ equipamento, value }, ref) {
  const canvasRef = useRef(null)

  const url = value || `${window.location.origin}/equipamentos/${equipamento.id}`

  const handlePrint = () => {
    const canvas = canvasRef.current?.querySelector('canvas')
    const qrDataUrl = canvas ? canvas.toDataURL('image/png') : ''

    const janela = window.open('', '_blank', 'width=420,height=600')
    janela.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiqueta — ${equipamento.codigo}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    @page{size:80mm 110mm;margin:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#fff;
         display:flex;justify-content:center;align-items:flex-start;padding:5mm}
    .etiqueta{border:2px solid #111;padding:14px 18px 16px;
               text-align:center;width:68mm;background:#fff}
    .header{display:flex;align-items:center;justify-content:center;gap:10px;
            padding-bottom:10px;border-bottom:1px solid #ccc;margin-bottom:12px}
    .logoImg{height:22px;width:auto}
    .tc{font-size:8px;font-weight:800;letter-spacing:.22em;
        text-transform:uppercase;color:#111;line-height:1.2}
    img.qr{width:190px;height:190px;display:block;margin:0 auto 12px;
           image-rendering:pixelated;image-rendering:crisp-edges}
    hr{border:none;border-top:1px solid #ddd;margin:10px 0}
    .codigo{font-size:22px;font-weight:900;letter-spacing:.08em;
            color:#111;margin-bottom:4px;font-family:Arial,sans-serif}
    .nome{font-size:10px;color:#222;font-weight:700;margin-bottom:3px;line-height:1.3}
    .tipo{font-size:9px;color:#666;font-weight:500;margin-bottom:8px}
    .url{font-size:6.5px;color:#bbb;word-break:break-all;
          font-family:'Courier New',monospace;margin-top:4px}
    @media print{body{padding:0}}
  </style>
</head>
<body>
  <div class="etiqueta">
    <div class="header">
      <img class="logoImg" src="${labLogo}" alt="Industrial Testing Lab">
      <div class="tc">Testing<br>Centre</div>
    </div>
    <img class="qr" src="${qrDataUrl}" alt="QR Code">
    <hr>
    <div class="codigo">${equipamento.codigo}</div>
    <div class="nome">${equipamento.nome}</div>
    <div class="tipo">${equipamento.tipo}</div>
    <div class="url">${url}</div>
  </div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800)}<\/script>
</body>
</html>`)
    janela.document.close()
  }

  useImperativeHandle(ref, () => ({ print: handlePrint }))

  return (
    <div className={styles.wrap}>
      <div className="label" style={{ marginBottom: 12 }}>QR Code do Equipamento</div>

      <div className={styles.preview}>
        <div ref={canvasRef}>
          <QRCodeCanvas
            value={url}
            size={160}
            level="M"
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
})

export default QRCodeDisplay
