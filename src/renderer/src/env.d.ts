/// <reference types="vite/client" />

interface Window {
  bridge: {
    getConfig(): Promise<import('../../main/config').AppConfig>
    saveConfig(partial: Record<string, unknown>): Promise<void>
    testDriver(printerId?: string): Promise<import('../../main/drivers/interface').PrinterStatus>
    listDrivers(): Promise<string[]>
    onLogEvent(cb: (msg: string) => void): () => void
    onUpdateAvailable(cb: (version: string) => void): () => void
  }
}
