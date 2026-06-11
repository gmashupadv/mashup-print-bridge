import { XMLParser } from 'fast-xml-parser'
import type { Capability, DriverConfig, ReceiptData, PrintResult, PrinterStatus, PrinterDriver, NonFiscalDoc } from './interface'

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toCents(amount: number): string {
  return Math.round(amount * 100).toString()
}

function toMillis(qty: number): string {
  return Math.round(qty * 1000).toString()
}

function findFirst(obj: unknown, key: string): Record<string, string> | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined
  const record = obj as Record<string, unknown>
  if (key in record) return record[key] as Record<string, string>
  for (const val of Object.values(record)) {
    const found = findFirst(val, key)
    if (found !== undefined) return found
  }
  return undefined
}

export class EpsonFpMateDriver implements PrinterDriver {
  readonly name = 'epson-fpmate'
  readonly capabilities: Capability[] = ['fiscal-receipt', 'non-fiscal', 'daily-close', 'drawer']
  private url = ''
  private timeout = 15000
  private operatorId = '1'

  async connect(config: DriverConfig): Promise<void> {
    this.url = `http://${config.ip}:${config.port}/cgi-bin/fpmate.cgi`
    this.timeout = config.timeout
    this.operatorId = config.operatorId
  }

  async disconnect(): Promise<void> {}

  private async send(xml: string): Promise<string> {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), this.timeout)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: xml,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Printer timeout')
      throw err
    } finally {
      clearTimeout(id)
    }
  }

  _buildReceiptXml(data: ReceiptData): string {
    const op = this.operatorId
    let xml = '<?xml version="1.0" encoding="utf-8"?>'
    xml += '<printerFiscalReceipt>'
    xml += `<beginFiscalReceipt operator="${op}" />`
    for (const item of data.items) {
      xml += `<printRecItem operator="${op}"`
      xml += ` description="${escapeXml(item.description)}"`
      xml += ` quantity="${toMillis(item.quantity)}"`
      xml += ` unitPrice="${toCents(item.unitPrice)}"`
      xml += ` department="${item.department}"`
      xml += ' />'
    }
    if (data.discount > 0) {
      xml += `<printRecSubtotal operator="${op}" />`
      xml += `<printRecSubtotalAdjustment operator="${op}"`
      xml += ` description="Sconto"`
      xml += ` adjustmentType="3"`
      xml += ` amount="${toCents(data.discount)}"`
      xml += ' />'
    }
    for (const payment of data.payments) {
      xml += `<printRecTotal operator="${op}"`
      xml += ` description="${escapeXml(payment.description)}"`
      xml += ` payment="${toCents(payment.amount)}"`
      xml += ` paymentType="${payment.paymentType}"`
      xml += ' />'
    }
    xml += `<endFiscalReceipt operator="${op}" />`
    xml += '</printerFiscalReceipt>'
    return xml
  }

  _buildDailyCloseXml(operatorId: string): string {
    return `<?xml version="1.0" encoding="utf-8"?><printerFiscalReport><printZReport operator="${operatorId}" /></printerFiscalReport>`
  }

  _buildNonFiscalXml(doc: NonFiscalDoc): string {
    const op = this.operatorId
    let xml = '<?xml version="1.0" encoding="utf-8"?>'
    xml += '<printerNonFiscal>'
    xml += `<beginNonFiscal operator="${op}" />`
    for (const line of doc.lines) {
      // font FP-Mate: 1=normale, 2=bold, 3=doppia altezza, 4=bold+doppia (verificare resa 3/4 in campo)
      // align non è supportato da printNormal in FP-Mate (ignorato); cut non serve (endNonFiscal taglia già).
      const font = line.size === 'double' ? (line.bold ? '4' : '3') : line.bold ? '2' : '1'
      xml += `<printNormal operator="${op}" font="${font}" data="${escapeXml(line.text)}" />`
    }
    xml += `<endNonFiscal operator="${op}" />`
    xml += '</printerNonFiscal>'
    return xml
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const responseXml = await this.send(this._buildNonFiscalXml(doc))
    return this._parseResponse(responseXml)
  }

  _parseResponse(xmlText: string): PrintResult {
    let doc: unknown
    try {
      doc = xmlParser.parse(xmlText)
    } catch {
      return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: 'Invalid XML response' }
    }
    const el = findFirst(doc, 'response') ?? findFirst(doc, 'addInfo') ?? {}
    const success = el['@_success'] === 'true'
    const receiptNumber = String(el['@_fiscalReceiptNumber'] ?? '')
    const closureNumber = String(el['@_zRepNumber'] ?? '')
    const printerSerial = String(el['@_fiscalSerialNumber'] ?? '')
    const status = String(el['@_status'] ?? '0')
    const errorMessage = status !== '0' ? String(el['@_messageStatus'] ?? 'Unknown error') : ''
    return { success, receiptNumber, closureNumber, printerSerial, errorMessage }
  }

  async printReceipt(data: ReceiptData): Promise<PrintResult> {
    const responseXml = await this.send(this._buildReceiptXml(data))
    return this._parseResponse(responseXml)
  }

  async dailyClose(operatorId: string): Promise<PrintResult> {
    const responseXml = await this.send(this._buildDailyCloseXml(operatorId))
    return this._parseResponse(responseXml)
  }

  async openDrawer(operatorId: string): Promise<void> {
    const xml = `<?xml version="1.0" encoding="utf-8"?><printerCommand><openDrawer operator="${operatorId}" /></printerCommand>`
    await this.send(xml)
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?><printerCommand><queryPrinterStatus operator="${this.operatorId}" /></printerCommand>`
      const responseXml = await this.send(xml)
      let doc: unknown
      try { doc = xmlParser.parse(responseXml) } catch { doc = {} }
      const el = findFirst(doc, 'response') ?? findFirst(doc, 'printerStatus') ?? {}
      return {
        online: true,
        paperPresent: el['@_paperStatus'] !== '0',
        coverClosed: el['@_coverStatus'] === '0',
        errorMessage: '',
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
}
