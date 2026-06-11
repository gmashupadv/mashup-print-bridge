import type { Capability, PrinterDriver, DriverConfig, PrinterStatus, ReceiptData, PrintResult } from './interface'

const MSG = 'ESC/POS network driver: raw label printing not yet implemented'

export class EscPosNetworkDriver implements PrinterDriver {
  readonly name = 'escpos-network'
  readonly capabilities: Capability[] = []
  private cfg: DriverConfig | null = null

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  async getStatus(): Promise<PrinterStatus> {
    if (!this.cfg)
      return { online: false, paperPresent: false, coverClosed: false, errorMessage: 'Not connected' }
    return new Promise((resolve) => {
      import('node:net').then(({ createConnection }) => {
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
    })
  }

  async printReceipt(_data: ReceiptData): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async dailyClose(_operatorId: string): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async openDrawer(_operatorId: string): Promise<void> {
    throw new Error(MSG)
  }
}
