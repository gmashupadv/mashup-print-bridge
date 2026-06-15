// Ditron StreamWEC REST driver
// Protocol: HTTPS POST to /cmd/wec with plain-text WEC commands
// Confirmed from Wireshark: printer at 192.168.1.22 uses HTTPS on port 443
// SSL cert: Ditron, Pozzuoli, *.ditronfiscalprinter.net (self-signed → rejectUnauthorized: false)
// Printer must be set to mode "StreamWEC – REST" (4+CHIAVE+9+Subtotale+Totale on keypad)
//
// NOTE: some firmware versions respond without HTTP headers (bare WEC text).
// We use raw tls.connect() so both HTTP-wrapped and bare responses are handled uniformly.
import tls from 'node:tls'
import type { Capability, DriverConfig, NonFiscalDoc, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

const TLS_OPTS: tls.ConnectionOptions = { rejectUnauthorized: false }

// Ditron WEC tender-code mapping (ReceiptPayment.paymentType → TERM=N)
// paymentType 0 = cash, 1 = credit card, 2+ = other
// TERM = codice funzione subtender = 124 + numero subtender (125…144, manuale WEC Ditron).
// Subtender programmati su questa unità (da capture Firebird del gestionale):
// Contanti=1 → TERM=125, POS elettronico=5 → TERM=129.
const TENDER: Record<number, number> = { 0: 125, 1: 129, 2: 125 }

// Comandi non fiscali WEC — DA VERIFICARE ON-SITE (i pcap in repo sono TLS-cifrati).
// Il firmware supporta lo scontrino di cortesia (chiavi Ecr_ScontrinoCortesia nel capture):
// confermare la sintassi esatta dal FCR Manager (https://<ip>) o dal manuale WEC Ditron
// e aggiornare queste tre costanti se diverse.
export const NONFISCAL_OPEN = 'NFIS APRI'
export const NONFISCAL_LINE = (text: string): string => `NFIS RIGA='${text}'`
export const NONFISCAL_CLOSE = 'NFIS CHIUDI'

export function buildNonFiscal(doc: NonFiscalDoc): string {
  const lines: string[] = [NONFISCAL_OPEN]
  for (const l of doc.lines) {
    // bold/size/align/cut non mappabili su WEC testo piano → ignorati.
    // \r\n neutralizzati insieme agli apici: una riga logica = un comando RIGA.
    lines.push(NONFISCAL_LINE(l.text.slice(0, 40).replace(/[\r\n']/g, ' ')))
  }
  lines.push(NONFISCAL_CLOSE)
  return lines.join('\n') + '\n'
}

function eur(n: number): string {
  return n.toFixed(2)
}

function buildReceipt(data: ReceiptData): string {
  const lines: string[] = []
  for (const item of data.items) {
    const desc = item.description
      ? `, DES='${item.description.slice(0, 40).replace(/'/g, ' ')}'`
      : ''
    const qty = item.quantity !== 1 ? `, QTA=${item.quantity}` : ''
    lines.push(`VEND REP=${item.department}, PRE=${eur(item.unitPrice)}${qty}${desc}`)
  }
  if (data.discount > 0) {
    lines.push(`DISC TIPO=A, VAL=${eur(data.discount)}`)
  }
  for (const p of data.payments) {
    // Importo con NUM= (non IMP=); NUM opzionale, omesso = chiusura a saldo
    lines.push(`INP TERM=${TENDER[p.paymentType] ?? 125}, NUM=${eur(p.amount)}`)
  }
  return lines.join('\n') + '\n'
}

function parseResult(body: string): PrintResult {
  // Confirmed Ditron error format: "ERRORE N/M : TIPO : DETTAGLIO"
  // e.g. "ERRORE 1/7 : ERRORE DI SINTASSI 7 : COSTANTE NON TROVATA"
  if (/^ERRORE\b/i.test(body.trim())) {
    const parts = body.trim().split(/\s*:\s*/)
    const errorMessage = parts.slice(1).join(': ').trim() || body.trim()
    return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage }
  }
  // Success response — field names TBD (verify at client site)
  // Likely: "SCONTRINO=XXXX CHIUSURA=XX MATRICOLA=XXXXXXXX" or similar
  const recMatch = body.match(/(?:SCO(?:NTRINO)?)[=:\s]+(\d+)/i)
  const clsMatch = body.match(/(?:CHI(?:USURA)?|AZZ|CLS)[=:\s]+(\d+)/i)
  const serMatch = body.match(/(?:MAT(?:RICOLA)?|SER)[=:\s]+([A-Z0-9]+)/i)
  return {
    success: true,
    receiptNumber: recMatch?.[1] ?? '',
    closureNumber: clsMatch?.[1] ?? '',
    printerSerial: serMatch?.[1] ?? '',
    errorMessage: '',
  }
}

export class DitronStreamWecDriver implements PrinterDriver {
  readonly name = 'ditron-streamwec'
  readonly capabilities: Capability[] = ['fiscal-receipt', 'non-fiscal', 'daily-close', 'drawer']
  private host = ''
  private port = 443
  private timeout = 15000
  private operatorId = '1'

  async connect(config: DriverConfig): Promise<void> {
    this.host = config.ip
    this.port = config.port
    this.timeout = config.timeout
    this.operatorId = config.operatorId
  }

  async disconnect(): Promise<void> {}

  // Raw TLS connection using HTTP/1.0 so we can read bare responses (no HTTP headers)
  // alongside standard HTTP responses — we strip the header block if present.
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
        headerLines.push('Content-Type: text/plain; charset=utf-8')
        headerLines.push(`Content-Length: ${bodyBuf.length}`)
      }
      const httpHeader = headerLines.join('\r\n') + '\r\n\r\n'

      let timer: ReturnType<typeof setTimeout> | null = null
      const socket = tls.connect(
        { host: this.host, port: this.port, ...TLS_OPTS },
        () => {
          socket.write(httpHeader)
          if (bodyBuf != null) socket.write(bodyBuf)
        },
      )

      timer = setTimeout(() => socket.destroy(new Error('Printer timeout')), this.timeout)

      const chunks: Buffer[] = []
      socket.on('data', (c: Buffer) => chunks.push(c))
      socket.on('end', () => {
        if (timer) clearTimeout(timer)
        const raw = Buffer.concat(chunks).toString('utf-8')
        // Strip HTTP preamble when server sends "HTTP/1.x NNN ...\r\n\r\n<body>"
        const sep = raw.indexOf('\r\n\r\n')
        resolve(sep !== -1 ? raw.slice(sep + 4) : raw)
      })
      socket.on('error', (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })
    })
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      await this.request('GET', '/cmd/wec')
      return { online: true, paperPresent: true, coverClosed: true, errorMessage: '' }
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
    return parseResult(await this.request('POST', '/cmd/wec', buildReceipt(data)))
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    return parseResult(await this.request('POST', '/cmd/wec', buildNonFiscal(doc)))
  }

  async dailyClose(_operatorId: string): Promise<PrintResult> {
    return parseResult(await this.request('POST', '/cmd/wec', 'REPORT NUM=1,MODO=1,STAMPA=3\n'))
  }

  async openDrawer(_operatorId: string): Promise<void> {
    await this.request('POST', '/cmd/wec', 'OPEN\n')
  }
}
