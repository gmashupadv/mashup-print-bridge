// Ditron keycode driver — emula la tastiera fisica via HTTPS POST /cmd/keycode
// È il protocollo usato dal FCR Manager (l'interfaccia web della stampante stessa),
// quindi funziona anche quando i comandi WEC testuali (/cmd/wec) vengono ignorati
// dal firmware (verificato on-site: /cmd/wec risponde 200 ma non esegue nulla).
//
// Mappa tasti rilevata via GET /cmd/keycode?keycode=N (lettura senza pressione)
// sulla stampante 192.168.1.22 — blocco principale keycode 1–59.
// Lo stato si legge da GET /cmd/display (JSON con le righe del display LCD).
import tls from 'node:tls'
import type { Capability, DriverConfig, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

const TLS_OPTS: tls.ConnectionOptions = { rejectUnauthorized: false }

export const KEY = {
  digits: [53, 41, 42, 43, 29, 30, 31, 17, 18, 19], // kNumber0..kNumber9
  clear: 7, // kClear (CL)
  multiplier: 6, // kMultiplier (×, quantità)
  subtotal: 58, // kSubtotalReferenceDrawer
  total: 59, // kTotal (chiusura contanti)
  creditCard: 22, // kCreditCard (POS/carta)
  absoluteDecrease: 37, // kAbsoluteDecrease (sconto a valore)
  drawer: 11, // kDrawer (apertura cassetto)
  key: 12, // kKey (CHIAVE, cambio modo: 1=REG, 3=AZZERAMENTI)
  // kDepartment01..kDepartment20
  departments: [56, 44, 32, 20, 8, 57, 45, 33, 21, 9, 51, 39, 27, 15, 3, 52, 40, 28, 16, 4],
} as const

// ReceiptPayment.paymentType → tasto tender: 0 = contanti, 1 = carta, 2+ = altro
const TENDER_KEY: Record<number, number> = { 0: KEY.total, 1: KEY.creditCard, 2: KEY.total }

function departmentKey(department: number): number {
  const key = KEY.departments[department - 1]
  if (key === undefined) {
    throw new Error(`Reparto ${department} fuori range (1-20)`)
  }
  return key
}

// Importo in centesimi → sequenza di tasti cifra (es. 1.50 € → "150" → [41, 30, 53])
function amountKeys(amount: number): number[] {
  const cents = Math.round(amount * 100)
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error(`Importo non valido: ${amount}`)
  }
  return String(cents)
    .split('')
    .map((d) => KEY.digits[Number(d)])
}

// Sequenza completa di tasti per uno scontrino: per ogni articolo
// [qta ×] prezzo + reparto, poi eventuale sconto a valore sul subtotale,
// poi un tender per ogni pagamento (l'ultimo chiude lo scontrino).
export function receiptKeySequence(data: ReceiptData): number[] {
  const keys: number[] = [KEY.clear]
  for (const item of data.items) {
    if (item.quantity !== 1) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error(`Quantità non valida: ${item.quantity}`)
      }
      keys.push(...String(item.quantity).split('').map((d) => KEY.digits[Number(d)]))
      keys.push(KEY.multiplier)
    }
    keys.push(...amountKeys(item.unitPrice))
    keys.push(departmentKey(item.department))
  }
  if (data.discount > 0) {
    keys.push(KEY.subtotal)
    keys.push(...amountKeys(data.discount))
    keys.push(KEY.absoluteDecrease)
  }
  for (const p of data.payments) {
    keys.push(...amountKeys(p.amount))
    keys.push(TENDER_KEY[p.paymentType] ?? KEY.total)
  }
  return keys
}

interface DisplayLine {
  text?: string
}

interface DisplayResponse {
  Response_Data?: {
    kHeader?: DisplayLine
    kBody?: DisplayLine
    kTrailer?: DisplayLine
  }
}

function displayText(json: DisplayResponse): string {
  const d = json.Response_Data
  return [d?.kHeader?.text, d?.kBody?.text, d?.kTrailer?.text]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export class DitronKeycodeDriver implements PrinterDriver {
  readonly name = 'ditron-keycode'
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']
  private host = ''
  private port = 443
  private timeout = 15000

  async connect(config: DriverConfig): Promise<void> {
    this.host = config.ip
    this.port = config.port
    this.timeout = config.timeout
  }

  async disconnect(): Promise<void> {}

  // Stessa trasportistica raw-TLS del driver StreamWEC: uHTTP a volte risponde
  // senza header HTTP, quindi leggiamo i byte grezzi e scartiamo il preambolo se c'è.
  private request(method: 'GET' | 'POST', path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const bodyBuf = body != null ? Buffer.from(body, 'utf-8') : null
      const headerLines = [
        `${method} ${path} HTTP/1.0`,
        `Host: ${this.host}`,
        'Accept: */*',
        'Connection: close',
      ]
      if (bodyBuf != null) {
        headerLines.push('Content-Type: application/x-www-form-urlencoded; charset=utf-8')
        headerLines.push(`Content-Length: ${bodyBuf.length}`)
      }
      const httpHeader = headerLines.join('\r\n') + '\r\n\r\n'

      const socket = tls.connect({ host: this.host, port: this.port, ...TLS_OPTS }, () => {
        socket.write(httpHeader)
        if (bodyBuf != null) socket.write(bodyBuf)
      })

      const timer = setTimeout(() => socket.destroy(new Error('Printer timeout')), this.timeout)

      const chunks: Buffer[] = []
      socket.on('data', (c: Buffer) => chunks.push(c))
      socket.on('end', () => {
        clearTimeout(timer)
        const raw = Buffer.concat(chunks).toString('utf-8')
        const sep = raw.indexOf('\r\n\r\n')
        resolve(sep !== -1 ? raw.slice(sep + 4) : raw)
      })
      socket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  private async pressKey(keycode: number): Promise<void> {
    await this.request('POST', '/cmd/keycode', `keycode=${keycode}`)
  }

  private async pressKeys(keys: number[]): Promise<void> {
    for (const k of keys) {
      await this.pressKey(k)
    }
  }

  private async readDisplay(): Promise<string> {
    const body = await this.request('GET', '/cmd/display')
    try {
      return displayText(JSON.parse(body) as DisplayResponse)
    } catch {
      return body.trim()
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      const text = await this.readDisplay()
      const error = /ERR/i.test(text)
      return {
        online: true,
        paperPresent: !/CARTA/i.test(text),
        coverClosed: true,
        errorMessage: error ? text : '',
      }
    } catch (err: unknown) {
      return {
        online: false,
        paperPresent: false,
        coverClosed: false,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  async printReceipt(data: ReceiptData): Promise<PrintResult> {
    await this.pressKeys(receiptKeySequence(data))
    // Il protocollo keycode non restituisce esiti: verifichiamo dal display.
    // Su errore premiamo CL per non lasciare la tastiera in stato sporco.
    const text = await this.readDisplay()
    if (/ERR/i.test(text)) {
      await this.pressKey(KEY.clear).catch(() => {})
      return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: text }
    }
    return { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }
  }

  // Chiusura giornaliera (Z) da tastiera: 3 + CHIAVE entra in AZZERAMENTI,
  // TOTALE conferma la voce di chiusura, 1 + CHIAVE torna in REG.
  // DA VERIFICARE ON-SITE: la voce di menu confermata da TOTALE.
  async dailyClose(_operatorId: string): Promise<PrintResult> {
    await this.pressKeys([KEY.digits[3], KEY.key, KEY.total, KEY.digits[1], KEY.key])
    const text = await this.readDisplay()
    if (/ERR/i.test(text)) {
      return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: text }
    }
    return { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }
  }

  async openDrawer(_operatorId: string): Promise<void> {
    await this.pressKey(KEY.drawer)
  }
}
