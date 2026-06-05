import { describe, it, expect, vi } from 'vitest'
import { buildServer } from './server'
import type { PrinterDriver } from './drivers/interface'

function makeMockDriver(overrides?: Partial<PrinterDriver>): PrinterDriver {
  return {
    name: 'mock',
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ online: true, paperPresent: true, coverClosed: true, errorMessage: '' }),
    printReceipt: vi.fn().mockResolvedValue({ success: true, receiptNumber: '0001', closureNumber: '001', printerSerial: 'SERIAL', errorMessage: '' }),
    dailyClose: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '005', printerSerial: 'SERIAL', errorMessage: '' }),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('GET /ping', () => {
  it('returns ok, version, and driver name', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, version: '1.0.0', driver: 'mock' })
  })
})

describe('GET /status', () => {
  it('returns printer status from driver', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json().online).toBe(true)
  })
})

describe('POST /print', () => {
  it('applies vatRate→dept mapping before calling printReceipt', async () => {
    const driver = makeMockDriver()
    const app = buildServer({
      getDriver: () => driver,
      version: '1.0.0',
      getDeptMapping: () => ({ '22.00': 3 }),
    })
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
    const app = buildServer({ getDriver: () => driver, version: '1.0.0' })
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('Paper jam')
  })
})

describe('POST /daily-close', () => {
  it('calls dailyClose and returns result', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
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
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'POST', url: '/open-drawer', payload: {} })
    expect(res.statusCode).toBe(204)
  })
})
