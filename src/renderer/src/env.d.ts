/// <reference types="vite/client" />

interface Window {
  bridge: {
    getConfig(): Promise<import('../../main/config').AppConfig>
    saveConfig(partial: Record<string, unknown>): Promise<void>
    testDriver(
      printerId?: string,
      kind?: 'status' | 'label' | 'nonfiscal' | 'fiscal'
    ): Promise<import('../../main/drivers/interface').PrinterStatus>
    listDrivers(): Promise<string[]>
    listSystemPrinters(): Promise<string[]>
    getPaperInfo(deviceName: string): Promise<import('../../main/printing/paper-info').PaperInfo>
    previewLabel(
      paper?: import('../../main/drivers/interface').PaperConfig,
      template?: import('../../main/drivers/interface').LabelTemplate
    ): Promise<string>
    onLogEvent(cb: (msg: string) => void): () => void
    onUpdateAvailable(cb: (version: string) => void): () => void
    openReleasesPage(): Promise<void>
  }
}
