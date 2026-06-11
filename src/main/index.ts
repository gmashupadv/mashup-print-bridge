import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import * as path from 'node:path'
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

const configPath = path.join(app.getPath('userData'), 'config.json')
const config = createConfigManager(configPath)
const drivers = new Map<string, PrinterDriver>()
let tray: Tray | null = null
let configWindow: BrowserWindow | null = null
let server: FastifyInstance | null = null
let updateVersion: string | null = null

function driverConfigFrom(pc: PrinterConfig) {
  return {
    ip: pc.connection.ip,
    port: pc.connection.port,
    timeout: pc.connection.timeout,
    operatorId: pc.operatorId,
    deptMapping: pc.deptMapping,
    deviceName: pc.connection.deviceName,
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
  const iconPath = path.join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
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
      click: () =>
        shell.openExternal('https://github.com/gmashupadv/mashup-print-bridge/releases/latest'),
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
  async (_e, printerId?: string, kind: 'status' | 'label' | 'nonfiscal' = 'status') => {
    const driver = printerId ? drivers.get(printerId) : [...drivers.values()][0]
    if (!driver) throw new Error(printerId ? `Driver not found: ${printerId}` : 'No drivers configured')

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

ipcMain.handle('printers:paper-info', (_e, deviceName: string) => getPaperInfo(deviceName))

// Anteprima etichetta con lo stato (anche non salvato) della UI
ipcMain.handle('label:preview', (_e, paper?: PaperConfig, template?: LabelTemplate) =>
  renderLabelHtml(SAMPLE_LABEL, {
    paper: { ...DEFAULT_LABEL_PAPER, ...paper },
    template: { ...DEFAULT_LABEL_TEMPLATE, ...template },
  })
)

// ------- App lifecycle -------

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
