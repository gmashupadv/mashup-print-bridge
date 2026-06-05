import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:save', partial),
  testDriver: (printerId?: string) => ipcRenderer.invoke('driver:test', printerId),
  listDrivers: () => ipcRenderer.invoke('driver:list'),
  onLogEvent: (cb: (msg: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg)
    ipcRenderer.on('log:event', handler)
    return () => ipcRenderer.removeListener('log:event', handler)
  },
  onUpdateAvailable: (cb: (version: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, version: string) => cb(version)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
})
