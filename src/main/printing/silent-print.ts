// src/main/printing/silent-print.ts
// Stampa silenziosa via driver di sistema (CUPS su macOS/Linux, spooler su Windows).
import { BrowserWindow } from 'electron'

export interface SilentPrintOptions {
  deviceName: string
  widthMm: number
  heightMm: number
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

export async function printHtml(html: string, opts: SilentPrintOptions): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(toDataUrl(html))
    await new Promise<void>((resolve, reject) => {
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
        (ok, failureReason) => (ok ? resolve() : reject(new Error(failureReason || 'Stampa fallita')))
      )
    })
  } finally {
    win.destroy()
  }
}
