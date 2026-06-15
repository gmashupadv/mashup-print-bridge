import pkg from 'electron-updater'
const { autoUpdater } = pkg
import log from 'electron-log'
import type { BrowserWindow } from 'electron'

// macOS: l'auto-update silenzioso (Squirrel.Mac) richiede la firma con Developer ID
// Apple (a pagamento). Senza firma l'update si scaricherebbe ma fallirebbe ad applicarsi.
// Quindi su Mac CONTROLLIAMO solo la versione e notifichiamo (tray + finestra config →
// "Scarica" apre la pagina release); l'utente installa a mano. Su Windows/Linux resta
// l'auto-update pieno (download in background + installazione alla chiusura).
const isMac = process.platform === 'darwin'

autoUpdater.logger = log
autoUpdater.autoDownload = !isMac
autoUpdater.autoInstallOnAppQuit = !isMac

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
    // Mac: solo check (niente download/installazione, non firmati). Win/Linux: check + download + notifica.
    const check = isMac ? autoUpdater.checkForUpdates() : autoUpdater.checkForUpdatesAndNotify()
    check.catch((err) => log.error('Update check failed:', err))
  }, 10_000)
}
