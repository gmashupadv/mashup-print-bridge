# Mashup Print Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mashup Print Bridge Electron app — a tray-resident background service exposing HTTP on `127.0.0.1:8765` that translates POS print requests to fiscal printer protocols.

**Architecture:** electron-vite scaffold with TypeScript for main and renderer processes. Fastify handles the HTTP layer bound to loopback only. A driver registry pattern routes commands to the active printer driver. React + Tailwind config UI (400×520px) communicates with the main process exclusively via contextBridge IPC.

**Tech Stack:** Electron 31, electron-vite, TypeScript, Fastify, fast-xml-parser, React 18, Tailwind CSS 3, @headlessui/react, electron-updater, electron-log, electron-builder, Vitest.

---

## File Map

**Scaffold / config:**
- `package.json`, `electron.vite.config.ts`, `vitest.config.ts`
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- `electron-builder.yml`
- `.github/workflows/release.yml`

**Main process:**
- `src/main/index.ts` — app lifecycle, tray, IPC handlers
- `src/main/server.ts` — Fastify HTTP server + `buildServer` factory
- `src/main/config.ts` — `createConfigManager` factory (read/write config.json)
- `src/main/updater.ts` — electron-updater wrapper

**Driver layer:**
- `src/main/drivers/interface.ts` — `PrinterDriver` interface + shared types
- `src/main/drivers/registry.ts` — driver factory map, `createDriver`, `listDrivers`
- `src/main/drivers/epson-fpmate.ts` — Epson FpMate HTTP/XML driver
- `src/main/drivers/ditron-wec.ts` — Ditron WEC stub

**Preload:**
- `src/preload/index.ts` — contextBridge IPC surface

**Renderer:**
- `src/renderer/src/main.tsx` — React entry point
- `src/renderer/src/App.tsx` — root component + IPC wiring
- `src/renderer/src/env.d.ts` — `window.bridge` type declaration
- `src/renderer/src/index.css` — Tailwind directives
- `src/renderer/src/components/DriverPicker.tsx`
- `src/renderer/src/components/ConnectionForm.tsx`
- `src/renderer/src/components/DeptMapping.tsx`
- `src/renderer/src/components/EventLog.tsx`

**Tests:**
- `src/main/drivers/epson-fpmate.test.ts`
- `src/main/config.test.ts`
- `src/main/server.test.ts`

**Resources:**
- `resources/icon.png` — placeholder (replace with real asset before release)
- `resources/icon.ico` — placeholder (Windows)

---

## Task 1: Scaffold electron-vite project

**Files:** `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`

- [ ] **Step 1: Create scaffold**

Run from the repo root (allow overwrite of all generated files; do NOT overwrite `CLAUDE.md`, `README.md`, `docs/`, `.git/`):

```bash
npm create electron-vite@latest . -- --template react-ts
```

- [ ] **Step 2: Install additional dependencies**

```bash
npm install fastify fast-xml-parser electron-updater electron-log
npm install tailwindcss @headlessui/react
npm install -D @types/node vitest @vitest/coverage-v8 postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind**

Replace `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{tsx,ts,html}'],
  theme: { extend: {} },
  plugins: [],
}
```

Create `src/renderer/src/index.css` (overwrite if exists):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Add test config**

Create `vitest.config.ts` at project root:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
  },
})
```

Add test scripts to `package.json` `scripts` block:
```json
"test": "vitest run",
"test:watch": "vitest",
"dist:win": "electron-vite build && electron-builder --win",
"dist:mac": "electron-vite build && electron-builder --mac",
"dist:linux": "electron-vite build && electron-builder --linux"
```

- [ ] **Step 5: Verify dev mode starts**

```bash
npm run dev
```
Expected: Electron window opens with the default electron-vite demo. Close it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite react-ts project"
```

---

## Task 2: Driver interface and shared types

**Files:**
- Create: `src/main/drivers/interface.ts`

- [ ] **Step 1: Create interface.ts**

```typescript
// src/main/drivers/interface.ts
export interface DriverConfig {
  ip: string
  port: number
  timeout: number
  operatorId: string
  deptMapping: Record<string, number>
}

export interface ReceiptItem {
  description: string
  quantity: number
  unitPrice: number
  department: number
  vatRate: number
}

export interface ReceiptPayment {
  description: string
  amount: number
  paymentType: number
}

export interface ReceiptData {
  items: ReceiptItem[]
  discount: number
  payments: ReceiptPayment[]
}

export interface PrintResult {
  success: boolean
  receiptNumber: string
  closureNumber: string
  printerSerial: string
  errorMessage: string
}

export interface PrinterStatus {
  online: boolean
  paperPresent: boolean
  coverClosed: boolean
  errorMessage: string
}

export interface PrinterDriver {
  readonly name: string
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  printReceipt(data: ReceiptData): Promise<PrintResult>
  dailyClose(operatorId: string): Promise<PrintResult>
  openDrawer(operatorId: string): Promise<void>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/drivers/interface.ts
git commit -m "feat: add PrinterDriver interface and shared types"
```

---

## Task 3: Driver registry

**Files:**
- Create: `src/main/drivers/registry.ts`

Note: this file imports from `epson-fpmate` and `ditron-wec` which do not exist yet — TypeScript will error until Tasks 4 and 5 are complete. Write it now; verify compile after Task 5.

- [ ] **Step 1: Create registry.ts**

```typescript
// src/main/drivers/registry.ts
import type { PrinterDriver } from './interface'
import { EpsonFpMateDriver } from './epson-fpmate'
import { DitronWecDriver } from './ditron-wec'

const DRIVERS: Record<string, () => PrinterDriver> = {
  'epson-fpmate': () => new EpsonFpMateDriver(),
  'ditron-wec': () => new DitronWecDriver(),
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main/drivers/registry.ts
git commit -m "feat: add driver registry"
```

---

## Task 4: epson-fpmate driver

**Files:**
- Create: `src/main/drivers/epson-fpmate.ts`
- Create: `src/main/drivers/epson-fpmate.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/drivers/epson-fpmate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EpsonFpMateDriver } from './epson-fpmate'
import type { DriverConfig, ReceiptData } from './interface'

const BASE_CONFIG: DriverConfig = {
  ip: '192.168.1.10',
  port: 80,
  timeout: 5000,
  operatorId: '1',
  deptMapping: { '22.00': 1, '10.00': 2, '4.00': 3, '0.00': 4 },
}

const RECEIPT: ReceiptData = {
  items: [{ description: 'Maglia M', quantity: 2, unitPrice: 25.0, department: 1, vatRate: 22 }],
  discount: 0,
  payments: [{ description: 'Carta', amount: 50.0, paymentType: 2 }],
}

describe('EpsonFpMateDriver XML building', () => {
  it('includes item fields with correct unit conversions', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = driver._buildReceiptXml(RECEIPT)
    expect(xml).toContain('description="Maglia M"')
    expect(xml).toContain('quantity="2000"')   // millis
    expect(xml).toContain('unitPrice="2500"')  // cents
    expect(xml).toContain('department="1"')
    expect(xml).toContain('payment="5000"')    // cents
    expect(xml).toContain('paymentType="2"')
  })

  it('escapes XML special characters in description', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const data: ReceiptData = {
      items: [{ description: 'Prod & Co <1>', quantity: 1, unitPrice: 10, department: 1, vatRate: 22 }],
      discount: 0,
      payments: [{ description: 'Cash', amount: 10, paymentType: 0 }],
    }
    const xml = driver._buildReceiptXml(data)
    expect(xml).toContain('description="Prod &amp; Co &lt;1&gt;"')
  })

  it('includes discount adjustment when discount > 0', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const data: ReceiptData = { ...RECEIPT, discount: 5.0 }
    const xml = driver._buildReceiptXml(data)
    expect(xml).toContain('printRecSubtotalAdjustment')
    expect(xml).toContain('amount="500"')
  })

  it('buildDailyCloseXml includes printZReport with operator', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = driver._buildDailyCloseXml('1')
    expect(xml).toContain('printZReport')
    expect(xml).toContain('operator="1"')
  })
})

describe('EpsonFpMateDriver parseResponse', () => {
  it('parses successful receipt response', () => {
    const driver = new EpsonFpMateDriver()
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerFiscalReceipt><response success="true" code="0" status="0" fiscalReceiptNumber="0042" zRepNumber="005" fiscalSerialNumber="99MEX123456" /></printerFiscalReceipt>`
    const result = driver._parseResponse(xml)
    expect(result.success).toBe(true)
    expect(result.receiptNumber).toBe('0042')
    expect(result.closureNumber).toBe('005')
    expect(result.printerSerial).toBe('99MEX123456')
    expect(result.errorMessage).toBe('')
  })

  it('parses error response', () => {
    const driver = new EpsonFpMateDriver()
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerFiscalReceipt><response success="false" code="8193" status="8193" messageStatus="Stampante non pronta" /></printerFiscalReceipt>`
    const result = driver._parseResponse(xml)
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Stampante non pronta')
  })

  it('returns failure with message on invalid XML', () => {
    const driver = new EpsonFpMateDriver()
    const result = driver._parseResponse('not xml at all <<<')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('Invalid XML')
  })
})

describe('EpsonFpMateDriver.getStatus', () => {
  it('returns offline status on network error', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const status = await driver.getStatus()
    expect(status.online).toBe(false)
    expect(status.errorMessage).toContain('ECONNREFUSED')
    vi.unstubAllGlobals()
  })

  it('returns online status on valid response', async () => {
    const driver = new EpsonFpMateDriver()
    await driver.connect(BASE_CONFIG)
    const xml = `<?xml version="1.0" encoding="UTF-8"?><printerCommand><response success="true" status="0" paperStatus="1" coverStatus="0" /></printerCommand>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }))
    const status = await driver.getStatus()
    expect(status.online).toBe(true)
    expect(status.paperPresent).toBe(true)
    expect(status.coverClosed).toBe(true)
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/main/drivers/epson-fpmate.test.ts
```
Expected: FAIL — `Cannot find module './epson-fpmate'`

- [ ] **Step 3: Implement epson-fpmate.ts**

```typescript
// src/main/drivers/epson-fpmate.ts
import { XMLParser } from 'fast-xml-parser'
import type { DriverConfig, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toCents(amount: number): string {
  return Math.round(amount * 100).toString()
}

function toMillis(qty: number): string {
  return Math.round(qty * 1000).toString()
}

function findFirst(obj: unknown, key: string): Record<string, string> | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined
  const record = obj as Record<string, unknown>
  if (key in record) return record[key] as Record<string, string>
  for (const val of Object.values(record)) {
    const found = findFirst(val, key)
    if (found !== undefined) return found
  }
  return undefined
}

export class EpsonFpMateDriver implements PrinterDriver {
  readonly name = 'epson-fpmate'
  private url = ''
  private timeout = 15000
  private operatorId = '1'

  async connect(config: DriverConfig): Promise<void> {
    this.url = `http://${config.ip}:${config.port}/cgi-bin/fpmate.cgi`
    this.timeout = config.timeout
    this.operatorId = config.operatorId
  }

  async disconnect(): Promise<void> {}

  private async send(xml: string): Promise<string> {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), this.timeout)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: xml,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Printer timeout')
      throw err
    } finally {
      clearTimeout(id)
    }
  }

  _buildReceiptXml(data: ReceiptData): string {
    const op = this.operatorId
    let xml = '<?xml version="1.0" encoding="utf-8"?>'
    xml += '<printerFiscalReceipt>'
    xml += `<beginFiscalReceipt operator="${op}" />`
    for (const item of data.items) {
      xml += `<printRecItem operator="${op}"`
      xml += ` description="${escapeXml(item.description)}"`
      xml += ` quantity="${toMillis(item.quantity)}"`
      xml += ` unitPrice="${toCents(item.unitPrice)}"`
      xml += ` department="${item.department}"`
      xml += ' />'
    }
    if (data.discount > 0) {
      xml += `<printRecSubtotal operator="${op}" />`
      xml += `<printRecSubtotalAdjustment operator="${op}"`
      xml += ` description="Sconto"`
      xml += ` adjustmentType="3"`
      xml += ` amount="${toCents(data.discount)}"`
      xml += ' />'
    }
    for (const payment of data.payments) {
      xml += `<printRecTotal operator="${op}"`
      xml += ` description="${escapeXml(payment.description)}"`
      xml += ` payment="${toCents(payment.amount)}"`
      xml += ` paymentType="${payment.paymentType}"`
      xml += ' />'
    }
    xml += `<endFiscalReceipt operator="${op}" />`
    xml += '</printerFiscalReceipt>'
    return xml
  }

  _buildDailyCloseXml(operatorId: string): string {
    return `<?xml version="1.0" encoding="utf-8"?><printerFiscalReport><printZReport operator="${operatorId}" /></printerFiscalReport>`
  }

  _parseResponse(xmlText: string): PrintResult {
    let doc: unknown
    try {
      doc = xmlParser.parse(xmlText)
    } catch {
      return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: 'Invalid XML response' }
    }
    const el = findFirst(doc, 'response') ?? findFirst(doc, 'addInfo') ?? {}
    const success = el['@_success'] === 'true'
    const receiptNumber = String(el['@_fiscalReceiptNumber'] ?? '')
    const closureNumber = String(el['@_zRepNumber'] ?? '')
    const printerSerial = String(el['@_fiscalSerialNumber'] ?? '')
    const status = String(el['@_status'] ?? '0')
    const errorMessage = status !== '0' ? String(el['@_messageStatus'] ?? 'Unknown error') : ''
    return { success, receiptNumber, closureNumber, printerSerial, errorMessage }
  }

  async printReceipt(data: ReceiptData): Promise<PrintResult> {
    const responseXml = await this.send(this._buildReceiptXml(data))
    return this._parseResponse(responseXml)
  }

  async dailyClose(operatorId: string): Promise<PrintResult> {
    const responseXml = await this.send(this._buildDailyCloseXml(operatorId))
    return this._parseResponse(responseXml)
  }

  async openDrawer(operatorId: string): Promise<void> {
    const xml = `<?xml version="1.0" encoding="utf-8"?><printerCommand><openDrawer operator="${operatorId}" /></printerCommand>`
    await this.send(xml)
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?><printerCommand><queryPrinterStatus operator="${this.operatorId}" /></printerCommand>`
      const responseXml = await this.send(xml)
      let doc: unknown
      try { doc = xmlParser.parse(responseXml) } catch { doc = {} }
      const el = findFirst(doc, 'response') ?? findFirst(doc, 'printerStatus') ?? {}
      return {
        online: true,
        paperPresent: el['@_paperStatus'] !== '0',
        coverClosed: el['@_coverStatus'] === '0',
        errorMessage: '',
      }
    } catch (err: unknown) {
      return {
        online: false,
        paperPresent: false,
        coverClosed: false,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/main/drivers/epson-fpmate.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/epson-fpmate.ts src/main/drivers/epson-fpmate.test.ts
git commit -m "feat: add epson-fpmate driver with tests"
```

---

## Task 5: ditron-wec stub

**Files:**
- Create: `src/main/drivers/ditron-wec.ts`

- [ ] **Step 1: Create the stub**

```typescript
// src/main/drivers/ditron-wec.ts
import type { DriverConfig, ReceiptData, PrintResult, PrinterStatus, PrinterDriver } from './interface'

const MSG = 'Ditron WEC driver: not implemented — pending Wireshark capture'

export class DitronWecDriver implements PrinterDriver {
  readonly name = 'ditron-wec'

  async connect(_config: DriverConfig): Promise<void> {
    // Intentionally does not throw — connect is called at startup for the active driver.
    // Operations will fail when actually used.
  }

  async disconnect(): Promise<void> {}

  async getStatus(): Promise<PrinterStatus> {
    return { online: false, paperPresent: false, coverClosed: false, errorMessage: MSG }
  }

  async printReceipt(_data: ReceiptData): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async dailyClose(_operatorId: string): Promise<PrintResult> {
    throw new Error(MSG)
  }

  async openDrawer(_operatorId: string): Promise<void> {
    throw new Error(MSG)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles (registry now resolves)**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/drivers/ditron-wec.ts
git commit -m "feat: add ditron-wec stub driver"
```

---

## Task 6: config.ts

**Files:**
- Create: `src/main/config.ts`
- Create: `src/main/config.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/config.test.ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/main/config.test.ts
```
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Implement config.ts**

```typescript
// src/main/config.ts
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/main/config.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts src/main/config.test.ts
git commit -m "feat: add config manager with tests"
```

---

## Task 7: server.ts

**Files:**
- Create: `src/main/server.ts`
- Create: `src/main/server.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/server.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildServer } from './server'
import type { PrinterDriver } from './drivers/interface'

function makeMockDriver(overrides?: Partial<PrinterDriver>): PrinterDriver {
  return {
    name: 'mock',
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ online: true, paperPresent: true, coverClosed: true, errorMessage: '' }),
    printReceipt: vi.fn().mockResolvedValue({ success: true, receiptNumber: '0001', closureNumber: '001', printerSerial: 'SERIAL', errorMessage: '' }),
    dailyClose: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '005', printerSerial: 'SERIAL', errorMessage: '' }),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('GET /ping', () => {
  it('returns ok, version, and driver name', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, version: '1.0.0', driver: 'mock' })
  })
})

describe('GET /status', () => {
  it('returns printer status from driver', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json().online).toBe(true)
  })
})

describe('POST /print', () => {
  it('applies vatRate→dept mapping before calling printReceipt', async () => {
    const driver = makeMockDriver()
    const app = buildServer({
      getDriver: () => driver,
      version: '1.0.0',
      getDeptMapping: () => ({ '22.00': 3 }),
    })
    await app.inject({
      method: 'POST',
      url: '/print',
      payload: {
        items: [{ description: 'X', quantity: 1, unitPrice: 10, vatRate: 22 }],
        discount: 0,
        payments: [{ description: 'Cash', amount: 10, paymentType: 0 }],
      },
    })
    const callArg = (driver.printReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArg.items[0].department).toBe(3)
  })

  it('returns 500 with error message on driver exception', async () => {
    const driver = makeMockDriver({
      printReceipt: vi.fn().mockRejectedValue(new Error('Paper jam')),
    })
    const app = buildServer({ getDriver: () => driver, version: '1.0.0' })
    const res = await app.inject({
      method: 'POST',
      url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('Paper jam')
  })
})

describe('POST /daily-close', () => {
  it('calls dailyClose and returns result', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({
      method: 'POST',
      url: '/daily-close',
      payload: { operatorId: '1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })
})

describe('POST /open-drawer', () => {
  it('returns 204 on success', async () => {
    const app = buildServer({ getDriver: () => makeMockDriver(), version: '1.0.0' })
    const res = await app.inject({ method: 'POST', url: '/open-drawer', payload: {} })
    expect(res.statusCode).toBe(204)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/main/server.test.ts
```
Expected: FAIL — `Cannot find module './server'`

- [ ] **Step 3: Implement server.ts**

```typescript
// src/main/server.ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { PrinterDriver } from './drivers/interface'

interface ServerOptions {
  getDriver: () => PrinterDriver
  version: string
  getDeptMapping?: () => Record<string, number>
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  const { getDriver, version, getDeptMapping } = opts

  app.get('/ping', async () => ({
    ok: true,
    version,
    driver: getDriver().name,
  }))

  app.get('/status', async (_req, reply) => {
    try {
      return await getDriver().getStatus()
    } catch (err: unknown) {
      reply.status(500)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.post<{ Body: { items: any[]; discount: number; payments: any[] } }>(
    '/print',
    async (req, reply) => {
      try {
        const mapping = getDeptMapping?.() ?? {}
        const items = req.body.items.map((item) => ({
          ...item,
          department: mapping[Number(item.vatRate).toFixed(2)] ?? item.department ?? 1,
        }))
        return await getDriver().printReceipt({ items, discount: req.body.discount, payments: req.body.payments })
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )

  app.post<{ Body: { operatorId?: string } }>('/daily-close', async (req, reply) => {
    try {
      return await getDriver().dailyClose(req.body.operatorId ?? '1')
    } catch (err: unknown) {
      reply.status(500)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.post<{ Body: { operatorId?: string } }>('/open-drawer', async (req, reply) => {
    try {
      await getDriver().openDrawer(req.body.operatorId ?? '1')
      reply.status(204)
    } catch (err: unknown) {
      reply.status(500)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  return app
}

export async function startServer(
  opts: ServerOptions & { port: number }
): Promise<FastifyInstance> {
  const app = buildServer(opts)
  await app.listen({ host: '127.0.0.1', port: opts.port })
  return app
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/main/server.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests pass across all three test files (epson-fpmate, config, server).

- [ ] **Step 6: Commit**

```bash
git add src/main/server.ts src/main/server.test.ts
git commit -m "feat: add Fastify HTTP server with route tests"
```

---

## Task 8: updater.ts

**Files:**
- Create: `src/main/updater.ts`

No unit tests — electron-updater depends on the Electron runtime and GitHub network.

- [ ] **Step 1: Create updater.ts**

```typescript
// src/main/updater.ts
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'

autoUpdater.logger = log
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

interface UpdaterOptions {
  getConfigWindow: () => BrowserWindow | null
  onUpdateAvailable: (version: string) => void
}

export function initUpdater(opts: UpdaterOptions): void {
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
    opts.onUpdateAvailable(info.version)
    opts.getConfigWindow()?.webContents.send('update:available', info.version)
  })

  autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded — will install on next quit')
  })

  autoUpdater.on('error', (err) => {
    log.error('Updater error:', err)
  })

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('Update check failed:', err))
  }, 10_000)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater.ts
git commit -m "feat: add electron-updater wrapper"
```

---

## Task 9: preload/index.ts

**Files:**
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/env.d.ts`

- [ ] **Step 1: Replace preload**

Replace the entire contents of `src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:save', partial),
  testDriver: () => ipcRenderer.invoke('driver:test'),
  listDrivers: () => ipcRenderer.invoke('driver:list'),
  onLogEvent: (cb: (msg: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg)
    ipcRenderer.on('log:event', handler)
    return () => ipcRenderer.removeListener('log:event', handler)
  },
  onUpdateAvailable: (cb: (version: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, version: string) => cb(version)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
})
```

- [ ] **Step 2: Add window.bridge type declaration**

Create `src/renderer/src/env.d.ts`:
```typescript
/// <reference types="vite/client" />

interface Window {
  bridge: {
    getConfig(): Promise<import('../../main/config').AppConfig>
    saveConfig(partial: Record<string, unknown>): Promise<void>
    testDriver(): Promise<import('../../main/drivers/interface').PrinterStatus>
    listDrivers(): Promise<string[]>
    onLogEvent(cb: (msg: string) => void): () => void
    onUpdateAvailable(cb: (version: string) => void): () => void
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: add contextBridge IPC surface and renderer types"
```

---

## Task 10: Main process — index.ts

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace main/index.ts**

Replace the entire contents of `src/main/index.ts`:
```typescript
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import * as path from 'node:path'
import log from 'electron-log'
import { createConfigManager } from './config'
import { createDriver, listDrivers } from './drivers/registry'
import { startServer } from './server'
import { initUpdater } from './updater'
import type { FastifyInstance } from 'fastify'
import type { PrinterDriver } from './drivers/interface'

const configPath = path.join(app.getPath('userData'), 'config.json')
const config = createConfigManager(configPath)
let driver: PrinterDriver = createDriver(config.get().driver)
let tray: Tray | null = null
let configWindow: BrowserWindow | null = null
let server: FastifyInstance | null = null
let updateVersion: string | null = null

// ------- Tray -------

function createTray(): void {
  const iconPath = path.join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Mashup Print Bridge')
  refreshTrayMenu(false)
}

function refreshTrayMenu(online: boolean): void {
  const cfg = config.get()
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `Bridge attivo (v${app.getVersion()})`, enabled: false },
    { label: `Stampante: ${cfg.connection.ip} ${online ? '✓' : '✗'}`, enabled: false },
    { type: 'separator' },
    { label: 'Apri configurazione...', click: openConfigWindow },
    { label: 'Test di stampa', click: testStatus },
    { type: 'separator' },
  ]
  if (updateVersion) {
    items.push({
      label: `Aggiornamento disponibile (${updateVersion})`,
      click: () => shell.openExternal('https://github.com/gmashupadv/mashup-print-bridge/releases/latest'),
    })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Esci', click: () => app.quit() })
  tray!.setContextMenu(Menu.buildFromTemplate(items))
}

function openConfigWindow(): void {
  if (configWindow) { configWindow.focus(); return }
  configWindow = new BrowserWindow({
    width: 400,
    height: 520,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Mashup Print Bridge — Configurazione',
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    configWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    configWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  configWindow.on('closed', () => { configWindow = null })
}

async function testStatus(): Promise<void> {
  try {
    const status = await driver.getStatus()
    emitLog(`Test: ${status.online ? 'online' : 'offline'} — ${status.errorMessage || 'OK'}`)
  } catch (err: unknown) {
    emitLog(`Test error: ${err instanceof Error ? err.message : 'Unknown'}`)
  }
}

// ------- Status polling -------

function startStatusPolling(): void {
  const poll = async (): Promise<void> => {
    try {
      const status = await driver.getStatus()
      refreshTrayMenu(status.online)
    } catch {
      refreshTrayMenu(false)
    }
  }
  poll()
  setInterval(poll, 30_000)
}

// ------- Logging -------

function emitLog(msg: string): void {
  log.info(msg)
  const line = `${new Date().toLocaleTimeString('it-IT')} — ${msg}`
  configWindow?.webContents.send('log:event', line)
}

function driverConfig() {
  const cfg = config.get()
  return {
    ip: cfg.connection.ip,
    port: cfg.connection.port,
    timeout: cfg.connection.timeout,
    operatorId: cfg.operatorId,
    deptMapping: cfg.deptMapping,
  }
}

// ------- IPC handlers -------

ipcMain.handle('config:get', () => config.get())

ipcMain.handle('config:save', async (_e, partial: Partial<ReturnType<typeof config.get>>) => {
  await config.save(partial)
  driver = createDriver(config.get().driver)
  try {
    await driver.connect(driverConfig())
  } catch (err: unknown) {
    log.error('Driver connect after config save:', err)
  }
  emitLog(`Config salvata — driver: ${driver.name}`)
})

ipcMain.handle('driver:test', () => driver.getStatus())

ipcMain.handle('driver:list', () => listDrivers())

// ------- App lifecycle -------

app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: config.get().autostart })

  try {
    await driver.connect(driverConfig())
  } catch (err: unknown) {
    log.error('Initial driver connect failed:', err)
  }

  server = await startServer({
    getDriver: () => driver,
    version: app.getVersion(),
    getDeptMapping: () => config.get().deptMapping,
    port: config.get().port,
  })
  log.info(`Server listening on 127.0.0.1:${config.get().port}`)

  createTray()
  startStatusPolling()

  initUpdater({
    getConfigWindow: () => configWindow,
    onUpdateAvailable: (version) => {
      updateVersion = version
      refreshTrayMenu(false)
    },
  })
})

app.on('window-all-closed', (e: Event) => {
  e.preventDefault() // Stay alive as tray app — never quit on window close
})

app.on('before-quit', async () => {
  await server?.close()
  await driver.disconnect()
})
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: main process — tray, lifecycle, IPC handlers, status polling"
```

---

## Task 11: React renderer

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/components/DriverPicker.tsx`
- Create: `src/renderer/src/components/ConnectionForm.tsx`
- Create: `src/renderer/src/components/DeptMapping.tsx`
- Create: `src/renderer/src/components/EventLog.tsx`

- [ ] **Step 1: Update renderer entry**

Replace `src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 2: Create DriverPicker.tsx**

```tsx
// src/renderer/src/components/DriverPicker.tsx
import React from 'react'
import { Listbox } from '@headlessui/react'

const STUBS = ['ditron-wec']

interface Props {
  drivers: string[]
  value: string
  onChange: (v: string) => void
}

export function DriverPicker({ drivers, value, onChange }: Props) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Driver stampante</label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative">
          <Listbox.Button className="w-full border border-gray-300 rounded px-3 py-2 text-left bg-white text-sm flex justify-between items-center">
            <span>{value}</span>
            {STUBS.includes(value) && (
              <span className="text-xs text-amber-600 ml-2">⚠ Non implementato</span>
            )}
          </Listbox.Button>
          <Listbox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg text-sm">
            {drivers.map((d) => (
              <Listbox.Option
                key={d}
                value={d}
                className={({ active }) =>
                  `px-3 py-2 cursor-pointer flex justify-between ${active ? 'bg-blue-50' : ''}`
                }
              >
                <span>{d}</span>
                {STUBS.includes(d) && <span className="text-xs text-amber-500">⚠</span>}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </div>
      </Listbox>
    </div>
  )
}
```

- [ ] **Step 3: Create ConnectionForm.tsx**

```tsx
// src/renderer/src/components/ConnectionForm.tsx
import React, { useState } from 'react'

interface Connection {
  ip: string
  port: number
  timeout: number
}

interface Props {
  value: Connection
  onChange: (v: Connection) => void
  onTest: () => Promise<void>
}

export function ConnectionForm({ value, onChange, onTest }: Props) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      await onTest()
      setResult({ ok: true, msg: 'Connessione OK' })
    } catch (err: unknown) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Errore' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Connessione</label>
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="IP"
          value={value.ip}
          onChange={(e) => onChange({ ...value, ip: e.target.value })}
        />
        <input
          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Porta"
          type="number"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
        />
        <input
          className="w-28 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Timeout ms"
          type="number"
          value={value.timeout}
          onChange={(e) => onChange({ ...value, timeout: Number(e.target.value) })}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? 'Testing…' : 'Testa connessione'}
        </button>
        {result && (
          <span className={`text-xs ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
            {result.ok ? '✓' : '✗'} {result.msg}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create DeptMapping.tsx**

```tsx
// src/renderer/src/components/DeptMapping.tsx
import React from 'react'

const VAT_RATES = ['22.00', '10.00', '5.00', '4.00', '0.00']

interface Props {
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
}

export function DeptMapping({ value, onChange }: Props) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Mapping reparti IVA</label>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="pb-1 font-normal">Aliquota IVA</th>
            <th className="pb-1 font-normal">Reparto</th>
          </tr>
        </thead>
        <tbody>
          {VAT_RATES.map((rate) => (
            <tr key={rate}>
              <td className="py-0.5 pr-4">{rate}%</td>
              <td>
                <input
                  type="number"
                  className="w-16 border border-gray-300 rounded px-1 py-0.5 text-sm"
                  value={value[rate] ?? ''}
                  min={1}
                  onChange={(e) => onChange({ ...value, [rate]: Number(e.target.value) })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Create EventLog.tsx**

```tsx
// src/renderer/src/components/EventLog.tsx
import React, { useRef, useEffect } from 'react'

interface Props {
  events: string[]
  onClear: () => void
}

export function EventLog({ events, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-sm font-medium text-gray-700">Log eventi</label>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={onClear}>
          Pulisci log
        </button>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded h-28 overflow-y-auto p-2 font-mono text-xs text-gray-600">
        {events.length === 0 ? (
          <span className="text-gray-400">Nessun evento</span>
        ) : (
          events.map((e, i) => <div key={i}>{e}</div>)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create App.tsx**

Replace `src/renderer/src/App.tsx`:
```tsx
import React, { useEffect, useState, useCallback } from 'react'
import { DriverPicker } from './components/DriverPicker'
import { ConnectionForm } from './components/ConnectionForm'
import { DeptMapping } from './components/DeptMapping'
import { EventLog } from './components/EventLog'
import type { AppConfig } from '../../main/config'

const DEFAULT: AppConfig = {
  driver: 'epson-fpmate',
  autostart: true,
  port: 8765,
  logLevel: 'info',
  connection: { ip: '', port: 80, timeout: 10000 },
  operatorId: '1',
  deptMapping: {},
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT)
  const [drivers, setDrivers] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    window.bridge.getConfig().then(setConfig)
    window.bridge.listDrivers().then(setDrivers)
    const unsub = window.bridge.onLogEvent((msg) =>
      setEvents((prev) => [...prev.slice(-49), msg])
    )
    return unsub
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.bridge.saveConfig(config as unknown as Record<string, unknown>)
      setSaveMsg('Salvato ✓')
    } catch {
      setSaveMsg('Errore nel salvataggio')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(''), 2500)
    }
  }

  const handleTest = useCallback(async () => {
    const status = await window.bridge.testDriver()
    if (!status.online) throw new Error(status.errorMessage || 'Stampante offline')
  }, [])

  return (
    <div className="p-4 bg-white min-h-screen text-gray-800 text-sm">
      <h1 className="font-semibold mb-4">Mashup Print Bridge — Configurazione</h1>

      <DriverPicker
        drivers={drivers}
        value={config.driver}
        onChange={(d) => setConfig({ ...config, driver: d })}
      />

      <ConnectionForm
        value={config.connection}
        onChange={(c) => setConfig({ ...config, connection: c })}
        onTest={handleTest}
      />

      <DeptMapping
        value={config.deptMapping}
        onChange={(m) => setConfig({ ...config, deptMapping: m })}
      />

      <div className="flex items-center gap-3 mb-4">
        <button
          className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Salvataggio…' : 'Salva configurazione'}
        </button>
        {saveMsg && <span className="text-green-600">{saveMsg}</span>}
      </div>

      <EventLog events={events} onClear={() => setEvents([])} />
    </div>
  )
}
```

- [ ] **Step 7: Verify dev app renders correctly**

```bash
npm run dev
```
Open the config window from the tray. Verify:
- Driver dropdown shows `epson-fpmate` and `ditron-wec` (with ⚠ badge on ditron)
- Connection form shows IP, Porta, Timeout fields
- "Testa connessione" on a non-existent IP shows red `✗ ECONNREFUSED` (or similar)
- Dept mapping table shows the 5 Italian VAT rates
- Log shows "Nessun evento"
- "Salva configurazione" saves without error

- [ ] **Step 8: Commit**

```bash
git add src/renderer/ src/preload/
git commit -m "feat: React config UI — driver picker, connection form, dept mapping, event log"
```

---

## Task 12: electron-builder.yml and resources

**Files:**
- Create: `electron-builder.yml`
- Create: `resources/icon.png` (placeholder)
- Create: `resources/icon.ico` (placeholder)

- [ ] **Step 1: Create electron-builder.yml**

Create `electron-builder.yml` at project root:
```yaml
appId: com.mashupadv.print-bridge
productName: Mashup Print Bridge
copyright: Copyright © 2026 Mashup ADV

directories:
  output: dist-electron-builder

files:
  - out/**/*
  - package.json

publish:
  provider: github
  owner: gmashupadv
  repo: mashup-print-bridge
  releaseType: draft

win:
  target:
    - target: nsis
      arch: [x64]
  icon: resources/icon.ico

nsis:
  oneClick: true
  perMachine: false
  runAfterFinish: true

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  icon: resources/icon.png
  category: public.app-category.utilities

linux:
  target:
    - AppImage
    - deb
  icon: resources/icon.png
  category: Utility
```

- [ ] **Step 2: Create placeholder icon files**

```bash
# Minimal valid 1x1 PNG (replace with real assets before release)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > resources/icon.png
cp resources/icon.png resources/icon.ico
```

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml resources/
git commit -m "chore: add electron-builder config and icon placeholders"
```

---

## Task 13: GitHub Actions release pipeline

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create release workflow**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run dist:win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: win-installer
          path: dist-electron-builder/*.exe

  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run dist:mac
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # CSC_LINK: ${{ secrets.CSC_LINK }}
          # CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: mac-dmg
          path: dist-electron-builder/*.dmg

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run dist:linux
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: linux-appimage
          path: dist-electron-builder/*.AppImage
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release pipeline for win/mac/linux"
```

---

## Task 14: End-to-end smoke test

- [ ] **Step 1: Full test suite**

```bash
npm test
```
Expected: all tests pass (epson-fpmate ×8, config ×5, server ×5).

- [ ] **Step 2: Verify /ping endpoint**

Start the app in dev mode (`npm run dev`), then in a separate terminal:
```bash
curl http://127.0.0.1:8765/ping
```
Expected:
```json
{"ok":true,"version":"1.0.0","driver":"epson-fpmate"}
```

- [ ] **Step 3: Verify /status endpoint**

```bash
curl http://127.0.0.1:8765/status
```
Expected:
```json
{"online":false,"paperPresent":false,"coverClosed":false,"errorMessage":"...ECONNREFUSED..."}
```
(offline because no physical Epson printer at the default IP)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: smoke test verified — MVP complete"
```

---

## Release checklist (before first tag)

- [ ] Replace `resources/icon.png` and `resources/icon.ico` with real branded 512×512 assets
- [ ] Set `GH_TOKEN` secret in GitHub repo → Settings → Secrets
- [ ] Test the installer on a real Windows machine and on macOS
- [ ] Tag: `git tag v1.0.0 && git push origin v1.0.0`
