// src/main/drivers/interface.ts
export type Capability =
  | 'fiscal-receipt'
  | 'non-fiscal'
  | 'label'
  | 'daily-close'
  | 'drawer'
  | 'cut'

export interface PaperConfig {
  widthMm: number
  heightMm?: number
  orientation?: 'portrait' | 'landscape'
  marginsMm?: { top: number; right: number; bottom: number; left: number }
}

export interface LabelTemplate {
  preset: 'product-price'
  showBarcode: boolean
  fontScale: number
}

export interface LabelLayout {
  paper: PaperConfig
  template: LabelTemplate
}

export interface LabelData {
  name: string
  variant?: string
  price: number
  /** Prezzo pieno/di confronto, mostrato barrato accanto al prezzo di vendita. Reso solo se > price. */
  compareAtPrice?: number
  sku?: string
  barcode?: string
}

export interface NonFiscalLine {
  text: string
  bold?: boolean
  size?: 'normal' | 'double'
  align?: 'left' | 'center' | 'right'
}

export interface NonFiscalDoc {
  lines: NonFiscalLine[]
  cut?: boolean
}

export interface DriverConfig {
  ip: string
  port: number
  timeout: number
  operatorId: string
  deptMapping: Record<string, number>
  deviceName?: string
  paper?: PaperConfig
  template?: LabelTemplate
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
  readonly capabilities: Capability[]
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  // Metodi opzionali: presenti solo se la capability corrispondente è dichiarata.
  printReceipt?(data: ReceiptData): Promise<PrintResult>
  printNonFiscal?(doc: NonFiscalDoc): Promise<PrintResult>
  printLabel?(label: LabelData, layout: LabelLayout): Promise<PrintResult>
  dailyClose?(operatorId: string): Promise<PrintResult>
  openDrawer?(operatorId: string): Promise<void>
}
