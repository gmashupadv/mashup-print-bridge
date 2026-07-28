// src/main/drivers/registry.ts
import type { PrinterDriver } from './interface'
import { EpsonFpMateDriver } from './epson-fpmate'
import { DitronWecDriver } from './ditron-wec'
import { DitronStreamWecDriver } from './ditron-streamwec'
import { DitronKeycodeDriver } from './ditron-keycode'
import { EscPosNetworkDriver } from './escpos-network'
import { ZplNetworkDriver } from './zpl-network'
import { OsPrinterDriver } from './os-printer'
import { AxonFpidDriver } from './axon-fpid'

const DRIVERS: Record<string, () => PrinterDriver> = {
  'epson-fpmate': () => new EpsonFpMateDriver(),
  'ditron-wec': () => new DitronWecDriver(),
  'ditron-streamwec': () => new DitronStreamWecDriver(),
  'ditron-keycode': () => new DitronKeycodeDriver(),
  'escpos-network': () => new EscPosNetworkDriver(),
  'zpl-network': () => new ZplNetworkDriver(),
  'os-printer': () => new OsPrinterDriver(),
  'axon-fpid': () => new AxonFpidDriver(),
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
