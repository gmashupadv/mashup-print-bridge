// src/main/drivers/os-printer.ts
// Stampa su qualunque stampante installata nel sistema (Windows spooler / macOS-Linux CUPS).
// Silenziosa: nessun dialogo, geometria carta da config.
import type {
  PrinterDriver, DriverConfig, PrinterStatus, PrintResult,
  NonFiscalDoc, LabelData, LabelLayout, Capability,
} from './interface'
import { renderLabelHtml, renderNonFiscalHtml } from '../printing/label-renderer'
import type { SilentPrintOptions } from '../printing/silent-print'

export interface OsPrinterDeps {
  listPrinters(): Promise<string[]>
  printHtml(html: string, opts: SilentPrintOptions): Promise<void>
}

async function defaultDeps(): Promise<OsPrinterDeps> {
  // Lazy import: silent-print richiede Electron a runtime
  const mod = await import('../printing/silent-print')
  return { listPrinters: mod.listSystemPrinters, printHtml: mod.printHtml }
}

const OK: PrintResult = { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }

function fail(msg: string): PrintResult {
  return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: msg }
}

export class OsPrinterDriver implements PrinterDriver {
  readonly name = 'os-printer'
  readonly capabilities: Capability[] = ['label', 'non-fiscal']
  private cfg: DriverConfig | null = null
  private depsOverride: OsPrinterDeps | null = null

  constructor(deps?: OsPrinterDeps) {
    this.depsOverride = deps ?? null
  }

  private async deps(): Promise<OsPrinterDeps> {
    return this.depsOverride ?? (await defaultDeps())
  }

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  async getStatus(): Promise<PrinterStatus> {
    const device = this.cfg?.deviceName
    if (!device)
      return { online: false, paperPresent: false, coverClosed: false, errorMessage: 'Nessuna stampante di sistema selezionata' }
    try {
      const names = await (await this.deps()).listPrinters()
      const online = names.includes(device)
      return {
        online,
        paperPresent: online,
        coverClosed: online,
        errorMessage: online ? '' : `Stampante di sistema non trovata: ${device}`,
      }
    } catch (err: unknown) {
      return { online: false, paperPresent: false, coverClosed: false,
        errorMessage: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  private printOpts(widthMm: number, heightMm: number, landscape: boolean): SilentPrintOptions | null {
    const device = this.cfg?.deviceName
    if (!device) return null
    return { deviceName: device, widthMm, heightMm, landscape }
  }

  async printLabel(label: LabelData, layout: LabelLayout): Promise<PrintResult> {
    const opts = this.printOpts(
      layout.paper.widthMm,
      layout.paper.heightMm ?? 30,
      layout.paper.orientation === 'landscape'
    )
    if (!opts) return fail('os-printer: deviceName non configurato (seleziona la stampante di sistema)')
    try {
      await (await this.deps()).printHtml(renderLabelHtml(label, layout), opts)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const widthMm = this.cfg?.paper?.widthMm ?? 80
    // altezza stimata: 5mm a riga (+10mm di respiro); i driver roll-paper troncano il vuoto
    const heightMm = this.cfg?.paper?.heightMm ?? Math.max(30, doc.lines.length * 5 + 10)
    const opts = this.printOpts(widthMm, heightMm, false)
    if (!opts) return fail('os-printer: deviceName non configurato (seleziona la stampante di sistema)')
    try {
      await (await this.deps()).printHtml(renderNonFiscalHtml(doc, widthMm), opts)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : 'Unknown error')
    }
  }
}
