import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { PaperConfig, LabelTemplate } from './drivers/interface'

export type PrinterRole = 'fiscal' | 'label' | 'receipt'

export interface PrinterConnection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
}

export interface PrinterConfig {
  id: string
  label: string
  role: PrinterRole
  driver: string
  connection: PrinterConnection
  operatorId: string
  deptMapping: Record<string, number>
  paper?: PaperConfig
  template?: LabelTemplate
}

export interface AppConfig {
  printers: PrinterConfig[]
  autostart: boolean
  port: number
  logLevel: 'error' | 'warn' | 'info' | 'debug'
}

const DEFAULTS: AppConfig = {
  printers: [
    {
      id: 'fiscal',
      label: 'Stampante fiscale',
      role: 'fiscal',
      driver: 'epson-fpmate',
      connection: { ip: '192.168.1.10', port: 80, timeout: 10000 },
      operatorId: '1',
      deptMapping: { '22.00': 1, '10.00': 2, '5.00': 3, '4.00': 4, '0.00': 5 },
    },
  ],
  autostart: true,
  port: 8765,
  logLevel: 'info',
}

function migrate(raw: Record<string, unknown>): AppConfig {
  // Old format: has top-level `driver` key but no `printers`
  if ('driver' in raw && !('printers' in raw)) {
    const connection = (raw['connection'] as PrinterConnection) ?? {
      ip: '192.168.1.10',
      port: 80,
      timeout: 10000,
    }
    const printer: PrinterConfig = {
      id: 'fiscal',
      label: 'Stampante fiscale',
      role: 'fiscal',
      driver: (raw['driver'] as string) ?? 'epson-fpmate',
      connection,
      operatorId: (raw['operatorId'] as string) ?? '1',
      deptMapping: (raw['deptMapping'] as Record<string, number>) ?? {},
    }
    return {
      ...DEFAULTS,
      autostart: raw['autostart'] !== undefined ? (raw['autostart'] as boolean) : DEFAULTS.autostart,
      port: raw['port'] !== undefined ? (raw['port'] as number) : DEFAULTS.port,
      logLevel:
        raw['logLevel'] !== undefined
          ? (raw['logLevel'] as AppConfig['logLevel'])
          : DEFAULTS.logLevel,
      printers: [printer],
    }
  }
  const merged = { ...DEFAULTS, ...raw } as AppConfig
  merged.printers = merged.printers.map((p) => ({ role: 'fiscal' as PrinterRole, ...p }))
  return merged
}

export interface ConfigManager {
  get(): AppConfig
  save(partial: Partial<AppConfig>): Promise<void>
}

export function createConfigManager(filePath: string): ConfigManager {
  let current = loadSync(filePath)

  function loadSync(fp: string): AppConfig {
    try {
      const raw = JSON.parse(readFileSync(fp, 'utf-8')) as Record<string, unknown>
      return migrate(raw)
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
