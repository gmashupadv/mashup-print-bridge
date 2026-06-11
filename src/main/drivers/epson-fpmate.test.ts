import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EpsonFpMateDriver } from './epson-fpmate'
import type { DriverConfig, ReceiptData } from './interface'

const BASE_CONFIG: DriverConfig = {
  ip: '192.168.1.10',
  port: 80,
  timeout: 5000,
  operatorId: '1',
  deptMapping: { '22.00': 1, '10.00': 2, '4.00': 3, '0.00': 4 },
}

const RECEIPT: ReceiptData = {
  items: [{ description: 'Maglia M', quantity: 2, unitPrice: 25.0, department: 1, vatRate: 22 }],
  discount: 0,
  payments: [{ description: 'Carta', amount: 50.0, paymentType: 2 }],
}

describe('EpsonFpMateDriver XML building', () => {
  it('includes item fields with correct unit conversions', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = driver._buildReceiptXml(RECEIPT)
    expect(xml).toContain('description="Maglia M"')
    expect(xml).toContain('quantity="2000"')   // millis
    expect(xml).toContain('unitPrice="2500"')  // cents
    expect(xml).toContain('department="1"')
    expect(xml).toContain('payment="5000"')    // cents
    expect(xml).toContain('paymentType="2"')
  })

  it('escapes XML special characters in description', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const data: ReceiptData = {
      items: [{ description: 'Prod & Co <1>', quantity: 1, unitPrice: 10, department: 1, vatRate: 22 }],
      discount: 0,
      payments: [{ description: 'Cash', amount: 10, paymentType: 0 }],
    }
    const xml = driver._buildReceiptXml(data)
    expect(xml).toContain('description="Prod &amp; Co &lt;1&gt;"')
  })

  it('includes discount adjustment when discount > 0', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const data: ReceiptData = { ...RECEIPT, discount: 5.0 }
    const xml = driver._buildReceiptXml(data)
    expect(xml).toContain('printRecSubtotalAdjustment')
    expect(xml).toContain('amount="500"')
  })

  it('buildDailyCloseXml includes printZReport with operator', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = driver._buildDailyCloseXml('1')
    expect(xml).toContain('printZReport')
    expect(xml).toContain('operator="1"')
  })
})

describe('EpsonFpMateDriver parseResponse', () => {
  it('parses successful receipt response', () => {
    const driver = new EpsonFpMateDriver()
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerFiscalReceipt><response success="true" code="0" status="0" fiscalReceiptNumber="0042" zRepNumber="005" fiscalSerialNumber="99MEX123456" /></printerFiscalReceipt>`
    const result = driver._parseResponse(xml)
    expect(result.success).toBe(true)
    expect(result.receiptNumber).toBe('0042')
    expect(result.closureNumber).toBe('005')
    expect(result.printerSerial).toBe('99MEX123456')
    expect(result.errorMessage).toBe('')
  })

  it('parses error response', () => {
    const driver = new EpsonFpMateDriver()
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerFiscalReceipt><response success="false" code="8193" status="8193" messageStatus="Stampante non pronta" /></printerFiscalReceipt>`
    const result = driver._parseResponse(xml)
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Stampante non pronta')
  })

  it('returns failure with message on invalid XML', () => {
    const driver = new EpsonFpMateDriver()
    const result = driver._parseResponse('not xml at all <<<')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('Invalid XML')
  })
})

describe('_buildNonFiscalXml', () => {
  it('wraps lines in printerNonFiscal block', () => {
    const d = new EpsonFpMateDriver()
    const xml = d._buildNonFiscalXml({
      lines: [
        { text: 'PRECONTO', bold: true },
        { text: 'riga & speciale' },
      ],
    })
    expect(xml).toContain('<printerNonFiscal>')
    expect(xml).toContain('<beginNonFiscal')
    expect(xml).toContain('data="PRECONTO"')
    expect(xml).toContain('font="2"') // bold
    expect(xml).toContain('riga &amp; speciale')
    expect(xml).toContain('<endNonFiscal')
  })

  it('uses font 4 for double size and font 1 for plain', () => {
    const d = new EpsonFpMateDriver()
    const xml = d._buildNonFiscalXml({
      lines: [{ text: 'GRANDE', size: 'double' }, { text: 'normale' }],
    })
    expect(xml).toContain('font="4"')
    expect(xml).toContain('font="1"')
  })
})

describe('capabilities', () => {
  it('declares non-fiscal', () => {
    expect(new EpsonFpMateDriver().capabilities).toContain('non-fiscal')
  })
})

describe('EpsonFpMateDriver.getStatus', () => {
  it('returns offline status on network error', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const status = await driver.getStatus()
    expect(status.online).toBe(false)
    expect(status.errorMessage).toContain('ECONNREFUSED')
    vi.unstubAllGlobals()
  })

  it('returns online status on valid response', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerCommand><response success="true" status="0" paperStatus="1" coverStatus="0" /></printerCommand>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }))
    const status = await driver.getStatus()
    expect(status.online).toBe(true)
    expect(status.paperPresent).toBe(true)
    expect(status.coverClosed).toBe(true)
    vi.unstubAllGlobals()
  })
})
