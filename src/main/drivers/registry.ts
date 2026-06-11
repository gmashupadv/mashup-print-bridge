// src/main/drivers/registry.ts
import type { PrinterDriver } from './interface'
import { EpsonFpMateDriver } from './epson-fpmate'
import { DitronWecDriver } from './ditron-wec'
import { DitronStreamWecDriver } from './ditron-streamwec'
import { EscPosNetworkDriver } from './escpos-network'
import { OsPrinterDriver } from './os-printer'

const DRIVERS: Record<string, () => PrinterDriver> = {
  'epson-fpmate': () => new EpsonFpMateDriver(),
  'ditron-wec': () => new DitronWecDriver(),
  'ditron-streamwec': () => new DitronStreamWecDriver(),
  'escpos-network': () => new EscPosNetworkDriver(),
  'os-printer': () => new OsPrinterDriver(),
}

export function listDrivers(): string[] {
  return Object.keys(DRIVERS)
}

export function createDriver(name: string): PrinterDriver {
  const factory = DRIVERS[name]
  if (!factory) {
    throw new Error(`Unknown driver: "${name}". Available: ${listDrivers().join(', ')}`)
  }
  return factory()
}
