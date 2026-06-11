import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs, writeFileSync, mkdtempSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createConfigManager } from './config'

function tmpConfigPath(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'mpb-')), 'config.json')
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpb-test-'))
})

describe('createConfigManager', () => {
  it('returns defaults when config file does not exist', () => {
    const cfg = createConfigManager(path.join(tmpDir, 'config.json'))
    expect(cfg.get().printers.length).toBe(1)
    expect(cfg.get().printers[0].id).toBe('fiscal')
    expect(cfg.get().printers[0].driver).toBe('epson-fpmate')
    expect(cfg.get().port).toBe(8765)
    expect(cfg.get().autostart).toBe(true)
  })

  it('reads persisted values (new format) and merges with defaults', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        printers: [
          {
            id: 'fiscal',
            label: 'Test',
            driver: 'ditron-wec',
            connection: { ip: '10.0.0.1', port: 12345, timeout: 5000 },
            operatorId: '2',
            deptMapping: {},
          },
        ],
        port: 9999,
      })
    )
    const cfg = createConfigManager(filePath)
    expect(cfg.get().printers[0].driver).toBe('ditron-wec')
    expect(cfg.get().port).toBe(9999)
    expect(cfg.get().autostart).toBe(true) // default fills missing fields
  })

  it('migrates old single-printer format to new printers[] format', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        driver: 'ditron-wec',
        port: 9999,
        connection: { ip: '192.168.1.50', port: 12345, timeout: 10000 },
        operatorId: '3',
        deptMapping: { '22.00': 1 },
        autostart: false,
      })
    )
    const cfg = createConfigManager(filePath)
    expect(cfg.get().printers.length).toBe(1)
    expect(cfg.get().printers[0].id).toBe('fiscal')
    expect(cfg.get().printers[0].driver).toBe('ditron-wec')
    expect(cfg.get().printers[0].operatorId).toBe('3')
    expect(cfg.get().printers[0].deptMapping).toEqual({ '22.00': 1 })
    expect(cfg.get().port).toBe(9999)
    expect(cfg.get().autostart).toBe(false)
  })

  it('falls back to defaults on corrupt JSON', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    await fs.writeFile(filePath, 'NOT JSON {{{')
    const cfg = createConfigManager(filePath)
    expect(cfg.get().printers[0].driver).toBe('epson-fpmate')
  })

  it('save() merges partial config and persists to disk', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    const cfg = createConfigManager(filePath)
    await cfg.save({ port: 1234 })
    const stored = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    expect(stored.port).toBe(1234)
    expect(stored.printers[0].driver).toBe('epson-fpmate') // unchanged default
  })

  it('get() reflects the latest saved values', async () => {
    const cfg = createConfigManager(path.join(tmpDir, 'config.json'))
    const updatedPrinters = [
      {
        id: 'fiscal',
        label: 'Stampante fiscale',
        driver: 'epson-fpmate',
        connection: { ip: '192.168.1.10', port: 80, timeout: 10000 },
        operatorId: '5',
        deptMapping: { '22.00': 1, '10.00': 2, '5.00': 3, '4.00': 4, '0.00': 5 },
      },
    ]
    await cfg.save({ printers: updatedPrinters })
    expect(cfg.get().printers[0].operatorId).toBe('5')
  })
})

describe('role migration', () => {
  it('adds role "fiscal" to printers missing it', () => {
    const fp = tmpConfigPath()
    writeFileSync(fp, JSON.stringify({
      printers: [{ id: 'p1', label: 'X', driver: 'epson-fpmate',
        connection: { ip: '1.2.3.4', port: 80, timeout: 1000 },
        operatorId: '1', deptMapping: {} }],
      autostart: true, port: 8765, logLevel: 'info',
    }))
    const mgr = createConfigManager(fp)
    expect(mgr.get().printers[0].role).toBe('fiscal')
  })

  it('migrates legacy single-printer format with role fiscal', () => {
    const fp = tmpConfigPath()
    writeFileSync(fp, JSON.stringify({
      driver: 'ditron-wec',
      connection: { ip: '5.6.7.8', port: 12345, timeout: 5000 },
      operatorId: '2', deptMapping: { '22.00': 1 },
      autostart: false, port: 8765, logLevel: 'info',
    }))
    const mgr = createConfigManager(fp)
    const p = mgr.get().printers[0]
    expect(p.role).toBe('fiscal')
    expect(p.driver).toBe('ditron-wec')
  })

  it('falls back to fiscal for invalid role values', () => {
    const fp = tmpConfigPath()
    writeFileSync(
      fp,
      JSON.stringify({
        printers: [
          {
            id: 'p1',
            label: 'X',
            role: 'banana',
            driver: 'epson-fpmate',
            connection: { ip: '1.2.3.4', port: 80, timeout: 1000 },
            operatorId: '1',
            deptMapping: {},
          },
        ],
        autostart: true,
        port: 8765,
        logLevel: 'info',
      })
    )
    const mgr = createConfigManager(fp)
    expect(mgr.get().printers[0].role).toBe('fiscal')
  })

  it('keeps sibling fields when printers is not an array', () => {
    const fp = tmpConfigPath()
    writeFileSync(
      fp,
      JSON.stringify({
        printers: {},
        autostart: true,
        port: 9999,
        logLevel: 'info',
      })
    )
    const mgr = createConfigManager(fp)
    expect(mgr.get().port).toBe(9999)
    expect(Array.isArray(mgr.get().printers)).toBe(true)
    expect(mgr.get().printers.length).toBeGreaterThan(0)
    expect(mgr.get().printers[0].driver).toBe('epson-fpmate')
  })

  it('preserves paper and template fields', () => {
    const fp = tmpConfigPath()
    writeFileSync(fp, JSON.stringify({
      printers: [{ id: 'lab', label: 'Etich', role: 'label', driver: 'os-printer',
        connection: { ip: '', port: 0, timeout: 10000, deviceName: 'Brother QL-800' },
        operatorId: '1', deptMapping: {},
        paper: { widthMm: 62, heightMm: 29, orientation: 'landscape' },
        template: { preset: 'product-price', showBarcode: true, fontScale: 1 } }],
      autostart: true, port: 8765, logLevel: 'info',
    }))
    const mgr = createConfigManager(fp)
    const p = mgr.get().printers[0]
    expect(p.role).toBe('label')
    expect(p.paper?.widthMm).toBe(62)
    expect(p.connection.deviceName).toBe('Brother QL-800')
    expect(p.template?.preset).toBe('product-price')
  })
})
