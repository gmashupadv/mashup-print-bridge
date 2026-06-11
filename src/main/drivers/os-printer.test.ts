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
    // FIX 1: dimensions are already final (cfg.paper has 62×29, already in landscape form);
    // os-printer must NOT re-apply rotation — landscape is always false
    expect(opts).toMatchObject({ deviceName: 'Brother QL-800', widthMm: 62, heightMm: 29, landscape: false })
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

  // FIX 2: printNonFiscal height is double-aware and ignores cfg.paper.heightMm (label geometry)
  it('printNonFiscal with 3 normal + 2 double lines uses height 38 (not label heightMm 29)', async () => {
    const { driver, deps } = makeDriver()
    // cfg.paper has heightMm 29 — must NOT be used for non-fiscal
    await driver.connect(cfg)
    const res = await driver.printNonFiscal({
      lines: [
        { text: 'A' },
        { text: 'B' },
        { text: 'C' },
        { text: 'D', size: 'double' },
        { text: 'E', size: 'double' },
      ],
    })
    expect(res.success).toBe(true)
    const opts = deps.printHtml.mock.calls[0][1]
    // 10 + 3*4 + 2*8 = 10+12+16 = 38
    expect(opts.heightMm).toBe(38)
  })

  // FIX 2: renderNonFiscalHtml also receives the estimated height (not 297)
  it('printNonFiscal passes estimated heightMm to renderNonFiscalHtml @page', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect(cfg)
    await driver.printNonFiscal({
      lines: [
        { text: 'A' },
        { text: 'B' },
        { text: 'C' },
        { text: 'D', size: 'double' },
        { text: 'E', size: 'double' },
      ],
    })
    const html = deps.printHtml.mock.calls[0][0] as string
    expect(html).toContain('size: 62mm 38mm')
  })

  // FIX 2: printNonFiscal respects minimum height of 30
  it('printNonFiscal with 0 lines uses minimum height 30', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect(cfg)
    await driver.printNonFiscal({ lines: [] })
    const opts = deps.printHtml.mock.calls[0][1]
    expect(opts.heightMm).toBe(30)
  })

  // FIX 3: printHtml rejection propagates as success:false with errorMessage
  it('printHtml rejection propagates as success:false with errorMessage', async () => {
    const deps = {
      listPrinters: vi.fn().mockResolvedValue(['Brother QL-800']),
      printHtml: vi.fn().mockRejectedValue(new Error('spooler crash')),
    }
    const driver = new OsPrinterDriver(deps)
    await driver.connect(cfg)
    const res = await driver.printNonFiscal({ lines: [{ text: 'x' }] })
    expect(res.success).toBe(false)
    expect(res.errorMessage).toBe('spooler crash')
  })

  // FIX 3: getStatus case-insensitive match (Windows queue names are case-insensitive)
  it('getStatus online:true when deviceName matches case-insensitively (brother ql-800 vs Brother QL-800)', async () => {
    const { driver } = makeDriver(['brother ql-800'])
    await driver.connect(cfg) // cfg.deviceName = 'Brother QL-800'
    const st = await driver.getStatus()
    expect(st.online).toBe(true)
  })
})
