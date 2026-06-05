import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import * as path from 'node:path'
import log from 'electron-log'
import { createConfigManager } from './config'
import { createDriver, listDrivers } from './drivers/registry'
import { startServer } from './server'
import { initUpdater } from './updater'
import type { FastifyInstance } from 'fastify'
import type { PrinterDriver } from './drivers/interface'

const configPath = path.join(app.getPath('userData'), 'config.json')
const config = createConfigManager(configPath)
let driver: PrinterDriver = createDriver(config.get().driver)
let tray: Tray | null = null
let configWindow: BrowserWindow | null = null
let server: FastifyInstance | null = null
let updateVersion: string | null = null

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
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `Bridge attivo (v${app.getVersion()})`, enabled: false },
    { label: `Stampante: ${cfg.connection.ip} ${online ? '✓' : '✗'}`, enabled: false },
    { type: 'separator' },
    { label: 'Apri configurazione...', click: openConfigWindow },
    { label: 'Test di stampa', click: testStatus },
    { type: 'separator' },
  ]
  if (updateVersion) {
    items.push({
      label: `Aggiornamento disponibile (${updateVersion})`,
      click: () => shell.openExternal('https://github.com/gmashupadv/mashup-print-bridge/releases/latest'),
    })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Esci', click: () => app.quit() })
  tray!.setContextMenu(Menu.buildFromTemplate(items))
}

function openConfigWindow(): void {
  if (configWindow) { configWindow.focus(); return }
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
  configWindow.on('closed', () => { configWindow = null })
}

async function testStatus(): Promise<void> {
  try {
    const status = await driver.getStatus()
    emitLog(`Test: ${status.online ? 'online' : 'offline'} — ${status.errorMessage || 'OK'}`)
  } catch (err: unknown) {
    emitLog(`Test error: ${err instanceof Error ? err.message : 'Unknown'}`)
  }
}

// ------- Status polling -------

function startStatusPolling(): void {
  const poll = async (): Promise<void> => {
    try {
      const status = await driver.getStatus()
      refreshTrayMenu(status.online)
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

function driverConfig() {
  const cfg = config.get()
  return {
    ip: cfg.connection.ip,
    port: cfg.connection.port,
    timeout: cfg.connection.timeout,
    operatorId: cfg.operatorId,
    deptMapping: cfg.deptMapping,
  }
}

// ------- IPC handlers -------

ipcMain.handle('config:get', () => config.get())

ipcMain.handle('config:save', async (_e, partial: Partial<ReturnType<typeof config.get>>) => {
  await config.save(partial)
  driver = createDriver(config.get().driver)
  try {
    await driver.connect(driverConfig())
  } catch (err: unknown) {
    log.error('Driver connect after config save:', err)
  }
  emitLog(`Config salvata — driver: ${driver.name}`)
})

ipcMain.handle('driver:test', () => driver.getStatus())

ipcMain.handle('driver:list', () => listDrivers())

// ------- App lifecycle -------

app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: config.get().autostart })

  try {
    await driver.connect(driverConfig())
  } catch (err: unknown) {
    log.error('Initial driver connect failed:', err)
  }

  server = await startServer({
    getDriver: () => driver,
    version: app.getVersion(),
    getDeptMapping: () => config.get().deptMapping,
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
  await server?.close()
  await driver.disconnect()
})
