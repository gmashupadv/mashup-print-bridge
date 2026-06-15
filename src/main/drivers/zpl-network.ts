// src/main/drivers/zpl-network.ts
// Driver ZPL raw TCP (porta tipica 9100) per etichettatrici che emulano Zebra:
// Printex G300, Godex, TSC, Zebra. Genera ZPL nativo (testo + barcode ^BE/^BC),
// niente raster: stampa nitida e nessun rendering offscreen.
import { createConnection } from 'node:net'
import type {
  PrinterDriver, DriverConfig, PrinterStatus, PrintResult,
  LabelData, LabelLayout, Capability,
} from './interface'
import { buildLabelZpl } from '../printing/zpl'
import { sendTcp } from './escpos-network'

export interface ZplDeps {
  send(host: string, port: number, timeout: number, data: Buffer): Promise<void>
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

export class ZplNetworkDriver implements PrinterDriver {
  readonly name = 'zpl-network'
  readonly capabilities: Capability[] = ['label']
  private cfg: DriverConfig | null = null
  private deps: ZplDeps

  constructor(deps?: Partial<ZplDeps>) {
    this.deps = { send: deps?.send ?? sendTcp }
  }

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  private requireCfg(): DriverConfig {
    if (!this.cfg) throw new Error('zpl-network: not connected')
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

  async printLabel(label: LabelData, layout: LabelLayout): Promise<PrintResult> {
    const cfg = this.requireCfg()
    try {
      const zpl = buildLabelZpl(label, layout)
      await this.deps.send(cfg.ip, cfg.port, cfg.timeout, Buffer.from(zpl, 'utf-8'))
      return { ...OK }
    } catch (err: unknown) {
      return fail(err)
    }
  }
}
