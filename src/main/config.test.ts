import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createConfigManager } from './config'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpb-test-'))
})

describe('createConfigManager', () => {
  it('returns defaults when config file does not exist', () => {
    const cfg = createConfigManager(path.join(tmpDir, 'config.json'))
    expect(cfg.get().driver).toBe('epson-fpmate')
    expect(cfg.get().port).toBe(8765)
    expect(cfg.get().autostart).toBe(true)
  })

  it('reads persisted values and merges with defaults', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    await fs.writeFile(filePath, JSON.stringify({ driver: 'ditron-wec', port: 9999 }))
    const cfg = createConfigManager(filePath)
    expect(cfg.get().driver).toBe('ditron-wec')
    expect(cfg.get().port).toBe(9999)
    expect(cfg.get().autostart).toBe(true) // default fills missing fields
  })

  it('falls back to defaults on corrupt JSON', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    await fs.writeFile(filePath, 'NOT JSON {{{')
    const cfg = createConfigManager(filePath)
    expect(cfg.get().driver).toBe('epson-fpmate')
  })

  it('save() merges partial config and persists to disk', async () => {
    const filePath = path.join(tmpDir, 'config.json')
    const cfg = createConfigManager(filePath)
    await cfg.save({ port: 1234 })
    const stored = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    expect(stored.port).toBe(1234)
    expect(stored.driver).toBe('epson-fpmate') // unchanged default
  })

  it('get() reflects the latest saved values', async () => {
    const cfg = createConfigManager(path.join(tmpDir, 'config.json'))
    await cfg.save({ operatorId: '5' })
    expect(cfg.get().operatorId).toBe('5')
  })
})
