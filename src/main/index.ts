import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } from 'electron'
import * as path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import log from 'electron-log'
import { createConfigManager } from './config'
import type { PrinterConfig } from './config'
import { createDriver, listDrivers } from './drivers/registry'
import { startServer } from './server'
import type { ManagedPrinter } from './server'
import { initUpdater } from './updater'
import type { FastifyInstance } from 'fastify'
import type { PrinterDriver, PaperConfig, LabelTemplate, NonFiscalDoc } from './drivers/interface'
import { listSystemPrinters } from './printing/silent-print'
import { getPaperInfo } from './printing/paper-info'
import { renderLabelHtml } from './printing/label-renderer'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE, SAMPLE_LABEL } from './printing/defaults'
// ?asset: electron-vite copia il file in out/ e risolve il percorso anche dentro app.asar.
// Un path costruito a mano verso resources/ funziona in dev ma non esiste nell'app impacchettata.
import trayIconAsset from '../../resources/icon.png?asset'
// Icona "template" monocromatica per la menu bar di macOS: forma nera su sfondo
// trasparente, ricolorata dal sistema (nera col tema chiaro, bianca col tema scuro).
import trayTemplateAsset from '../../resources/trayTemplate.png?asset'
import trayTemplate2xAsset from '../../resources/trayTemplate@2x.png?asset'

const configPath = path.join(app.getPath('userData'), 'config.json')
// Valutato prima che un salvataggio crei il file: vero solo alla primissima apertura
const firstRun = !existsSync(configPath)
const config = createConfigManager(configPath)
const drivers = new Map<string, PrinterDriver>()
let tray: Tray | null = null
let configWindow: BrowserWindow | null = null
let server: FastifyInstance | null = null
let updateVersion: string | null = null

const RELEASES_URL = 'https://github.com/gmashupadv/mashup-print-bridge/releases/latest'

function driverConfigFrom(pc: PrinterConfig) {
  return {
    ip: pc.connection.ip,
    port: pc.connection.port,
    timeout: pc.connection.timeout,
    operatorId: pc.operatorId,
    deptMapping: pc.deptMapping,
    deviceName: pc.connection.deviceName,
    spoolDir: pc.connection.spoolDir,
    logDir: pc.connection.logDir,
    paper: pc.paper,
    template: pc.template,
  }
}

function buildManagedPrinters(): ManagedPrinter[] {
  return config.get().printers.map((pc) => ({
    config: pc,
    driver: drivers.get(pc.id) ?? createDriver(pc.driver),
  }))
}

// ------- Tray -------

function createTray(): void {
  let icon: Electron.NativeImage
  if (process.platform === 'darwin') {
    // Template image: 16pt + variante @2x per i display Retina. setTemplateImage
    // dice a macOS di ignorare il colore e usare solo la sagoma (canale alpha).
    icon = nativeImage.createFromPath(trayTemplateAsset)
    try {
      icon.addRepresentation({
        scaleFactor: 2,
        dataURL: `data:image/png;base64,${readFileSync(trayTemplate2xAsset).toString('base64')}`
      })
    } catch (err) {
      log.warn(`Tray @2x representation unavailable: ${String(err)}`)
    }
    icon.setTemplateImage(true)
  } else {
    icon = nativeImage.createFromPath(trayIconAsset)
    if (!icon.isEmpty()) {
      icon = icon.resize({ width: 16, height: 16 })
    }
  }
  tray = new Tray(icon)
  if (icon.isEmpty()) {
    // Mai invisibili: senza icona la tray su macOS ha larghezza zero e l'app sembra non avviata
    log.error(`Tray icon missing or unreadable: ${trayIconAsset}`)
    if (process.platform === 'darwin') tray.setTitle('Bridge')
  }
  tray.setToolTip('Mashup Print Bridge')
  refreshTrayMenu(false)
}

function refreshTrayMenu(online: boolean): void {
  const cfg = config.get()
  const ipList = cfg.printers.map((p) => p.connection.ip).join(', ')
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `Bridge attivo (v${app.getVersion()})`, enabled: false },
    { label: `Stampante: ${ipList} ${online ? '✓' : '✗'}`, enabled: false },
    { type: 'separator' },
    { label: 'Apri configurazione...', click: openConfigWindow },
    { label: 'Test di stampa', click: testStatus },
    { type: 'separator' },
  ]
  if (updateVersion) {
    items.push({
      label: `Aggiornamento disponibile (${updateVersion})`,
      click: () => shell.openExternal(RELEASES_URL),
    })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Esci', click: () => app.quit() })
  tray!.setContextMenu(Menu.buildFromTemplate(items))
}

function openConfigWindow(): void {
  if (configWindow) {
    configWindow.focus()
    return
  }
  configWindow = new BrowserWindow({
    width: 400,
    height: 520,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Mashup Print Bridge — Configurazione',
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    configWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    configWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  configWindow.on('closed', () => {
    configWindow = null
  })
}

async function testStatus(): Promise<void> {
  for (const [id, driver] of drivers) {
    try {
      const status = await driver.getStatus()
      emitLog(`Test [${id}]: ${status.online ? 'online' : 'offline'} — ${status.errorMessage || 'OK'}`)
    } catch (err: unknown) {
      emitLog(`Test [${id}] error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }
}

// ------- Status polling -------

function startStatusPolling(): void {
  const poll = async (): Promise<void> => {
    try {
      const statuses = await Promise.allSettled(
        [...drivers.values()].map((d) => d.getStatus())
      )
      const anyOnline = statuses.some(
        (s) => s.status === 'fulfilled' && s.value.online
      )
      refreshTrayMenu(anyOnline)
    } catch {
      refreshTrayMenu(false)
    }
  }
  poll()
  setInterval(poll, 30_000)
}

// ------- Logging -------

function emitLog(msg: string): void {
  log.info(msg)
  const line = `${new Date().toLocaleTimeString('it-IT')} — ${msg}`
  configWindow?.webContents.send('log:event', line)
}

// ------- IPC handlers -------

ipcMain.handle('config:get', () => config.get())

ipcMain.handle('config:save', async (_e, partial: Partial<ReturnType<typeof config.get>>) => {
  await config.save(partial)
  const newPrinters = config.get().printers
  const newIds = new Set(newPrinters.map((p) => p.id))

  // Remove drivers whose printer was removed
  for (const id of drivers.keys()) {
    if (!newIds.has(id)) {
      drivers.delete(id)
    }
  }

  // Connect/reconnect drivers
  for (const pc of newPrinters) {
    const existing = drivers.get(pc.id)
    if (existing && existing.name !== pc.driver) {
      // Driver type changed — discard old instance so we recreate with correct capabilities
      drivers.delete(pc.id)
    }
    if (drivers.has(pc.id)) {
      try {
        await drivers.get(pc.id)!.connect(driverConfigFrom(pc))
      } catch (err: unknown) {
        log.error(`Driver reconnect [${pc.id}]:`, err)
      }
    } else {
      const d = createDriver(pc.driver)
      try {
        await d.connect(driverConfigFrom(pc))
      } catch (err: unknown) {
        log.error(`Driver connect [${pc.id}]:`, err)
      }
      drivers.set(pc.id, d)
    }
  }

  emitLog(`Config salvata — stampanti: ${newPrinters.map((p) => p.driver).join(', ')}`)
})

ipcMain.handle(
  'driver:test',
  async (_e, printerId?: string, kind: 'status' | 'label' | 'nonfiscal' | 'fiscal' = 'status') => {
    const driver = printerId ? drivers.get(printerId) : [...drivers.values()][0]
    if (!driver) throw new Error(printerId ? `Driver not found: ${printerId}` : 'No drivers configured')

    if (kind === 'fiscal') {
      if (!driver.printReceipt) throw new Error('La stampante non emette scontrini fiscali')
      const printers = config.get().printers
      const pc = printerId ? printers.find((p) => p.id === printerId) : printers[0]
      // Reparto reale dalla deptMapping (sono i reparti programmati sulla stampante); fallback 1
      const department = pc ? (Object.values(pc.deptMapping)[0] ?? 1) : 1
      const result = await driver.printReceipt({
        items: [{ description: 'PROVA SCONTRINO', quantity: 1, unitPrice: 0.01, department, vatRate: 22 }],
        discount: 0,
        payments: [{ description: 'Contanti', amount: 0.01, paymentType: 0 }],
      })
      if (!result.success) throw new Error(result.errorMessage || 'Stampa fallita')
      emitLog(`Scontrino di prova (0,01 €) inviato [${printerId ?? 'default'}]`)
      return driver.getStatus()
    }

    if (kind === 'label') {
      const printers = config.get().printers
      const pc = printerId ? printers.find((p) => p.id === printerId) : printers[0]
      if (!pc) throw new Error(printerId ? `Printer not found: ${printerId}` : 'No printers configured')
      const labelDriver = drivers.get(pc.id)
      if (!labelDriver?.printLabel) throw new Error('La stampante non supporta le etichette')
      const result = await labelDriver.printLabel(SAMPLE_LABEL, {
        paper: { ...DEFAULT_LABEL_PAPER, ...pc.paper },
        template: { ...DEFAULT_LABEL_TEMPLATE, ...pc.template },
      })
      if (!result.success) throw new Error(result.errorMessage || 'Stampa fallita')
      emitLog(`Etichetta di prova inviata [${pc.id}]`)
      return labelDriver.getStatus()
    }

    if (kind === 'nonfiscal') {
      if (!driver.printNonFiscal) throw new Error('La stampante non supporta la stampa non fiscale')
      const doc: NonFiscalDoc = {
        lines: [
          { text: 'MASHUP PRINT BRIDGE', bold: true, align: 'center' },
          { text: 'Stampa di prova', align: 'center' },
        ],
        cut: true,
      }
      const result = await driver.printNonFiscal(doc)
      if (!result.success) throw new Error(result.errorMessage || 'Stampa fallita')
      emitLog(`Documento di prova inviato [${printerId ?? 'default'}]`)
      return driver.getStatus()
    }

    return driver.getStatus()
  }
)

ipcMain.handle('driver:list', () => listDrivers())

ipcMain.handle('printers:system', () => listSystemPrinters())

// Apre la pagina release per il download manuale (usato dal banner aggiornamento, utile su Mac)
ipcMain.handle('update:open-releases', () => shell.openExternal(RELEASES_URL))

ipcMain.handle('printers:paper-info', (_e, deviceName: string) => getPaperInfo(deviceName))

// Anteprima etichetta con lo stato (anche non salvato) della UI
ipcMain.handle('label:preview', (_e, paper?: PaperConfig, template?: LabelTemplate) =>
  renderLabelHtml(SAMPLE_LABEL, {
    paper: { ...DEFAULT_LABEL_PAPER, ...paper },
    template: { ...DEFAULT_LABEL_TEMPLATE, ...template },
  })
)

// Selettore di cartella per il driver axon-fpid (cartella di ascolto e LOG)
ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

// Sonda di configurazione: canale separato da driver:test, che restituisce
// sempre un PrinterStatus mentre qui la struttura di ritorno è diversa.
ipcMain.handle('driver:probe', async (_e, printerId: string) => {
  const driver = drivers.get(printerId)
  if (!driver) throw new Error(`Stampante non trovata: ${printerId}`)
  const probe = (
    driver as {
      probeConfig?: (onProgress?: (done: number, total: number) => void) => Promise<unknown>
    }
  ).probeConfig
  if (typeof probe !== 'function') {
    throw new Error('Questo driver non supporta la sonda di configurazione')
  }
  // La lettura dei reparti è un job per reparto: senza avanzamento la finestra
  // resta muta per decine di secondi e sembra bloccata.
  emitLog(`Sonda di configurazione avviata [${printerId}]`)
  const result = await probe.call(driver, (done, total) => {
    if (done === total || done % 10 === 0) emitLog(`Sonda: letti ${done}/${total} reparti`)
  })
  emitLog(`Sonda di configurazione completata [${printerId}]`)
  return result
})

// ------- App lifecycle -------

// Una sola istanza: rilanciare l'app (doppio click sull'icona installata) non deve
// avviare un secondo processo invisibile che fallisce il bind della porta 8765.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => openConfigWindow())

// macOS: click sull'icona nel Dock quando non ci sono finestre
app.on('activate', () => openConfigWindow())

app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: config.get().autostart })

  for (const pc of config.get().printers) {
    const d = createDriver(pc.driver)
    try {
      await d.connect(driverConfigFrom(pc))
    } catch (err: unknown) {
      log.error(`Initial driver connect [${pc.id}] failed:`, err)
    }
    drivers.set(pc.id, d)
  }

  server = await startServer({
    getPrinters: buildManagedPrinters,
    version: app.getVersion(),
    port: config.get().port,
  })
  log.info(`Server listening on 127.0.0.1:${config.get().port}`)

  createTray()
  startStatusPolling()

  // Primo avvio dopo l'installazione: mostra subito la configurazione,
  // altrimenti l'app parte solo nella tray e sembra non essersi aperta
  if (firstRun) openConfigWindow()

  initUpdater({
    getConfigWindow: () => configWindow,
    onUpdateAvailable: (version) => {
      updateVersion = version
      refreshTrayMenu(false)
    },
  })
})

app.on('window-all-closed', (e: Event) => {
  e.preventDefault() // Stay alive as tray app — never quit on window close
})

app.on('before-quit', async () => {
  await Promise.all([...drivers.values()].map((d) => d.disconnect()))
  await server?.close()
})
