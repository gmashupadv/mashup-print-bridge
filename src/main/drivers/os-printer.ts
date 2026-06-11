// src/main/drivers/os-printer.ts
// Stampa su qualunque stampante installata nel sistema (Windows spooler / macOS-Linux CUPS).
// Silenziosa: nessun dialogo, geometria carta da config.
import type {
  PrinterDriver, DriverConfig, PrinterStatus, PrintResult,
  NonFiscalDoc, LabelData, LabelLayout, Capability,
} from './interface'
import { renderLabelHtml, renderNonFiscalHtml } from '../printing/label-renderer'
import type { SilentPrintOptions } from '../printing/silent-print'
import { DEFAULT_LABEL_PAPER } from '../printing/defaults'

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
      // Case-insensitive: su Windows i nomi coda non hanno capitalizzazione garantita
      const online = names.some((n) => n.toLowerCase() === device.toLowerCase())
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
      layout.paper.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!,
      // FIX 1: le dimensioni sono già finali (il @page del renderer coincide col pageSize di stampa).
      // landscape è riservato a driver vendor che richiedono media portrait + rotazione: non usare qui.
      false
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
    // FIX 2: stima altezza consapevole delle righe double; IGNORA cfg.paper.heightMm
    // (quella è la geometria delle etichette: un documento non fiscale non deve essere troncato all'altezza etichetta)
    const estimatedHeightMm = Math.max(
      30,
      10 + doc.lines.reduce((mm, l) => mm + (l.size === 'double' ? 8 : 4), 0)
    )
    const opts = this.printOpts(widthMm, estimatedHeightMm, false)
    if (!opts) return fail('os-printer: deviceName non configurato (seleziona la stampante di sistema)')
    try {
      await (await this.deps()).printHtml(renderNonFiscalHtml(doc, widthMm, estimatedHeightMm), opts)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : 'Unknown error')
    }
  }
}
