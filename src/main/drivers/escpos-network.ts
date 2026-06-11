// src/main/drivers/escpos-network.ts
// Driver ESC/POS raw TCP (porta tipica 9100) per stampantine 58/80mm.
// Etichette: HTML → bitmap (203dpi ≈ 8 dot/mm) → GS v 0.
import { createConnection } from 'node:net'
import type {
  PrinterDriver, DriverConfig, PrinterStatus, PrintResult,
  NonFiscalDoc, LabelData, LabelLayout, Capability,
} from './interface'
import { encodeNonFiscal, encodeRaster, type MonoBitmap } from '../printing/escpos-encoder'
import { renderLabelHtml } from '../printing/label-renderer'

const DOTS_PER_MM = 8 // 203 dpi

export interface EscPosDeps {
  send(host: string, port: number, timeout: number, data: Buffer): Promise<void>
  rasterize(html: string, widthPx: number): Promise<MonoBitmap>
}

async function sendTcp(host: string, port: number, timeout: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Printer timeout'))
    }, timeout)
    socket.on('connect', () => {
      socket.end(data, () => {
        clearTimeout(timer)
        resolve()
      })
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function defaultRasterize(html: string, widthPx: number): Promise<MonoBitmap> {
  // Lazy import: html-to-bitmap richiede Electron a runtime (BrowserWindow offscreen)
  const { htmlToMonoBitmap } = await import('../printing/html-to-bitmap')
  return htmlToMonoBitmap(html, widthPx)
}

const OK: PrintResult = { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }

function fail(err: unknown): PrintResult {
  return {
    success: false,
    receiptNumber: '',
    closureNumber: '',
    printerSerial: '',
    errorMessage: err instanceof Error ? err.message : 'Unknown error',
  }
}

export class EscPosNetworkDriver implements PrinterDriver {
  readonly name = 'escpos-network'
  readonly capabilities: Capability[] = ['non-fiscal', 'label', 'cut']
  private cfg: DriverConfig | null = null
  private deps: EscPosDeps

  constructor(deps?: Partial<EscPosDeps>) {
    this.deps = { send: deps?.send ?? sendTcp, rasterize: deps?.rasterize ?? defaultRasterize }
  }

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  private requireCfg(): DriverConfig {
    if (!this.cfg) throw new Error('escpos-network: not connected')
    return this.cfg
  }

  async getStatus(): Promise<PrinterStatus> {
    if (!this.cfg)
      return { online: false, paperPresent: false, coverClosed: false, errorMessage: 'Not connected' }
    return new Promise((resolve) => {
      const cfg = this.cfg!
      const socket = createConnection({ host: cfg.ip, port: cfg.port })
      const timer = setTimeout(() => {
        socket.destroy()
        resolve({ online: false, paperPresent: false, coverClosed: false, errorMessage: 'Timeout' })
      }, Math.min(cfg.timeout, 3000))
      socket.on('connect', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve({ online: true, paperPresent: true, coverClosed: true, errorMessage: '' })
      })
      socket.on('error', (err) => {
        clearTimeout(timer)
        resolve({ online: false, paperPresent: false, coverClosed: false, errorMessage: err.message })
      })
    })
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const cfg = this.requireCfg()
    try {
      await this.deps.send(cfg.ip, cfg.port, cfg.timeout, encodeNonFiscal(doc))
      return { ...OK }
    } catch (err: unknown) {
      return fail(err)
    }
  }

  async printLabel(label: LabelData, layout: LabelLayout): Promise<PrintResult> {
    const cfg = this.requireCfg()
    try {
      const widthPx = Math.round(layout.paper.widthMm * DOTS_PER_MM)
      const html = renderLabelHtml(label, layout)
      const bitmap = await this.deps.rasterize(html, widthPx)
      const payload = Buffer.concat([
        Buffer.from([0x1b, 0x40]),             // init
        Buffer.from([0x1b, 0x61, 0x01]),       // center
        encodeRaster(bitmap),
        Buffer.from([0x1b, 0x64, 0x04]),       // feed
        Buffer.from([0x1d, 0x56, 0x42, 0x00]), // partial cut
      ])
      await this.deps.send(cfg.ip, cfg.port, cfg.timeout, payload)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err)
    }
  }
}
