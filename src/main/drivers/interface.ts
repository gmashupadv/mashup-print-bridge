// src/main/drivers/interface.ts
export interface DriverConfig {
  ip: string
  port: number
  timeout: number
  operatorId: string
  deptMapping: Record<string, number>
}

export interface ReceiptItem {
  description: string
  quantity: number
  unitPrice: number
  department: number
  vatRate: number
}

export interface ReceiptPayment {
  description: string
  amount: number
  paymentType: number
}

export interface ReceiptData {
  items: ReceiptItem[]
  discount: number
  payments: ReceiptPayment[]
}

export interface PrintResult {
  success: boolean
  receiptNumber: string
  closureNumber: string
  printerSerial: string
  errorMessage: string
}

export interface PrinterStatus {
  online: boolean
  paperPresent: boolean
  coverClosed: boolean
  errorMessage: string
}

export interface PrinterDriver {
  readonly name: string
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  printReceipt(data: ReceiptData): Promise<PrintResult>
  dailyClose(operatorId: string): Promise<PrintResult>
  openDrawer(operatorId: string): Promise<void>
}
