// src/main/printing/silent-print.ts
// Stampa silenziosa via driver di sistema (CUPS su macOS/Linux, spooler su Windows).
import { BrowserWindow } from 'electron'

export interface SilentPrintOptions {
  deviceName: string
  /** Dimensioni FINALI della pagina, già nella forma in cui il contenuto è impaginato
   *  (@page del renderer). Il chiamante fornisce le dimensioni così come devono comparire
   *  nel pageSize di webContents.print — nessuna rotazione viene applicata qui. */
  widthMm: number
  /** Vedi widthMm: altezza FINALE della pagina già nella forma impaginata. */
  heightMm: number
  /** Riservato: NON usare insieme a dimensioni già ruotate; default false.
   *  Da attivare solo se un driver vendor sul campo richiede media portrait + rotazione
   *  software (caso eccezionale, non standard). */
  landscape?: boolean
}

let workerWin: BrowserWindow | null = null

function getWorker(): BrowserWindow {
  if (!workerWin || workerWin.isDestroyed()) {
    workerWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  }
  return workerWin
}

export async function listSystemPrinters(): Promise<string[]> {
  const printers = await getWorker().webContents.getPrintersAsync()
  return printers.map((p) => p.name)
}

function toDataUrl(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

// FIX 4: timeout per evitare Promise pendente se il driver di stampa non risponde mai
const PRINT_TIMEOUT_MS = 30_000

export async function printHtml(html: string, opts: SilentPrintOptions): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(toDataUrl(html))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Print timeout: il driver di stampa non risponde')),
        PRINT_TIMEOUT_MS
      )
      win.webContents.print(
        {
          silent: true,
          deviceName: opts.deviceName,
          printBackground: true,
          landscape: opts.landscape ?? false,
          margins: { marginType: 'none' }, // i margini sono nel CSS dell'HTML
          // pageSize in micron
          pageSize: { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) },
        },
        (ok, failureReason) => {
          clearTimeout(timer)
          ok ? resolve() : reject(new Error(failureReason || 'Stampa fallita'))
        }
      )
    })
  } finally {
    win.destroy()
  }
}
