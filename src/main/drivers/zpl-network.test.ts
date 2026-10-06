import { describe, it, expect, vi } from 'vitest'
import { ZplNetworkDriver } from './zpl-network'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from '../printing/defaults'
import type { DriverConfig, LabelData } from './interface'

const cfg: DriverConfig = {
  ip: '10.0.0.7',
  port: 9100,
  timeout: 3000,
  operatorId: '1',
  deptMapping: {},
}
const layout = { paper: DEFAULT_LABEL_PAPER, template: DEFAULT_LABEL_TEMPLATE }
const label: LabelData = { name: 'Maglietta', price: 19.9 }

function makeDriver() {
  const calls: Array<{ timeout: number; data: string }> = []
  const send = vi.fn(async (_h: string, _p: number, timeout: number, data: Buffer) => {
    calls.push({ timeout, data: data.toString('utf-8') })
  })
  return { driver: new ZplNetworkDriver({ send }), send, calls }
}

describe('ZplNetworkDriver — copie', () => {
  it('printLabel invia un formato solo, senza ^PQ', async () => {
    const { driver, calls } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabel(label, layout)
    expect(res.success).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].data).not.toContain('^PQ')
  })

  it('printLabelCopies apre UNA sola connessione e delega le copie a ^PQ', async () => {
    // Il punto della correzione: niente più N connessioni alla 9100 per N copie.
    const { driver, send, calls } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabelCopies(label, layout, 20)
    expect(res.success).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(calls[0].data).toContain('^PQ20,0,0,N')
  })

  it('scala il timeout sulla quantità: la testa chiude solo a etichette finite', async () => {
    const { driver, calls } = makeDriver()
    await driver.connect(cfg)
    await driver.printLabelCopies(label, layout, 10)
    expect(calls[0].timeout).toBe(cfg.timeout * 10)
  })

  it('riporta il fallimento se l invio non va a buon fine', async () => {
    const send = vi.fn(async () => {
      throw new Error('Printer timeout')
    })
    const driver = new ZplNetworkDriver({ send })
    await driver.connect(cfg)
    const res = await driver.printLabelCopies(label, layout, 5)
    expect(res.success).toBe(false)
    expect(res.errorMessage).toContain('timeout')
  })

  it('senza connect non stampa', async () => {
    const { driver } = makeDriver()
    await expect(driver.printLabelCopies(label, layout, 2)).rejects.toThrow(/not connected/)
  })
})
