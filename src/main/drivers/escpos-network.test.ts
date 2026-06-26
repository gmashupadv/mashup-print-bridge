import { describe, it, expect, vi } from 'vitest'
import * as net from 'node:net'
import { EscPosNetworkDriver, sendTcp } from './escpos-network'
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

  // FIX 1: carta 80mm → area stampabile 72mm → 576 dot (non 640)
  it('printLabel rasterizes at printable head width for 80mm paper (576 dot) and sends raster + cut', async () => {
    const { driver, deps, sent } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(res.success).toBe(true)
    expect(deps.rasterize).toHaveBeenCalledWith(expect.any(String), 576)
    expect(sent[0].includes(Buffer.from([0x1d, 0x76, 0x30, 0x00]))).toBe(true)
  })

  // FIX 1: carta 58mm → area stampabile 48mm → 384 dot
  it('printLabel rasterizes at 384 dot for 58mm paper', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect(cfg)
    await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 58 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(deps.rasterize).toHaveBeenCalledWith(expect.any(String), 384)
  })

  // FIX 1: etichetta 62mm → nessun override → 62 * 8 = 496 dot
  it('printLabel rasterizes at 496 dot for 62mm label roll (no override)', async () => {
    const { driver, deps } = makeDriver()
    await driver.connect(cfg)
    await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 62 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(deps.rasterize).toHaveBeenCalledWith(expect.any(String), 496)
  })

  // FIX 1: renderLabelHtml riceve layout con widthMm già ridotta (printableMm)
  it('printLabel passes printable width to renderLabelHtml via layout for 80mm paper', async () => {
    // We verify by checking that rasterize receives the printable width (576),
    // and the HTML string passed to rasterize was rendered for 72mm (not 80mm).
    // The easiest observable proxy: the HTML is generated before rasterize is called,
    // and rasterize receives widthPx=576. We capture the html arg.
    const sent: Buffer[] = []
    let capturedHtml = ''
    const deps = {
      send: vi.fn(async (_h: string, _p: number, _t: number, data: Buffer) => { sent.push(data) }),
      rasterize: vi.fn(async (html: string, widthPx: number) => {
        capturedHtml = html
        return { widthPx, heightPx: 1, data: new Uint8Array(Math.ceil(widthPx / 8)) }
      }),
    }
    const driver = new EscPosNetworkDriver(deps)
    await driver.connect(cfg)
    await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    // The HTML should contain something consistent with 72mm width, not 80mm
    // (renderLabelHtml embeds widthMm in @page size and width). Match the page-width
    // context specifically so unrelated dimensions like a 2.80mm font-size don't trip it.
    expect(capturedHtml).toContain('72mm')
    expect(capturedHtml).not.toContain('size: 80mm')
    expect(capturedHtml).not.toContain('width: 80mm')
  })

  // FIX: rasterize rejection → PrintResult with success:false and errorMessage
  it('returns success:false with errorMessage when rasterize rejects', async () => {
    const deps = {
      send: vi.fn(),
      rasterize: vi.fn().mockRejectedValue(new Error('render boom')),
    }
    const driver = new EscPosNetworkDriver(deps)
    await driver.connect(cfg)
    const res = await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(res.success).toBe(false)
    expect(res.errorMessage).toContain('render boom')
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

  // FIX: printLabel senza connect → rejects
  it('printLabel rejects when not connected', async () => {
    const { driver } = makeDriver()
    await expect(
      driver.printLabel({ name: 'X', price: 1 }, { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE })
    ).rejects.toThrow(/not connected/i)
  })
})

// ---------------------------------------------------------------------------
// sendTcp — test su loopback reale
// ---------------------------------------------------------------------------
describe('sendTcp (real loopback)', () => {
  it('happy path: server receives exactly the bytes sent', async () => {
    const payload = Buffer.from('hello escpos')

    // Use a promise that resolves once the server has fully received all data
    // (on 'end' means the client half-closed the TCP stream — all bytes are in)
    let resolveReceived!: (buf: Buffer) => void
    const receivedPromise = new Promise<Buffer>((res) => { resolveReceived = res })

    const server = net.createServer((socket) => {
      let acc = Buffer.alloc(0)
      socket.on('data', (chunk) => { acc = Buffer.concat([acc, chunk]) })
      socket.on('end', () => { socket.end(); resolveReceived(acc) })
    })

    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const { port } = server.address() as net.AddressInfo

    try {
      await sendTcp('127.0.0.1', port, 5000, payload)
      const received = await receivedPromise
      expect(received).toEqual(payload)
    } finally {
      await new Promise<void>((res) => server.close(() => res()))
    }
  })

  it('rejects with ECONNREFUSED when no server is listening on the port', async () => {
    // Get an ephemeral port that is definitely not in use by briefly binding then closing a server
    const probe = net.createServer()
    await new Promise<void>((res) => probe.listen(0, '127.0.0.1', res))
    const { port } = probe.address() as net.AddressInfo
    await new Promise<void>((res) => probe.close(() => res()))

    // Port is now closed — sendTcp should reject with ECONNREFUSED
    await expect(sendTcp('127.0.0.1', port, 5000, Buffer.from('x'))).rejects.toThrow(/ECONNREFUSED/i)
  })

  // NOTE: The timeout branch (Printer timeout) is not covered by automated tests
  // because reliably triggering it in CI without flaky behaviour requires
  // a non-routable address (10.255.255.1) which may produce ENETUNREACH on some hosts,
  // or a server that accepts but never reads — where a small payload may still flush
  // before the timer fires. Left intentionally untested.
})
