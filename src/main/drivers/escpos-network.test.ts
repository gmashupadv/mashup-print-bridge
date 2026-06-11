import { describe, it, expect, vi } from 'vitest'
import { EscPosNetworkDriver } from './escpos-network'
import { DEFAULT_LABEL_TEMPLATE } from '../printing/defaults'

const cfg = { ip: '10.0.0.5', port: 9100, timeout: 3000, operatorId: '1', deptMapping: {}, paper: { widthMm: 80 } }

function makeDriver() {
  const sent: Buffer[] = []
  const deps = {
    send: vi.fn(async (_host: string, _port: number, _timeout: number, data: Buffer) => {
      sent.push(data)
    }),
    rasterize: vi.fn(async (_html: string, widthPx: number) => ({
      widthPx, heightPx: 1, data: new Uint8Array(Math.ceil(widthPx / 8)),
    })),
  }
  return { driver: new EscPosNetworkDriver(deps), deps, sent }
}

describe('EscPosNetworkDriver', () => {
  it('declares non-fiscal, label and cut capabilities', () => {
    const { driver } = makeDriver()
    expect(driver.capabilities).toEqual(expect.arrayContaining(['non-fiscal', 'label', 'cut']))
  })

  it('printNonFiscal sends encoded doc to configured host', async () => {
    const { driver, deps, sent } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printNonFiscal({ lines: [{ text: 'CIAO' }], cut: true })
    expect(res.success).toBe(true)
    expect(deps.send).toHaveBeenCalledWith('10.0.0.5', 9100, 3000, expect.any(Buffer))
    expect(sent[0].includes(Buffer.from('CIAO'))).toBe(true)
    expect(sent[0].includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))).toBe(true)
  })

  it('printLabel rasterizes at 8 dots/mm of paper width and sends raster + cut', async () => {
    const { driver, deps, sent } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(res.success).toBe(true)
    expect(deps.rasterize).toHaveBeenCalledWith(expect.any(String), 640)
    expect(sent[0].includes(Buffer.from([0x1d, 0x76, 0x30, 0x00]))).toBe(true)
  })

  it('reports failure as PrintResult on network error', async () => {
    const deps = {
      send: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      rasterize: vi.fn(),
    }
    const driver = new EscPosNetworkDriver(deps)
    await driver.connect(cfg)
    const res = await driver.printNonFiscal({ lines: [{ text: 'x' }] })
    expect(res.success).toBe(false)
    expect(res.errorMessage).toContain('ECONNREFUSED')
  })

  it('throws when not connected', async () => {
    const { driver } = makeDriver()
    await expect(driver.printNonFiscal({ lines: [] })).rejects.toThrow(/not connected/i)
  })
})
