// src/main/printing/html-to-bitmap.ts
// HTML → bitmap monocromatica per il raster ESC/POS.
// La finestra offscreen renderizza a 96dpi CSS; la testina è a 203dpi,
// quindi zoomFactor = 203/96 per ottenere 8 dot/mm reali.
import { BrowserWindow } from 'electron'
import type { MonoBitmap } from './escpos-encoder'

const ZOOM = 203 / 96

export async function htmlToMonoBitmap(html: string, widthPx: number): Promise<MonoBitmap> {
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 64,
    // FIX 2: zoomFactor impostato alla creazione evita race pre-load; ridetto dopo loadURL come cintura
    webPreferences: { offscreen: true, sandbox: true, zoomFactor: ZOOM },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.setZoomFactor(ZOOM) // cintura: rinforza lo zoom post-caricamento
    const contentHeight: number = await win.webContents.executeJavaScript(
      'Math.ceil(document.body.getBoundingClientRect().height) || 64'
    )
    const heightPx = Math.max(8, Math.min(4096, Math.ceil(contentHeight * ZOOM)))
    // FIX 1: widthPx/heightPx sono già in DIP (stessa unità della creazione); non dividere per ZOOM
    win.setContentSize(widthPx, heightPx)
    // FIX 3: attende il primo frame paint invece di un timeout fisso; fallback 500ms su hardware lento
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500) // fallback se nessun frame arriva
      win.webContents.once('paint', () => {
        clearTimeout(timer)
        resolve()
      })
      win.webContents.invalidate()
    })
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    const bgra = image.getBitmap() // BGRA, size.width * size.height * 4

    const outW = Math.min(widthPx, size.width)
    const outH = size.height
    const rowBytes = Math.ceil(outW / 8)
    const data = new Uint8Array(rowBytes * outH)
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = (y * size.width + x) * 4
        // luminanza approssimata; alpha 0 (trasparente) = bianco
        const lum = bgra[i + 3] === 0 ? 255 : 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2]
        if (lum < 160) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
    return { widthPx: outW, heightPx: outH, data }
  } finally {
    win.destroy()
  }
}
