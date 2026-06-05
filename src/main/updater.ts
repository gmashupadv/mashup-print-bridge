import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'

autoUpdater.logger = log
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

interface UpdaterOptions {
  getConfigWindow: () => BrowserWindow | null
  onUpdateAvailable: (version: string) => void
}

export function initUpdater(opts: UpdaterOptions): void {
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
    opts.onUpdateAvailable(info.version)
    opts.getConfigWindow()?.webContents.send('update:available', info.version)
  })

  autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded — will install on next quit')
  })

  autoUpdater.on('error', (err) => {
    log.error('Updater error:', err)
  })

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('Update check failed:', err))
  }, 10_000)
}
