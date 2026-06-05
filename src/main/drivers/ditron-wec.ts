// src/main/drivers/ditron-wec.ts
import type { DriverConfig, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

const MSG = 'Ditron WEC driver: not implemented — pending Wireshark capture'

export class DitronWecDriver implements PrinterDriver {
  readonly name = 'ditron-wec'

  async connect(_config: DriverConfig): Promise<void> {
    // Intentionally does not throw — connect is called at startup for the active driver.
    // Operations will fail when actually used.
  }

  async disconnect(): Promise<void> {}

  async getStatus(): Promise<PrinterStatus> {
    return { online: false, paperPresent: false, coverClosed: false, errorMessage: MSG }
  }

  async printReceipt(_data: ReceiptData): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async dailyClose(_operatorId: string): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async openDrawer(_operatorId: string): Promise<void> {
    throw new Error(MSG)
  }
}
