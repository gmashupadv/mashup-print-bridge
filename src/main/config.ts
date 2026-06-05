import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import * as path from 'node:path'

export interface AppConfig {
  driver: string
  autostart: boolean
  port: number
  logLevel: 'error' | 'warn' | 'info' | 'debug'
  connection: {
    ip: string
    port: number
    timeout: number
  }
  operatorId: string
  deptMapping: Record<string, number>
}

const DEFAULTS: AppConfig = {
  driver: 'epson-fpmate',
  autostart: true,
  port: 8765,
  logLevel: 'info',
  connection: { ip: '192.168.1.10', port: 80, timeout: 10000 },
  operatorId: '1',
  deptMapping: { '22.00': 1, '10.00': 2, '5.00': 3, '4.00': 4, '0.00': 5 },
}

export interface ConfigManager {
  get(): AppConfig
  save(partial: Partial<AppConfig>): Promise<void>
}

export function createConfigManager(filePath: string): ConfigManager {
  let current = loadSync(filePath)

  function loadSync(fp: string): AppConfig {
    try {
      const raw = readFileSync(fp, 'utf-8')
      return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULTS }
    }
  }

  return {
    get(): AppConfig {
      return current
    },
    async save(partial: Partial<AppConfig>): Promise<void> {
      current = { ...current, ...partial }
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(current, null, 2), 'utf-8')
    },
  }
}
