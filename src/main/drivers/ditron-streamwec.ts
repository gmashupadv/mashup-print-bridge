// Ditron StreamWEC REST driver
// Protocol: HTTP/1.0 POST to /cmd/wec with plain-text WEC commands.
// Trasporto: la cattura mitmproxy del gestionale (Danea) era HTTPS decifrato → la stampante
// parla TLS sulla 443 (cert self-signed). Il driver sceglie in base alla porta:
// 443 → HTTPS, altra porta → HTTP semplice. Risposta di successo: una riga "OK." per comando.
import net from 'node:net'
import tls from 'node:tls'
import type { Capability, DriverConfig, NonFiscalDoc, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

// Mappatura pagamento → CHIUS T=N (chiusura scontrino).
// Codici tender dalla config Firebird del gestionale: Contanti=1, POS elettronico=5.
// paymentType: 0 = contanti, 1 = carta/POS, 2+ = altro (default contanti).
const TENDER: Record<number, number> = { 0: 1, 1: 5, 2: 1 }

// Riga di cortesia stampata in fondo allo scontrino fiscale (CORT R1='…')
export const COURTESY_FOOTER = 'Grazie e arrivederci'

// Documento non fiscale WEC (= scontrino di cortesia), sintassi confermata da cattura:
// CLEAR / CHIAVE REG / NOFIS APRI / NOFIS RIGA='…' / NOFIS CHIUDI / wecfine.
export const NONFISCAL_OPEN = 'NOFIS APRI'
export const NONFISCAL_LINE = (text: string): string => `NOFIS RIGA='${text}'`
export const NONFISCAL_CLOSE = 'NOFIS CHIUDI'

export function buildNonFiscal(doc: NonFiscalDoc): string {
  const lines: string[] = ['CLEAR', 'CHIAVE REG', NONFISCAL_OPEN]
  for (const l of doc.lines) {
    // bold/size/align/cut non mappabili su WEC testo piano → ignorati.
    // \r\n neutralizzati insieme agli apici: una riga logica = un comando RIGA.
    lines.push(NONFISCAL_LINE(l.text.slice(0, 40).replace(/[\r\n']/g, ' ')))
  }
  lines.push(NONFISCAL_CLOSE, 'wecfine')
  return lines.join('\n') + '\n'
}

function eur(n: number): string {
  return n.toFixed(2)
}

// Sintassi WEC confermata da cattura del traffico del gestionale (Danea) verso questa
// stampante. Sequenza: CLEAR → CHIAVE REG → VEND… → SUBT → CHIUS T=tender → wecfine.
// Esempio reale:
//   CLEAR
//   CHIAVE REG
//   VEND REP=3,PREZZO=0.01,DES='Prodotto di prova'
//   SUBT
//   CHIUS T=1
//   wecfine
// Nota: PREZZO= (non PRE=), niente spazi dopo le virgole, DES='…' = scontrino parlante.
export function buildReceipt(data: ReceiptData): string {
  const lines: string[] = ['CLEAR', 'CHIAVE REG']
  for (const item of data.items) {
    // Ordine confermato da cattura: REP, QTY (se ≠1), PREZZO, DES
    const qty = item.quantity !== 1 ? `,QTY=${item.quantity}` : ''
    const des = item.description
      ? `,DES='${item.description.slice(0, 40).replace(/'/g, ' ')}'`
      : ''
    lines.push(`VEND REP=${item.department}${qty},PREZZO=${eur(item.unitPrice)}${des}`)
  }
  // Riga di cortesia nello scontrino fiscale (dopo i VEND, prima di sconto/SUBT — da cattura)
  lines.push(`CORT R1='${COURTESY_FOOTER}'`)
  if (data.discount > 0) {
    // Sconto a valore sul subtotale (confermato da cattura): "SCONTO VAL=9.99, SUBTOT"
    lines.push(`SCONTO VAL=${eur(data.discount)}, SUBTOT`)
  }
  lines.push('SUBT')
  // Divisione pagamento (da cattura): tutti i pagamenti tranne l'ultimo con IMP=importo;
  // l'ultimo senza IMP chiude il resto. Es. "CHIUS T=5,IMP=10.00" + "CHIUS T=1".
  const payments = data.payments.length > 0 ? data.payments : [{ description: '', amount: 0, paymentType: 0 }]
  payments.forEach((p, i) => {
    const tender = TENDER[p.paymentType] ?? 1
    const isLast = i === payments.length - 1
    lines.push(isLast ? `CHIUS T=${tender}` : `CHIUS T=${tender},IMP=${eur(p.amount)}`)
  })
  lines.push('wecfine')
  return lines.join('\n') + '\n'
}

export function parseResult(body: string): PrintResult {
  // Risposta confermata da cattura:
  //  - successo: una riga "OK." per ogni comando (es. 7 comandi → "OK.\nOK.\n…")
  //  - errore:   "ERRORE N/M : TIPO : DETTAGLIO" su una delle righe
  // Cerchiamo ERRORE ovunque (un comando può fallire dopo alcuni OK.).
  const errLine = body.split(/\r?\n/).find((l) => /^\s*ERRORE\b/i.test(l))
  if (errLine) {
    const parts = errLine.trim().split(/\s*:\s*/)
    const errorMessage = parts.slice(1).join(': ').trim() || errLine.trim()
    return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage }
  }
  // Successo SOLO se c'è almeno un "OK." (conferma di esecuzione). Una risposta vuota o
  // inattesa (porta/trasporto sbagliati, comando non eseguito) NON è un successo:
  // restituiamo il corpo grezzo così l'errore è diagnosticabile dal POS.
  if (body.includes('OK.')) {
    return { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }
  }
  const raw = body.trim().slice(0, 200) || '(risposta vuota)'
  return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: `Risposta inattesa dalla stampante: ${raw}` }
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

  // HTTP/1.0 su TCP semplice (come Danea): scriviamo la richiesta a mano e
  // togliamo il preambolo HTTP dalla risposta, lasciando solo il corpo ("OK." o "ERRORE…").
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
      // Porta 443 → HTTPS (cert self-signed, rejectUnauthorized: false); altrimenti HTTP semplice.
      const onConnect = (): void => {
        socket.write(httpHeader)
        if (bodyBuf != null) socket.write(bodyBuf)
      }
      const socket =
        this.port === 443
          ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false }, onConnect)
          : net.createConnection({ host: this.host, port: this.port }, onConnect)

      timer = setTimeout(() => socket.destroy(new Error('Printer timeout')), this.timeout)

      const chunks: Buffer[] = []
      socket.on('data', (c: Buffer) => chunks.push(c))
      socket.on('end', () => {
        if (timer) clearTimeout(timer)
        const raw = Buffer.concat(chunks).toString('utf-8')
        // Togli il preambolo "HTTP/1.x NNN …\r\n\r\n" lasciando il corpo
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
