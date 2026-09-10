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

/** Tipi di elemento piazzabili su un'etichetta. */
export type LabelElementType =
  | 'name'
  | 'variant'
  | 'price'
  | 'compareAtPrice'
  | 'sku'
  | 'barcode'
  | 'static'
  | 'line'

export type LabelAlign = 'left' | 'center' | 'right'
export type LabelRotation = 0 | 90 | 180 | 270

/**
 * Un elemento posizionato in millimetri assoluti sull'etichetta.
 * Le coordinate mm si mappano 1:1 su CSS (position:absolute) e su ZPL (^FO in dot),
 * quindi lo stesso elemento descrive sia la stampa HTML sia quella nativa Zebra.
 */
export interface LabelElement {
  id: string
  type: LabelElementType
  /** Default true. False = elemento nascosto ma conservato nel template. */
  visible?: boolean
  xMm: number
  yMm: number
  wMm: number
  /** Testo: altezza del riquadro. Barcode: altezza delle barre. Linea: spessore. */
  hMm?: number
  fontMm?: number
  bold?: boolean
  align?: LabelAlign
  /** Righe massime per il testo a capo (default 1). */
  maxLines?: number
  /**
   * Adatta il corpo al riquadro: se il testo non entra in `wMm` x `maxLines`,
   * `fontMm` viene ridotto fino a `minFontMm`. Sotto quella soglia il testo
   * resta tagliato come senza adattamento. Default false (opt-in dall'editor).
   */
  autoFit?: boolean
  /** Corpo minimo in mm sotto cui l'adattamento non scende (default 1.8). */
  minFontMm?: number
  rotate?: LabelRotation
  /**
   * 'static': il testo stesso. Altri tipi: formato con segnaposto {value}
   * (es. "Cod. {value}"); per 'barcode' un valore fisso che sostituisce label.barcode.
   */
  text?: string
  /** Barcode: cifre leggibili sotto le barre (default true). */
  showHri?: boolean
  /** Barcode: larghezza modulo forzata in mm; se assente si ricava da wMm. */
  moduleMm?: number
  /** Testo barrato (default true per compareAtPrice). */
  strikethrough?: boolean
}

/**
 * Template etichetta. Senza `elements` vale il layout automatico storico
 * (nome/variante/prezzo/SKU/barcode) ricalcolato sulla carta corrente.
 */
export interface LabelTemplate {
  version?: 2
  elements?: LabelElement[]
  /** Moltiplicatore globale applicato a tutti i corpi carattere. */
  fontScale?: number
  /** Legacy v1: nome del preset di partenza, puramente descrittivo. */
  preset?: string
  /** Legacy v1: interruttore globale del barcode; false nasconde ogni elemento barcode. */
  showBarcode?: boolean
}

/** Layout riusabile salvato in configurazione o importato da file. */
export interface LabelPreset {
  id: string
  name: string
  paper: PaperConfig
  template: LabelTemplate
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
  spoolDir?: string
  logDir?: string
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
