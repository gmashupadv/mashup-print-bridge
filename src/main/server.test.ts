import { describe, it, expect, vi } from 'vitest'
import { buildServer } from './server'
import type { ServerOptions } from './server'
import type { PrinterDriver } from './drivers/interface'

function makeMockDriver(overrides?: Partial<PrinterDriver>): PrinterDriver {
  return {
    name: 'mock',
    capabilities: ['fiscal-receipt', 'non-fiscal', 'label', 'daily-close', 'drawer', 'cut'],
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ online: true, paperPresent: true, coverClosed: true, errorMessage: '' }),
    printReceipt: vi.fn().mockResolvedValue({ success: true, receiptNumber: '0001', closureNumber: '001', printerSerial: 'SERIAL', errorMessage: '' }),
    printNonFiscal: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    printLabel: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    dailyClose: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '005', printerSerial: 'SERIAL', errorMessage: '' }),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeOpts(driver = makeMockDriver(), deptMapping: Record<string, number> = {}): ServerOptions {
  return {
    getPrinters: () => [
      {
        config: {
          id: 'fiscal',
          label: 'Test',
          role: 'fiscal',
          driver: 'mock',
          connection: { ip: '0', port: 0, timeout: 0 },
          operatorId: '1',
          deptMapping,
        },
        driver,
      },
    ],
    version: '1.0.0',
  }
}

describe('GET /ping', () => {
  it('returns ok, version, driver name, and printers list', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ ok: true, version: '1.0.0', driver: 'mock' })
    expect(body.printers).toEqual([{ id: 'fiscal', driver: 'mock' }])
  })
})

describe('GET /status', () => {
  it('returns printer status from driver', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json().online).toBe(true)
  })

  it('returns 503 when no printers configured', async () => {
    const app = buildServer({ getPrinters: () => [], version: '1.0.0' })
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(503)
  })
})

describe('GET /printers', () => {
  it('returns list of printers with status', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/printers' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toMatchObject({ id: 'fiscal', label: 'Test', driver: 'mock', ip: '0' })
    expect(body[0].status.online).toBe(true)
  })
})

describe('POST /print', () => {
  it('applies vatRate→dept mapping before calling printReceipt', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver, { '22.00': 3 }))
    await app.inject({
      method: 'POST',
      url: '/print',
      payload: {
        items: [{ description: 'X', quantity: 1, unitPrice: 10, vatRate: 22 }],
        discount: 0,
        payments: [{ description: 'Cash', amount: 10, paymentType: 0 }],
      },
    })
    const callArg = (driver.printReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArg.items[0].department).toBe(3)
  })

  it('returns 500 with error message on driver exception', async () => {
    const driver = makeMockDriver({
      printReceipt: vi.fn().mockRejectedValue(new Error('Paper jam')),
    })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('Paper jam')
  })

  it('returns 404 when printerId is specified but not found', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [], printerId: 'unknown' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /daily-close', () => {
  it('calls dailyClose and returns result', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'POST',
      url: '/daily-close',
      payload: { operatorId: '1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })
})

describe('POST /open-drawer', () => {
  it('returns 204 on success', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/open-drawer', payload: {} })
    expect(res.statusCode).toBe(204)
  })
})

describe('GET /printers (capabilities)', () => {
  it('includes role and capabilities', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/printers' })
    const body = res.json()
    expect(body[0].role).toBe('fiscal')
    expect(body[0].capabilities).toContain('fiscal-receipt')
  })
})

describe('POST /print capability check', () => {
  it('returns 503 when only printer lacks fiscal-receipt and no printerId given', async () => {
    const driver = makeMockDriver({ capabilities: ['label'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST', url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/non supporta|Nessuna stampante/i)
  })

  it('routes /print without printerId to the first capable fiscal printer in multi-printer config', async () => {
    const labelDriver = makeMockDriver({ capabilities: ['label'] })
    const fiscalDriver = makeMockDriver({
      capabilities: ['fiscal-receipt', 'daily-close', 'drawer'],
      printReceipt: vi.fn().mockResolvedValue({
        success: true,
        receiptNumber: '0042',
        closureNumber: '001',
        printerSerial: 'SERIAL',
        errorMessage: '',
      }),
    })
    const opts: ServerOptions = {
      getPrinters: () => [
        {
          config: {
            id: 'label-printer',
            label: 'Label',
            role: 'label',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: labelDriver,
        },
        {
          config: {
            id: 'fiscal-printer',
            label: 'Fiscal',
            role: 'fiscal',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: fiscalDriver,
        },
      ],
      version: '1.0.0',
    }
    const app = buildServer(opts)
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(fiscalDriver.printReceipt).toHaveBeenCalledTimes(1)
    expect(labelDriver.printReceipt).not.toHaveBeenCalled()
  })
})

describe('POST /daily-close capability check', () => {
  it('returns 409 when target printerId lacks daily-close capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/daily-close',
      payload: { operatorId: '1', printerId: 'fiscal' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/non supporta|Nessuna stampante/i)
  })
})

describe('POST /open-drawer capability check', () => {
  it('returns 503 when no printer has drawer capability', async () => {
    const driver = makeMockDriver({ capabilities: ['label'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/open-drawer',
      payload: {},
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/non supporta|Nessuna stampante/i)
  })

  it('includes success:false alongside error when resolve fails (no capability)', async () => {
    const driver = makeMockDriver({ capabilities: ['label'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/open-drawer',
      payload: {},
    })
    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBeDefined()
  })

  it('includes success:false alongside error when driver throws', async () => {
    const driver = makeMockDriver({
      openDrawer: vi.fn().mockRejectedValue(new Error('Drawer stuck')),
    })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/open-drawer',
      payload: {},
    })
    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('Drawer stuck')
  })
})

describe('POST /print with explicit printerId lacking fiscal-receipt', () => {
  it('returns 409 when printerId points to a printer without fiscal-receipt capability', async () => {
    const driver = makeMockDriver({ capabilities: ['label', 'drawer'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [], printerId: 'fiscal' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/non supporta/i)
  })
})

describe('POST /daily-close without printerId — no capable printer', () => {
  it('returns 503 when no printer has daily-close capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt', 'label'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/daily-close',
      payload: {},
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/Nessuna stampante/i)
  })
})

describe('POST /print-nonfiscal', () => {
  const payload = {
    lines: [
      { text: 'PRECONTO', bold: true, size: 'double', align: 'center' },
      { text: 'TOTALE 13,00', align: 'right' },
    ],
    cut: true,
  }

  it('routes to printNonFiscal with doc', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(200)
    const arg = (driver.printNonFiscal as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.lines[0].text).toBe('PRECONTO')
    expect(arg.cut).toBe(true)
  })

  it('falls back to first printer WITH the capability when printerId omitted', async () => {
    const fiscalDriver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const nonFiscalDriver = makeMockDriver({
      capabilities: ['non-fiscal'],
      printNonFiscal: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    })
    const opts: ServerOptions = {
      getPrinters: () => [
        {
          config: {
            id: 'fiscal-printer',
            label: 'Fiscal',
            role: 'fiscal',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: fiscalDriver,
        },
        {
          config: {
            id: 'nonfiscal-printer',
            label: 'NonFiscal',
            role: 'receipt',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: nonFiscalDriver,
        },
      ],
      version: '1.0.0',
    }
    const app = buildServer(opts)
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(200)
    expect(nonFiscalDriver.printNonFiscal).toHaveBeenCalledTimes(1)
    expect(fiscalDriver.printNonFiscal).not.toHaveBeenCalled()
  })

  it('returns 409 for explicit printerId without capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload: { ...payload, printerId: 'fiscal' } })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for unknown printerId', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload: { ...payload, printerId: 'nope' } })
    expect(res.statusCode).toBe(404)
  })

  it('returns 500 on driver error', async () => {
    const driver = makeMockDriver({ printNonFiscal: vi.fn().mockRejectedValue(new Error('Paper out')) })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('Paper out')
  })
})

describe('POST /print-label', () => {
  const payload = {
    label: { name: 'T-shirt', variant: 'M / Nero', price: 19.9, sku: 'TSH-M', barcode: '8001234567897' },
  }

  it('calls printLabel with label and layout from config', async () => {
    const driver = makeMockDriver()
    const opts = makeOpts(driver)
    const printers = opts.getPrinters()
    printers[0].config.paper = { widthMm: 62, heightMm: 29 }
    printers[0].config.template = { preset: 'product-price', showBarcode: true, fontScale: 1 }
    const app = buildServer({ ...opts, getPrinters: () => printers })
    const res = await app.inject({ method: 'POST', url: '/print-label', payload })
    expect(res.statusCode).toBe(200)
    const [labelArg, layoutArg] = (driver.printLabel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(labelArg.name).toBe('T-shirt')
    expect(layoutArg.paper.widthMm).toBe(62)
    expect(layoutArg.template.showBarcode).toBe(true)
  })

  it('uses defaults when paper/template missing from config', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    await app.inject({ method: 'POST', url: '/print-label', payload })
    const [, layoutArg] = (driver.printLabel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(layoutArg.paper.widthMm).toBeGreaterThan(0)
    expect(layoutArg.template.preset).toBe('product-price')
  })

  it('prints N copies', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-label', payload: { ...payload, copies: 3 } })
    expect(res.statusCode).toBe(200)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
  })

  it('returns 503 when no printer has label capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-label', payload })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when label.name or price missing', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-label', payload: { label: { name: 'X' } } })
    expect(res.statusCode).toBe(400)
  })

  // --- NEW TESTS (TDD: written before production fix) ---

  it('returns 400 when copies is a non-numeric string like "abc" and never calls printLabel', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { ...payload, copies: 'abc' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining('copies') })
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('returns 400 when copies is 0', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { ...payload, copies: 0 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining('copies') })
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('clamps copies to 50 and reports copiesPrinted: 50 in response when copies: 100', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { ...payload, copies: 100 },
    })
    expect(res.statusCode).toBe(200)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(50)
    expect(res.json()).toMatchObject({ copiesRequested: 100, copiesPrinted: 50 })
  })

  it('early-breaks on failure and reports copiesPrinted correctly', async () => {
    const driver = makeMockDriver({
      printLabel: vi.fn()
        .mockResolvedValueOnce({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' })
        .mockResolvedValueOnce({ success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: 'Jam' })
        .mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { ...payload, copies: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    expect(res.json()).toMatchObject({ success: false, copiesPrinted: 1, copiesRequested: 5 })
  })

  it('merges partial paper config with defaults so orientation and marginsMm come from defaults', async () => {
    const driver = makeMockDriver()
    const opts = makeOpts(driver)
    const printers = opts.getPrinters()
    printers[0].config.paper = { widthMm: 62, heightMm: 29 }
    const app = buildServer({ ...opts, getPrinters: () => printers })
    await app.inject({ method: 'POST', url: '/print-label', payload })
    const [, layoutArg] = (driver.printLabel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(layoutArg.paper.widthMm).toBe(62)
    expect(layoutArg.paper.heightMm).toBe(29)
    expect(layoutArg.paper.orientation).toBe('portrait')
    expect(layoutArg.paper.marginsMm).toBeDefined()
  })

  it('accepts an alphanumeric SKU barcode (Code128) and returns 200', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { label: { name: 'Prodotto', price: 9.9, barcode: 'E39C2E14' } },
    })
    expect(res.statusCode).toBe(200)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('returns 400 only when barcode has unprintable characters', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { label: { name: 'Prodotto', price: 9.9, barcode: 'A\x01B' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('accepts a valid 12-digit barcode (800123456789) and returns 200', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-label',
      payload: { label: { name: 'Prodotto', price: 9.9, barcode: '800123456789' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })
})

describe('GET /status multi-printer: prefers fiscal-capable printer', () => {
  it('returns status of the fiscal-receipt printer, not the label-only printer', async () => {
    const labelDriver = makeMockDriver({
      capabilities: ['label'],
      getStatus: vi.fn().mockResolvedValue({
        online: true,
        paperPresent: true,
        coverClosed: true,
        errorMessage: 'label-only-printer',
      }),
    })
    const fiscalDriver = makeMockDriver({
      capabilities: ['fiscal-receipt', 'daily-close', 'drawer'],
      getStatus: vi.fn().mockResolvedValue({
        online: true,
        paperPresent: true,
        coverClosed: true,
        errorMessage: 'fiscal-printer',
      }),
    })
    const opts: ServerOptions = {
      getPrinters: () => [
        {
          config: {
            id: 'label-printer',
            label: 'Label',
            role: 'label',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: labelDriver,
        },
        {
          config: {
            id: 'fiscal-printer',
            label: 'Fiscal',
            role: 'fiscal',
            driver: 'mock',
            connection: { ip: '0', port: 0, timeout: 0 },
            operatorId: '1',
            deptMapping: {},
          },
          driver: fiscalDriver,
        },
      ],
      version: '1.0.0',
    }
    const app = buildServer(opts)
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json().errorMessage).toBe('fiscal-printer')
  })
})

describe('POST /print-courtesy', () => {
  const valid = { header: ['I.P.S. S.R.L.'], items: ['ABITO DONNA'], number: '1329' }

  it('400 se manca header', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: { items: ['A'] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
  })

  it('400 se manca items', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: { header: ['N'] } })
    expect(res.statusCode).toBe(400)
  })

  it('200 e invoca printNonFiscal con payload valido', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: valid })
    expect(res.statusCode).toBe(200)
    expect((driver.printNonFiscal as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('409 se la stampante richiesta non ha capability non-fiscal', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-courtesy',
      payload: { ...valid, printerId: 'fiscal' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('400 se returnPolicy è una stringa invece di array', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'POST',
      url: '/print-courtesy',
      payload: { ...valid, returnPolicy: 'Nessun reso' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining('returnPolicy') })
  })

  it('400 se footer non è un array', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'POST',
      url: '/print-courtesy',
      payload: { ...valid, footer: 42 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining('footer') })
  })

  it('200 con tutti i campi opzionali ben formati', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-courtesy',
      payload: {
        ...valid,
        returnPolicy: ['a'],
        footer: ['b'],
        number: '1',
        date: 'x',
      },
    })
    expect(res.statusCode).toBe(200)
    expect((driver.printNonFiscal as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })
})

describe('CORS / Private Network Access', () => {
  const ORIGIN = 'https://cashflow.mashupadv.it'

  it('riflette l’origin e i metodi su una GET reale', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/printers', headers: { origin: ORIGIN } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['vary']).toContain('Origin')
    expect(res.headers['access-control-allow-methods']).toContain('POST')
  })

  it('risponde 204 alla preflight OPTIONS con header CORS', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/print',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type')
  })

  it('concede Access-Control-Allow-Private-Network quando richiesto', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/print',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-private-network': 'true',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-private-network']).toBe('true')
  })

  it('senza origin usa il wildcard *', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})
