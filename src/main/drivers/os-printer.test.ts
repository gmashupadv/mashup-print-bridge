import { describe, it, expect, vi } from 'vitest'
import { OsPrinterDriver } from './os-printer'
import { DEFAULT_LABEL_TEMPLATE } from '../printing/defaults'

const cfg = {
  ip: '', port: 0, timeout: 10000, operatorId: '1', deptMapping: {},
  deviceName: 'Brother QL-800',
  paper: { widthMm: 62, heightMm: 29, orientation: 'landscape' as const },
}

function makeDriver(printers = ['Brother QL-800', 'PDF']) {
  const deps = {
    listPrinters: vi.fn().mockResolvedValue(printers),
    printHtml: vi.fn().mockResolvedValue(undefined),
  }
  return { driver: new OsPrinterDriver(deps), deps }
}

describe('OsPrinterDriver', () => {
  it('declares label and non-fiscal capabilities', () => {
    const { driver } = makeDriver()
    expect(driver.capabilities).toEqual(expect.arrayContaining(['label', 'non-fiscal']))
  })

  it('getStatus online when deviceName exists in system list', async () => {
    const { driver } = makeDriver()
    await driver.connect(cfg)
    expect((await driver.getStatus()).online).toBe(true)
  })

  it('getStatus offline with message when deviceName missing', async () => {
    const { driver } = makeDriver(['AltroDriver'])
    await driver.connect(cfg)
    const st = await driver.getStatus()
    expect(st.online).toBe(false)
    expect(st.errorMessage).toContain('Brother QL-800')
  })

  it('printLabel renders html and prints with paper geometry', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabel(
      { name: 'X', price: 2.5 },
      { paper: cfg.paper, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(res.success).toBe(true)
    const [html, opts] = deps.printHtml.mock.calls[0]
    expect(html).toContain('X')
    expect(opts).toMatchObject({ deviceName: 'Brother QL-800', widthMm: 62, heightMm: 29, landscape: true })
  })

  it('printNonFiscal prints with configured width', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect({ ...cfg, paper: { widthMm: 80 } })
    const res = await driver.printNonFiscal({ lines: [{ text: 'ciao' }] })
    expect(res.success).toBe(true)
    expect(deps.printHtml.mock.calls[0][1].widthMm).toBe(80)
  })

  it('fails with clear error when deviceName not configured', async () => {
    const { driver } = makeDriver()
    await driver.connect({ ...cfg, deviceName: undefined })
    const res = await driver.printLabel({ name: 'X', price: 1 }, { paper: cfg.paper, template: DEFAULT_LABEL_TEMPLATE })
    expect(res.success).toBe(false)
    expect(res.errorMessage).toMatch(/deviceName|stampante di sistema/i)
  })
})
