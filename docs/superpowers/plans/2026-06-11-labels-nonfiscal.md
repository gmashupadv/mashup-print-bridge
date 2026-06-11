# Etichette e documenti non fiscali — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estendere il bridge con stampa etichette prodotto (nome/variante/prezzo/SKU/barcode EAN-13) e documenti non fiscali, su stampanti di sistema (driver `os-printer`, Win+Mac) e ESC/POS di rete, con stampa silenziosa e configurazione persistente.

**Architecture:** Capabilities opzionali sull'interfaccia `PrinterDriver`; nuovo modulo `src/main/printing/` (barcode EAN-13, renderer HTML etichetta/documento, encoder ESC/POS, stampa silenziosa Electron, probing carta per-OS); due endpoint nuovi (`/print-label`, `/print-nonfiscal`) con risoluzione per capability; UI config estesa con ruoli, stampanti di sistema e anteprima template.

**Tech Stack:** Electron 31 (BrowserWindow offscreen + `webContents.print` silent), Fastify, vitest, React+Tailwind. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-06-11-labels-nonfiscal-design.md`

**Nota scope barcode:** fase 1 solo EAN-13 (12/13 cifre numeriche). Codici non-EAN → la stampa fallisce con errore chiaro; Code128 è follow-up se servirà.

---

## Mappa file

| File | Azione | Responsabilità |
|---|---|---|
| `src/main/drivers/interface.ts` | modifica | Capability, tipi LabelData/NonFiscalDoc/PaperConfig/LabelTemplate/LabelLayout, metodi opzionali |
| `src/main/config.ts` | modifica | `role`, `paper`, `template`, `connection.deviceName`, migrazione |
| `src/main/server.ts` | modifica | `/printers` esteso, `/print-label`, `/print-nonfiscal`, risoluzione per capability |
| `src/main/printing/barcode.ts` | crea | EAN-13 → SVG |
| `src/main/printing/label-renderer.ts` | crea | LabelData+layout → HTML; NonFiscalDoc → HTML; default e sample |
| `src/main/printing/escpos-encoder.ts` | crea | NonFiscalDoc → byte ESC/POS; bitmap → raster GS v 0; CP858 |
| `src/main/printing/html-to-bitmap.ts` | crea | HTML → bitmap mono via BrowserWindow offscreen (Electron-only) |
| `src/main/printing/silent-print.ts` | crea | elenco stampanti di sistema + stampa HTML silenziosa (Electron-only) |
| `src/main/printing/paper-info.ts` | crea | probing formati carta: CUPS (mac/linux) / PowerShell (win) |
| `src/main/drivers/escpos-network.ts` | riscrive | implementazione completa TCP: non fiscale, etichetta raster, taglio |
| `src/main/drivers/os-printer.ts` | crea | stampa via driver di sistema, deps iniettabili |
| `src/main/drivers/epson-fpmate.ts` | modifica | `printNonFiscal` XML |
| `src/main/drivers/ditron-streamwec.ts` | modifica | `printNonFiscal` WEC (costanti da verificare on-site) |
| `src/main/drivers/ditron-wec.ts` | modifica | solo dichiarazione capabilities |
| `src/main/drivers/registry.ts` | modifica | registra `os-printer` |
| `src/main/index.ts` | modifica | IPC nuovi, `driverConfigFrom` esteso, `driver:test` esteso |
| `src/preload/index.ts` + `src/renderer/src/env.d.ts` | modifica | nuovi metodi bridge |
| `src/renderer/src/App.tsx`, `components/PrinterCard.tsx`, `components/ConnectionForm.tsx` | modifica | ruolo, connessione os-printer |
| `src/renderer/src/components/LabelTemplatePanel.tsx` | crea | template + anteprima |
| `CLAUDE.md` | modifica | aggiornamento finale |

---

### Task 1: Tipi condivisi e capabilities

**Files:**
- Modify: `src/main/drivers/interface.ts`
- Modify: `src/main/drivers/epson-fpmate.ts`, `src/main/drivers/ditron-wec.ts`, `src/main/drivers/ditron-streamwec.ts`, `src/main/drivers/escpos-network.ts`
- Modify: `src/main/server.test.ts` (mock driver)

- [ ] **Step 1: Riscrivere `src/main/drivers/interface.ts`** (sostituisce il file intero; i tipi esistenti restano identici):

```typescript
// src/main/drivers/interface.ts
export type Capability =
  | 'fiscal-receipt'
  | 'non-fiscal'
  | 'label'
  | 'daily-close'
  | 'drawer'
  | 'cut'

export interface PaperConfig {
  widthMm: number
  heightMm?: number
  orientation?: 'portrait' | 'landscape'
  marginsMm?: { top: number; right: number; bottom: number; left: number }
}

export interface LabelTemplate {
  preset: 'product-price'
  showBarcode: boolean
  fontScale: number
}

export interface LabelLayout {
  paper: PaperConfig
  template: LabelTemplate
}

export interface LabelData {
  name: string
  variant?: string
  price: number
  sku?: string
  barcode?: string
}

export interface NonFiscalLine {
  text: string
  bold?: boolean
  size?: 'normal' | 'double'
  align?: 'left' | 'center' | 'right'
}

export interface NonFiscalDoc {
  lines: NonFiscalLine[]
  cut?: boolean
}

export interface DriverConfig {
  ip: string
  port: number
  timeout: number
  operatorId: string
  deptMapping: Record<string, number>
  deviceName?: string
  paper?: PaperConfig
  template?: LabelTemplate
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
  readonly capabilities: Capability[]
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  // Metodi opzionali: presenti solo se la capability corrispondente è dichiarata.
  printReceipt?(data: ReceiptData): Promise<PrintResult>
  printNonFiscal?(doc: NonFiscalDoc): Promise<PrintResult>
  printLabel?(label: LabelData, layout: LabelLayout): Promise<PrintResult>
  dailyClose?(operatorId: string): Promise<PrintResult>
  openDrawer?(operatorId: string): Promise<void>
}
```

- [ ] **Step 2: Dichiarare capabilities nei driver esistenti** (una riga per file, sotto `readonly name`):

In `epson-fpmate.ts`:
```typescript
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']
```
(aggiungere `Capability` all'import dei tipi). `'non-fiscal'` arriva nel Task 12.

In `ditron-streamwec.ts`:
```typescript
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']
```

In `ditron-wec.ts` (stub: dichiara le capability fiscali così le rotte esistenti continuano a rispondere 500 "not implemented" — più informativo di un 409):
```typescript
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']
```

In `escpos-network.ts`:
```typescript
  readonly capabilities: Capability[] = []
```

- [ ] **Step 3: Aggiornare il mock in `src/main/server.test.ts`** — in `makeMockDriver` aggiungere dopo `name: 'mock',`:

```typescript
    capabilities: ['fiscal-receipt', 'non-fiscal', 'label', 'daily-close', 'drawer', 'cut'],
```
e aggiungere `Capability` se serve all'import: `import type { PrinterDriver } from './drivers/interface'` resta sufficiente perché il literal è assegnabile.

- [ ] **Step 4: Verificare che tutto compili e i test passino**

Run: `npx tsc --noEmit -p tsconfig.node.json && npm test`
Expected: 0 errori TS, tutti i test PASS (nessun comportamento cambiato).

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/ src/main/server.test.ts
git commit -m "feat: capability declarations + shared label/non-fiscal types on PrinterDriver"
```

---

### Task 2: Config — `role`, `paper`, `template`, migrazione

**Files:**
- Modify: `src/main/config.ts`
- Test: `src/main/config.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono** — aggiungere in fondo a `config.test.ts` (seguire il pattern esistente del file per creare un config manager su file temporaneo; se il file usa helper tipo `tmpFile()`, riusarli):

```typescript
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
```
Nota: se `config.test.ts` non ha già un helper per il path temporaneo, definire in cima ai nuovi describe:
```typescript
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
function tmpConfigPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'mpb-')), 'config.json')
}
```

- [ ] **Step 2: Run per verificare il fallimento**

Run: `npx vitest run src/main/config.test.ts`
Expected: FAIL — `role` undefined / errore di tipo.

- [ ] **Step 3: Implementare in `config.ts`**:

```typescript
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
```
Nel `DEFAULTS.printers[0]` aggiungere `role: 'fiscal',`.
Nel ramo legacy di `migrate()` aggiungere `role: 'fiscal',` all'oggetto `printer`.
In coda a `migrate()`, prima del `return`, normalizzare i ruoli mancanti:
```typescript
  const merged = { ...DEFAULTS, ...raw } as AppConfig
  merged.printers = merged.printers.map((p) => ({ role: 'fiscal' as PrinterRole, ...p }))
  return merged
```
(lo spread `...p` sovrascrive il default quando `role` è già presente).

- [ ] **Step 4: Run test**

Run: `npx vitest run src/main/config.test.ts`
Expected: PASS (nuovi e vecchi).

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts src/main/config.test.ts
git commit -m "feat: printer role + paper/template config with backward-compatible migration"
```

---

### Task 3: Server — `/printers` esteso e check capability su `/print`

**Files:**
- Modify: `src/main/server.ts`
- Test: `src/main/server.test.ts`

- [ ] **Step 1: Test che falliscono** — in `server.test.ts`, aggiornare prima `makeOpts` aggiungendo `role: 'fiscal' as const,` dentro `config` del printer mock (richiesto dal nuovo tipo). Poi aggiungere:

```typescript
describe('GET /printers (capabilities)', () => {
  it('includes role and capabilities', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'GET', url: '/printers' })
    const body = res.json()
    expect(body[0].role).toBe('fiscal')
    expect(body[0].capabilities).toContain('fiscal-receipt')
  })
})

describe('POST /print capability check', () => {
  it('returns 409 when target printer lacks fiscal-receipt', async () => {
    const driver = makeMockDriver({ capabilities: ['label'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST', url: '/print',
      payload: { items: [], discount: 0, payments: [] },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/non supporta|does not support/i)
  })
})
```

- [ ] **Step 2: Run** — `npx vitest run src/main/server.test.ts` → Expected: FAIL (role/capabilities mancanti nella risposta; /print risponde 200).

- [ ] **Step 3: Implementare in `server.ts`**:

Import: `import type { PrinterDriver, Capability } from './drivers/interface'`.

Helper sotto `resolvePrinter`:
```typescript
function capabilityError(printer: ManagedPrinter, cap: Capability) {
  return `La stampante '${printer.config.id}' non supporta l'operazione '${cap}'`
}

function resolveByCapability(
  printers: ManagedPrinter[],
  cap: Capability,
  id?: string
): { printer: ManagedPrinter } | { status: number; error: string } {
  if (id) {
    const p = printers.find((x) => x.config.id === id)
    if (!p) return { status: 404, error: `Printer not found: ${id}` }
    if (!p.driver.capabilities.includes(cap)) return { status: 409, error: capabilityError(p, cap) }
    return { printer: p }
  }
  const p = printers.find((x) => x.driver.capabilities.includes(cap))
  if (!p) return { status: 503, error: `Nessuna stampante con capability '${cap}' configurata` }
  return { printer: p }
}
```

In `GET /printers`, aggiungere alle proprietà restituite:
```typescript
        role: p.config.role,
        capabilities: p.driver.capabilities,
```

In `POST /print`, dopo la risoluzione del printer e prima del `try`:
```typescript
      if (!printer.driver.capabilities.includes('fiscal-receipt')) {
        reply.status(409)
        return { success: false, error: capabilityError(printer, 'fiscal-receipt') }
      }
```
e cambiare la chiamata in `printer.driver.printReceipt!(...)` (il metodo ora è opzionale sul tipo). Stesso trattamento per `/daily-close` (`'daily-close'`, `dailyClose!`) e `/open-drawer` (`'drawer'`, `openDrawer!`).

- [ ] **Step 4: Run** — `npx vitest run src/main/server.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/server.ts src/main/server.test.ts
git commit -m "feat: expose role+capabilities in /printers, enforce capability on fiscal routes"
```

---

### Task 4: Server — `POST /print-nonfiscal`

**Files:**
- Modify: `src/main/server.ts`
- Test: `src/main/server.test.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
describe('POST /print-nonfiscal', () => {
  const payload = {
    lines: [
      { text: 'PRECONTO', bold: true, size: 'double', align: 'center' },
      { text: 'TOTALE 13,00', align: 'right' },
    ],
    cut: true,
  }

  it('routes to printNonFiscal with doc', async () => {
    const driver = makeMockDriver({
      printNonFiscal: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(200)
    const arg = (driver.printNonFiscal as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.lines[0].text).toBe('PRECONTO')
    expect(arg.cut).toBe(true)
  })

  it('falls back to first printer WITH the capability when printerId omitted', async () => {
    const fiscalOnly = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const nf = vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' })
    const receiptDriver = makeMockDriver({ capabilities: ['non-fiscal'], printNonFiscal: nf })
    const app = buildServer({
      getPrinters: () => [
        { config: { id: 'fiscale', label: 'F', role: 'fiscal', driver: 'mock', connection: { ip: '0', port: 0, timeout: 0 }, operatorId: '1', deptMapping: {} }, driver: fiscalOnly },
        { config: { id: 'comande', label: 'C', role: 'receipt', driver: 'mock', connection: { ip: '0', port: 0, timeout: 0 }, operatorId: '1', deptMapping: {} }, driver: receiptDriver },
      ],
      version: '1.0.0',
    })
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(200)
    expect(nf).toHaveBeenCalled()
  })

  it('returns 409 for explicit printerId without capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload: { ...payload, printerId: 'fiscal' } })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for unknown printerId', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload: { ...payload, printerId: 'nope' } })
    expect(res.statusCode).toBe(404)
  })

  it('returns 500 on driver error', async () => {
    const driver = makeMockDriver({ printNonFiscal: vi.fn().mockRejectedValue(new Error('Paper out')) })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-nonfiscal', payload })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('Paper out')
  })
})
```
Aggiungere al `makeMockDriver` di default (Task 1) anche:
```typescript
    printNonFiscal: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
    printLabel: vi.fn().mockResolvedValue({ success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }),
```

- [ ] **Step 2: Run** — `npx vitest run src/main/server.test.ts` → Expected: FAIL 404 (rotta inesistente).

- [ ] **Step 3: Implementare la rotta** in `buildServer`, dopo `/print`:

```typescript
  app.post<{ Body: { lines: import('./drivers/interface').NonFiscalLine[]; cut?: boolean; printerId?: string } }>(
    '/print-nonfiscal',
    async (req, reply) => {
      const resolved = resolveByCapability(getPrinters(), 'non-fiscal', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      try {
        return await resolved.printer.driver.printNonFiscal!({
          lines: req.body.lines ?? [],
          cut: req.body.cut ?? false,
        })
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )
```
(Preferire un import top-level `import type { NonFiscalLine } from './drivers/interface'` al posto dell'inline.)

- [ ] **Step 4: Run** — PASS. **Step 5: Commit**

```bash
git add src/main/server.ts src/main/server.test.ts
git commit -m "feat: POST /print-nonfiscal with capability-aware printer resolution"
```

---

### Task 5: Server — `POST /print-label` con `copies`

**Files:**
- Modify: `src/main/server.ts`
- Test: `src/main/server.test.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
describe('POST /print-label', () => {
  const payload = {
    label: { name: 'T-shirt', variant: 'M / Nero', price: 19.9, sku: 'TSH-M', barcode: '8001234567897' },
  }

  it('calls printLabel with label and layout from config', async () => {
    const driver = makeMockDriver()
    const opts = makeOpts(driver)
    const printers = opts.getPrinters()
    printers[0].config.paper = { widthMm: 62, heightMm: 29 }
    printers[0].config.template = { preset: 'product-price', showBarcode: true, fontScale: 1 }
    const app = buildServer({ ...opts, getPrinters: () => printers })
    const res = await app.inject({ method: 'POST', url: '/print-label', payload })
    expect(res.statusCode).toBe(200)
    const [labelArg, layoutArg] = (driver.printLabel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(labelArg.name).toBe('T-shirt')
    expect(layoutArg.paper.widthMm).toBe(62)
    expect(layoutArg.template.showBarcode).toBe(true)
  })

  it('uses defaults when paper/template missing from config', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    await app.inject({ method: 'POST', url: '/print-label', payload })
    const [, layoutArg] = (driver.printLabel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(layoutArg.paper.widthMm).toBeGreaterThan(0)
    expect(layoutArg.template.preset).toBe('product-price')
  })

  it('prints N copies', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-label', payload: { ...payload, copies: 3 } })
    expect(res.statusCode).toBe(200)
    expect((driver.printLabel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
  })

  it('returns 503 when no printer has label capability', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-label', payload })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when label.name or price missing', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-label', payload: { label: { name: 'X' } } })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run** — FAIL 404.

- [ ] **Step 3: Implementare.** I default vivono nel renderer (Task 7), ma per non creare dipendenza circolare il server li definisce qui finché il renderer non esiste — al Task 7 si sostituiscono con l'import. Per evitare doppioni: definirli SUBITO in un nuovo file `src/main/printing/defaults.ts`:

```typescript
// src/main/printing/defaults.ts
import type { PaperConfig, LabelTemplate, LabelData } from '../drivers/interface'

export const DEFAULT_LABEL_PAPER: PaperConfig = {
  widthMm: 50,
  heightMm: 30,
  orientation: 'portrait',
  marginsMm: { top: 1, right: 2, bottom: 1, left: 2 },
}

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  preset: 'product-price',
  showBarcode: true,
  fontScale: 1,
}

export const SAMPLE_LABEL: LabelData = {
  name: 'Prodotto di prova',
  variant: 'Variante M',
  price: 19.9,
  sku: 'SKU-TEST-01',
  barcode: '8001234567897',
}
```

Rotta in `server.ts`:
```typescript
import type { NonFiscalLine, LabelData } from './drivers/interface'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './printing/defaults'

  app.post<{ Body: { label: LabelData; copies?: number; printerId?: string } }>(
    '/print-label',
    async (req, reply) => {
      const { label } = req.body
      if (!label || typeof label.name !== 'string' || typeof label.price !== 'number') {
        reply.status(400)
        return { success: false, error: 'label.name (string) e label.price (number) sono obbligatori' }
      }
      const resolved = resolveByCapability(getPrinters(), 'label', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      const pc = resolved.printer.config
      const layout = {
        paper: pc.paper ?? DEFAULT_LABEL_PAPER,
        template: pc.template ?? DEFAULT_LABEL_TEMPLATE,
      }
      const copies = Math.max(1, Math.min(50, Math.trunc(req.body.copies ?? 1)))
      try {
        let last: import('./drivers/interface').PrintResult | null = null
        for (let i = 0; i < copies; i++) {
          last = await resolved.printer.driver.printLabel!(label, layout)
          if (!last.success) break
        }
        return last
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )
```

- [ ] **Step 4: Run** — `npx vitest run src/main/server.test.ts` → PASS. **Step 5: Commit**

```bash
git add src/main/server.ts src/main/server.test.ts src/main/printing/defaults.ts
git commit -m "feat: POST /print-label with copies and layout defaults"
```

---

### Task 6: Barcode EAN-13 → SVG

**Files:**
- Create: `src/main/printing/barcode.ts`
- Test: `src/main/printing/barcode.test.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/printing/barcode.test.ts
import { describe, it, expect } from 'vitest'
import { ean13Checksum, normalizeEan13, ean13Svg } from './barcode'

describe('ean13Checksum', () => {
  it('computes the check digit', () => {
    expect(ean13Checksum('800123456789')).toBe(7)
    expect(ean13Checksum('400638133393')).toBe(1)
  })
})

describe('normalizeEan13', () => {
  it('appends checksum to 12 digits', () => {
    expect(normalizeEan13('800123456789')).toBe('8001234567897')
  })
  it('accepts a valid 13-digit code', () => {
    expect(normalizeEan13('8001234567897')).toBe('8001234567897')
  })
  it('throws on invalid checksum', () => {
    expect(() => normalizeEan13('8001234567890')).toThrow(/checksum/i)
  })
  it('throws on non-numeric or wrong length', () => {
    expect(() => normalizeEan13('ABC')).toThrow(/EAN-13/i)
    expect(() => normalizeEan13('123')).toThrow(/EAN-13/i)
  })
})

describe('ean13Svg', () => {
  it('returns an svg with 95-module bar pattern and human-readable text', () => {
    const svg = ean13Svg('8001234567897')
    expect(svg).toContain('<svg')
    expect(svg).toContain('8001234567897')
    // I tre guard pattern (101) producono rect; almeno 30 barre totali
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(25)
  })
})
```

- [ ] **Step 2: Run** — `npx vitest run src/main/printing/barcode.test.ts` → FAIL (modulo inesistente).

- [ ] **Step 3: Implementare `barcode.ts`**:

```typescript
// src/main/printing/barcode.ts
// EAN-13 → SVG. Tabelle standard GS1 (L/G/R + parità della prima cifra).

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

export function ean13Checksum(digits12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

export function normalizeEan13(code: string): string {
  if (/^\d{12}$/.test(code)) return code + String(ean13Checksum(code))
  if (/^\d{13}$/.test(code)) {
    if (Number(code[12]) !== ean13Checksum(code.slice(0, 12))) {
      throw new Error(`Barcode EAN-13 con checksum non valido: ${code}`)
    }
    return code
  }
  throw new Error(`Barcode non valido: atteso EAN-13 (12/13 cifre), ricevuto "${code}"`)
}

function modules(code13: string): string {
  const first = Number(code13[0])
  const parity = PARITY[first]
  let bits = '101'
  for (let i = 1; i <= 6; i++) {
    const d = Number(code13[i])
    bits += parity[i - 1] === 'L' ? L[d] : G[d]
  }
  bits += '01010'
  for (let i = 7; i <= 12; i++) {
    bits += R[Number(code13[i])]
  }
  return bits + '101' // 95 moduli totali
}

export interface Ean13SvgOptions {
  heightMm?: number     // altezza barre
  moduleMm?: number     // larghezza di un modulo
  fontMm?: number       // altezza testo leggibile
}

export function ean13Svg(code: string, opts: Ean13SvgOptions = {}): string {
  const code13 = normalizeEan13(code)
  const moduleMm = opts.moduleMm ?? 0.33
  const heightMm = opts.heightMm ?? 10
  const fontMm = opts.fontMm ?? 2.2
  const quiet = 7 * moduleMm
  const bits = modules(code13)
  const widthMm = 95 * moduleMm + 2 * quiet
  const totalH = heightMm + fontMm + 0.8

  const rects: string[] = []
  let run = 0
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') {
      run++
      continue
    }
    if (run > 0) {
      const x = quiet + (i - run) * moduleMm
      rects.push(`<rect x="${x.toFixed(3)}" y="0" width="${(run * moduleMm).toFixed(3)}" height="${heightMm}" fill="#000"/>`)
      run = 0
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${totalH.toFixed(2)}mm" ` +
    `viewBox="0 0 ${widthMm.toFixed(3)} ${totalH.toFixed(3)}">` +
    rects.join('') +
    `<text x="${(widthMm / 2).toFixed(3)}" y="${(heightMm + fontMm).toFixed(3)}" ` +
    `font-family="monospace" font-size="${fontMm}" text-anchor="middle">${code13}</text>` +
    `</svg>`
  )
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit**

```bash
git add src/main/printing/barcode.ts src/main/printing/barcode.test.ts
git commit -m "feat: EAN-13 SVG generator with checksum validation"
```

---

### Task 7: Label renderer (HTML)

**Files:**
- Create: `src/main/printing/label-renderer.ts`
- Test: `src/main/printing/label-renderer.test.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/printing/label-renderer.test.ts
import { describe, it, expect } from 'vitest'
import { renderLabelHtml, renderNonFiscalHtml } from './label-renderer'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './defaults'

const layout = { paper: DEFAULT_LABEL_PAPER, template: DEFAULT_LABEL_TEMPLATE }

describe('renderLabelHtml', () => {
  it('renders name, variant, price, sku and barcode svg', () => {
    const html = renderLabelHtml(
      { name: 'T-shirt', variant: 'M / Nero', price: 19.9, sku: 'TSH-M', barcode: '8001234567897' },
      layout
    )
    expect(html).toContain('T-shirt')
    expect(html).toContain('M / Nero')
    expect(html).toContain('19,90')
    expect(html).toContain('TSH-M')
    expect(html).toContain('<svg')
    expect(html).toContain('@page')
  })

  it('omits missing optional fields without leaving empty blocks', () => {
    const html = renderLabelHtml({ name: 'X', price: 5 }, layout)
    expect(html).not.toContain('class="variant"')
    expect(html).not.toContain('class="sku"')
    expect(html).not.toContain('<svg')
  })

  it('escapes HTML in user data', () => {
    const html = renderLabelHtml({ name: '<b>x</b>', price: 1 }, layout)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('hides barcode when template.showBarcode is false', () => {
    const html = renderLabelHtml(
      { name: 'X', price: 1, barcode: '8001234567897' },
      { ...layout, template: { ...DEFAULT_LABEL_TEMPLATE, showBarcode: false } }
    )
    expect(html).not.toContain('<svg')
  })
})

describe('renderNonFiscalHtml', () => {
  it('renders lines with style attributes', () => {
    const html = renderNonFiscalHtml(
      { lines: [{ text: 'PRECONTO', bold: true, size: 'double', align: 'center' }, { text: 'riga' }] },
      80
    )
    expect(html).toContain('PRECONTO')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('text-align:center')
  })
})
```

- [ ] **Step 2: Run** — FAIL (modulo inesistente).

- [ ] **Step 3: Implementare `label-renderer.ts`**:

```typescript
// src/main/printing/label-renderer.ts
// Unico punto di verità per l'aspetto di etichette e documenti non fiscali.
// Output HTML autocontenuto (misure in mm, barcode SVG inline, nessuna risorsa esterna):
// - os-printer lo stampa direttamente (silent print)
// - escpos-network lo rasterizza a bitmap (html-to-bitmap.ts)
import type { LabelData, LabelLayout, NonFiscalDoc } from '../drivers/interface'
import { ean13Svg } from './barcode'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function eurIt(n: number): string {
  return `€ ${n.toFixed(2).replace('.', ',')}`
}

export function renderLabelHtml(label: LabelData, layout: LabelLayout): string {
  const { paper, template } = layout
  const m = paper.marginsMm ?? { top: 1, right: 2, bottom: 1, left: 2 }
  const w = paper.widthMm
  const h = paper.heightMm ?? 30
  const fs = template.fontScale || 1
  const innerW = w - m.left - m.right
  const innerH = h - m.top - m.bottom

  const barcodeSvg =
    template.showBarcode && label.barcode
      ? ean13Svg(label.barcode, { heightMm: Math.min(10, innerH * 0.35), moduleMm: 0.33 })
      : ''

  const parts: string[] = []
  parts.push(`<div class="name">${esc(label.name)}</div>`)
  if (label.variant) parts.push(`<div class="variant">${esc(label.variant)}</div>`)
  parts.push(`<div class="row"><span class="price">${eurIt(label.price)}</span>` +
    (label.sku ? `<span class="sku">${esc(label.sku)}</span>` : '') + `</div>`)
  if (barcodeSvg) parts.push(`<div class="barcode">${barcodeSvg}</div>`)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${w}mm ${h}mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${w}mm; height: ${h}mm; }
body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #000;
  padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; overflow: hidden; }
.inner { width: ${innerW}mm; height: ${innerH}mm; display: flex; flex-direction: column; }
.name { font-size: ${(3.2 * fs).toFixed(2)}mm; font-weight: 700; line-height: 1.15;
  overflow: hidden; }
.variant { font-size: ${(2.6 * fs).toFixed(2)}mm; }
.row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.5mm; }
.price { font-size: ${(4.2 * fs).toFixed(2)}mm; font-weight: 700; }
.sku { font-size: ${(2.2 * fs).toFixed(2)}mm; font-family: monospace; }
.barcode { margin-top: auto; text-align: center; }
.barcode svg { max-width: ${innerW}mm; }
</style></head><body><div class="inner">${parts.join('')}</div></body></html>`
}

export function renderNonFiscalHtml(doc: NonFiscalDoc, widthMm: number): string {
  const rows = doc.lines
    .map((l) => {
      const styles = [
        `text-align:${l.align ?? 'left'}`,
        l.bold ? 'font-weight:bold' : '',
        l.size === 'double' ? 'font-size:6mm' : 'font-size:3mm',
      ].filter(Boolean).join(';')
      return `<div style="${styles}">${esc(l.text) || '&nbsp;'}</div>`
    })
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${widthMm}mm auto; margin: 0; }
* { margin: 0; padding: 0; }
body { width: ${widthMm}mm; font-family: monospace; color: #000; padding: 2mm; white-space: pre-wrap; }
</style></head><body>${rows}</body></html>`
}
```

- [ ] **Step 4: Run** — `npx vitest run src/main/printing/label-renderer.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/printing/label-renderer.ts src/main/printing/label-renderer.test.ts
git commit -m "feat: HTML label/non-fiscal renderer (single source of truth for layout)"
```

---

### Task 8: Encoder ESC/POS

**Files:**
- Create: `src/main/printing/escpos-encoder.ts`
- Test: `src/main/printing/escpos-encoder.test.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/printing/escpos-encoder.test.ts
import { describe, it, expect } from 'vitest'
import { encodeCp858, encodeNonFiscal, encodeRaster } from './escpos-encoder'

describe('encodeCp858', () => {
  it('passes through ASCII and maps Italian accents and euro', () => {
    expect([...encodeCp858('Abc')]).toEqual([0x41, 0x62, 0x63])
    expect([...encodeCp858('è')]).toEqual([0x8a])
    expect([...encodeCp858('€')]).toEqual([0xd5])
    expect([...encodeCp858('☃')]).toEqual([0x3f]) // fallback '?'
  })
})

describe('encodeNonFiscal', () => {
  it('emits init, codepage, per-line styling, feed and cut', () => {
    const buf = encodeNonFiscal({
      lines: [{ text: 'HI', bold: true, size: 'double', align: 'center' }],
      cut: true,
    })
    const bytes = [...buf]
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40])          // ESC @
    expect(bytes.slice(2, 5)).toEqual([0x1b, 0x74, 19])      // ESC t 19 → CP858
    expect(buf.includes(Buffer.from([0x1b, 0x61, 1]))).toBe(true)   // center
    expect(buf.includes(Buffer.from([0x1b, 0x45, 1]))).toBe(true)   // bold on
    expect(buf.includes(Buffer.from([0x1d, 0x21, 0x11]))).toBe(true) // double w+h
    expect(buf.includes(Buffer.from('HI'))).toBe(true)
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]) // GS V partial cut
  })

  it('omits cut when cut=false', () => {
    const buf = encodeNonFiscal({ lines: [{ text: 'X' }], cut: false })
    expect(buf.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))).toBe(false)
  })
})

describe('encodeRaster', () => {
  it('builds GS v 0 header from bitmap dims', () => {
    // 16px wide (2 byte/row), 2 righe
    const data = new Uint8Array([0xff, 0x00, 0x00, 0xff])
    const buf = encodeRaster({ widthPx: 16, heightPx: 2, data })
    expect([...buf.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0])
    expect([...buf.slice(8)]).toEqual([0xff, 0x00, 0x00, 0xff])
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementare**:

```typescript
// src/main/printing/escpos-encoder.ts
// Encoder ESC/POS standard (Epson TM e compatibili). CP858 per i caratteri italiani + €.
import type { NonFiscalDoc } from '../drivers/interface'

const ESC = 0x1b
const GS = 0x1d

const CP858: Record<string, number> = {
  'à': 0x85, 'è': 0x8a, 'é': 0x82, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97,
  'À': 0xb7, 'È': 0xd4, 'É': 0x90, 'Ì': 0xde, 'Ò': 0xe3, 'Ù': 0xeb,
  '°': 0xf8, '€': 0xd5, 'ç': 0x87, 'ü': 0x81, 'ö': 0x94, 'ä': 0x84,
}

export function encodeCp858(s: string): Buffer {
  const bytes: number[] = []
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) bytes.push(code)
    else bytes.push(CP858[ch] ?? 0x3f)
  }
  return Buffer.from(bytes)
}

export function encodeNonFiscal(doc: NonFiscalDoc): Buffer {
  const parts: Buffer[] = [
    Buffer.from([ESC, 0x40]),      // init
    Buffer.from([ESC, 0x74, 19]),  // select codepage CP858
  ]
  for (const line of doc.lines) {
    const align = line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0
    parts.push(Buffer.from([ESC, 0x61, align]))
    parts.push(Buffer.from([ESC, 0x45, line.bold ? 1 : 0]))
    parts.push(Buffer.from([GS, 0x21, line.size === 'double' ? 0x11 : 0x00]))
    parts.push(encodeCp858(line.text))
    parts.push(Buffer.from([0x0a]))
  }
  parts.push(Buffer.from([ESC, 0x64, 4])) // feed 4 righe prima del taglio/strappo
  if (doc.cut) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00])) // partial cut con feed
  return Buffer.concat(parts)
}

// Bitmap monocromatica row-major, bit MSB-first, rowBytes = ceil(widthPx/8). 1 = nero.
export interface MonoBitmap {
  widthPx: number
  heightPx: number
  data: Uint8Array
}

export function encodeRaster(bmp: MonoBitmap): Buffer {
  const rowBytes = Math.ceil(bmp.widthPx / 8)
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, bmp.heightPx & 0xff, bmp.heightPx >> 8]),
    Buffer.from(bmp.data),
  ])
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit**

```bash
git add src/main/printing/escpos-encoder.ts src/main/printing/escpos-encoder.test.ts
git commit -m "feat: ESC/POS encoder — styled text (CP858), feed/cut, GS v 0 raster"
```

---

### Task 9: Driver `escpos-network` completo

**Files:**
- Rewrite: `src/main/drivers/escpos-network.ts`
- Test: `src/main/drivers/escpos-network.test.ts`

Le dipendenze Electron (rasterizzazione HTML) e di rete sono iniettabili per i test; i default reali arrivano nel Task 10 (`html-to-bitmap.ts`) — qui il default rasterizer è un lazy-import, quindi il driver compila anche prima del Task 10 (il file viene creato lì; fino ad allora i test usano il mock).

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/drivers/escpos-network.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EscPosNetworkDriver } from './escpos-network'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from '../printing/defaults'

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

  it('printLabel rasterizes at 8 dots/mm of paper width and sends raster + cut', async () => {
    const { driver, deps, sent } = makeDriver()
    await driver.connect(cfg)
    const res = await driver.printLabel(
      { name: 'X', price: 1 },
      { paper: { widthMm: 80 }, template: DEFAULT_LABEL_TEMPLATE }
    )
    expect(res.success).toBe(true)
    expect(deps.rasterize).toHaveBeenCalledWith(expect.stringContaining('<svg') /* o html */, 640)
    expect(sent[0].includes(Buffer.from([0x1d, 0x76, 0x30, 0x00]))).toBe(true)
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
})
```
Nota sul primo `expect` di `printLabel`: l'HTML dell'etichetta con barcode contiene `<svg`; se il label di test non ha barcode usare `expect.any(String)` — qui `{name:'X', price:1}` NON ha barcode, quindi usare:
```typescript
    expect(deps.rasterize).toHaveBeenCalledWith(expect.any(String), 640)
```

- [ ] **Step 2: Run** — FAIL (costruttore/metodi inesistenti).

- [ ] **Step 3: Riscrivere `escpos-network.ts`**:

```typescript
// src/main/drivers/escpos-network.ts
// Driver ESC/POS raw TCP (porta tipica 9100) per stampantine 58/80mm.
// Etichette: HTML → bitmap (203dpi ≈ 8 dot/mm) → GS v 0.
import { createConnection } from 'node:net'
import type {
  PrinterDriver, DriverConfig, PrinterStatus, ReceiptData, PrintResult,
  NonFiscalDoc, LabelData, LabelLayout, Capability,
} from './interface'
import { encodeNonFiscal, encodeRaster, type MonoBitmap } from '../printing/escpos-encoder'
import { renderLabelHtml } from '../printing/label-renderer'

const DOTS_PER_MM = 8 // 203 dpi

export interface EscPosDeps {
  send(host: string, port: number, timeout: number, data: Buffer): Promise<void>
  rasterize(html: string, widthPx: number): Promise<MonoBitmap>
}

async function sendTcp(host: string, port: number, timeout: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Printer timeout'))
    }, timeout)
    socket.on('connect', () => {
      socket.end(data, () => {
        clearTimeout(timer)
        resolve()
      })
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function defaultRasterize(html: string, widthPx: number): Promise<MonoBitmap> {
  // Lazy import: html-to-bitmap richiede Electron a runtime (BrowserWindow offscreen)
  const { htmlToMonoBitmap } = await import('../printing/html-to-bitmap')
  return htmlToMonoBitmap(html, widthPx)
}

const OK: PrintResult = { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }

function fail(err: unknown): PrintResult {
  return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '',
    errorMessage: err instanceof Error ? err.message : 'Unknown error' }
}

export class EscPosNetworkDriver implements PrinterDriver {
  readonly name = 'escpos-network'
  readonly capabilities: Capability[] = ['non-fiscal', 'label', 'cut']
  private cfg: DriverConfig | null = null
  private deps: EscPosDeps

  constructor(deps?: Partial<EscPosDeps>) {
    this.deps = { send: deps?.send ?? sendTcp, rasterize: deps?.rasterize ?? defaultRasterize }
  }

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  private requireCfg(): DriverConfig {
    if (!this.cfg) throw new Error('escpos-network: not connected')
    return this.cfg
  }

  async getStatus(): Promise<PrinterStatus> {
    if (!this.cfg)
      return { online: false, paperPresent: false, coverClosed: false, errorMessage: 'Not connected' }
    return new Promise((resolve) => {
      const cfg = this.cfg!
      const socket = createConnection({ host: cfg.ip, port: cfg.port })
      const timer = setTimeout(() => {
        socket.destroy()
        resolve({ online: false, paperPresent: false, coverClosed: false, errorMessage: 'Timeout' })
      }, Math.min(cfg.timeout, 3000))
      socket.on('connect', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve({ online: true, paperPresent: true, coverClosed: true, errorMessage: '' })
      })
      socket.on('error', (err) => {
        clearTimeout(timer)
        resolve({ online: false, paperPresent: false, coverClosed: false, errorMessage: err.message })
      })
    })
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const cfg = this.requireCfg()
    try {
      await this.deps.send(cfg.ip, cfg.port, cfg.timeout, encodeNonFiscal(doc))
      return { ...OK }
    } catch (err: unknown) {
      return fail(err)
    }
  }

  async printLabel(label: LabelData, layout: LabelLayout): Promise<PrintResult> {
    const cfg = this.requireCfg()
    try {
      const widthPx = Math.round(layout.paper.widthMm * DOTS_PER_MM)
      const html = renderLabelHtml(label, layout)
      const bitmap = await this.deps.rasterize(html, widthPx)
      const payload = Buffer.concat([
        Buffer.from([0x1b, 0x40]),            // init
        Buffer.from([0x1b, 0x61, 0x01]),      // center
        encodeRaster(bitmap),
        Buffer.from([0x1b, 0x64, 0x04]),      // feed
        Buffer.from([0x1d, 0x56, 0x42, 0x00]) // partial cut
      ])
      await this.deps.send(cfg.ip, cfg.port, cfg.timeout, payload)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err)
    }
  }

  async printReceipt(_data: ReceiptData): Promise<PrintResult> {
    throw new Error('escpos-network: scontrino fiscale non supportato (usa /print-nonfiscal)')
  }
}
```
Rimuovere `dailyClose`/`openDrawer` (ora opzionali; questo driver non li dichiara). Rimuovere anche `printReceipt`? No: lasciare il metodo che lancia errore esplicito è innocuo ma NON dichiarare `fiscal-receipt` nelle capabilities — il server bloccherà prima con 409. In alternativa eliminarlo del tutto: scegliere l'eliminazione (più pulito), il server protegge con il 409.

- [ ] **Step 4: Run** — `npx vitest run src/main/drivers/escpos-network.test.ts && npm test` → PASS tutti.
- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/escpos-network.ts src/main/drivers/escpos-network.test.ts
git commit -m "feat: full escpos-network driver — non-fiscal text, raster labels, cut"
```

---

### Task 10: Moduli Electron — `silent-print.ts` e `html-to-bitmap.ts`

**Files:**
- Create: `src/main/printing/silent-print.ts`
- Create: `src/main/printing/html-to-bitmap.ts`

Questi due moduli toccano `BrowserWindow` → niente unit test (vitest gira in node puro); la verifica è manuale nel Task 18. Tenerli minimi.

- [ ] **Step 1: Creare `silent-print.ts`**:

```typescript
// src/main/printing/silent-print.ts
// Stampa silenziosa via driver di sistema (CUPS su macOS/Linux, spooler su Windows).
import { BrowserWindow } from 'electron'

export interface SilentPrintOptions {
  deviceName: string
  widthMm: number
  heightMm: number
  landscape?: boolean
}

let workerWin: BrowserWindow | null = null

function getWorker(): BrowserWindow {
  if (!workerWin || workerWin.isDestroyed()) {
    workerWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  }
  return workerWin
}

export async function listSystemPrinters(): Promise<string[]> {
  const printers = await getWorker().webContents.getPrintersAsync()
  return printers.map((p) => p.name)
}

function toDataUrl(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

export async function printHtml(html: string, opts: SilentPrintOptions): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(toDataUrl(html))
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          deviceName: opts.deviceName,
          printBackground: true,
          landscape: opts.landscape ?? false,
          margins: { marginType: 'none' }, // i margini sono nel CSS dell'HTML
          // pageSize in micron
          pageSize: { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) },
        },
        (ok, failureReason) => (ok ? resolve() : reject(new Error(failureReason || 'Stampa fallita')))
      )
    })
  } finally {
    win.destroy()
  }
}
```

- [ ] **Step 2: Creare `html-to-bitmap.ts`**:

```typescript
// src/main/printing/html-to-bitmap.ts
// HTML → bitmap monocromatica per il raster ESC/POS.
// La finestra offscreen renderizza a 96dpi CSS; la testina è a 203dpi,
// quindi zoomFactor = 203/96 per ottenere 8 dot/mm reali.
import { BrowserWindow } from 'electron'
import type { MonoBitmap } from './escpos-encoder'

const ZOOM = 203 / 96

export async function htmlToMonoBitmap(html: string, widthPx: number): Promise<MonoBitmap> {
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 64,
    webPreferences: { offscreen: true, sandbox: true },
  })
  try {
    win.webContents.setZoomFactor(ZOOM)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const contentHeight: number = await win.webContents.executeJavaScript(
      'Math.ceil(document.body.getBoundingClientRect().height * window.devicePixelRatio) || 64'
    )
    const heightPx = Math.max(8, Math.min(4096, Math.ceil(contentHeight * ZOOM)))
    win.setContentSize(Math.ceil(widthPx / ZOOM), Math.ceil(heightPx / ZOOM))
    // attesa di un frame di repaint offscreen
    await new Promise((r) => setTimeout(r, 120))
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    const bgra = image.getBitmap() // BGRA, size.width * size.height * 4

    const outW = Math.min(widthPx, size.width)
    const outH = size.height
    const rowBytes = Math.ceil(outW / 8)
    const data = new Uint8Array(rowBytes * outH)
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = (y * size.width + x) * 4
        // luminanza approssimata; alpha 0 (trasparente) = bianco
        const lum = bgra[i + 3] === 0 ? 255 : 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2]
        if (lum < 160) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
    return { widthPx: outW, heightPx: outH, data }
  } finally {
    win.destroy()
  }
}
```

- [ ] **Step 3: Verificare compilazione** — Run: `npx tsc --noEmit -p tsconfig.node.json && npm run build`
Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add src/main/printing/silent-print.ts src/main/printing/html-to-bitmap.ts
git commit -m "feat: Electron silent printing + offscreen HTML→mono bitmap rasterizer"
```

---

### Task 11: Driver `os-printer`

**Files:**
- Create: `src/main/drivers/os-printer.ts`
- Test: `src/main/drivers/os-printer.test.ts`
- Modify: `src/main/drivers/registry.ts`

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/drivers/os-printer.test.ts
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
    expect(opts).toMatchObject({ deviceName: 'Brother QL-800', widthMm: 62, heightMm: 29, landscape: true })
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
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementare `os-printer.ts`**:

```typescript
// src/main/drivers/os-printer.ts
// Stampa su qualunque stampante installata nel sistema (Windows spooler / macOS-Linux CUPS).
// Silenziosa: nessun dialogo, geometria carta da config.
import type {
  PrinterDriver, DriverConfig, PrinterStatus, PrintResult,
  NonFiscalDoc, LabelData, LabelLayout, Capability,
} from './interface'
import { renderLabelHtml, renderNonFiscalHtml } from '../printing/label-renderer'
import type { SilentPrintOptions } from '../printing/silent-print'

export interface OsPrinterDeps {
  listPrinters(): Promise<string[]>
  printHtml(html: string, opts: SilentPrintOptions): Promise<void>
}

async function defaultDeps(): Promise<OsPrinterDeps> {
  const mod = await import('../printing/silent-print')
  return { listPrinters: mod.listSystemPrinters, printHtml: mod.printHtml }
}

const OK: PrintResult = { success: true, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: '' }

function fail(msg: string): PrintResult {
  return { success: false, receiptNumber: '', closureNumber: '', printerSerial: '', errorMessage: msg }
}

export class OsPrinterDriver implements PrinterDriver {
  readonly name = 'os-printer'
  readonly capabilities: Capability[] = ['label', 'non-fiscal']
  private cfg: DriverConfig | null = null
  private depsOverride: OsPrinterDeps | null = null

  constructor(deps?: OsPrinterDeps) {
    this.depsOverride = deps ?? null
  }

  private async deps(): Promise<OsPrinterDeps> {
    return this.depsOverride ?? (await defaultDeps())
  }

  async connect(config: DriverConfig): Promise<void> {
    this.cfg = config
  }

  async disconnect(): Promise<void> {
    this.cfg = null
  }

  async getStatus(): Promise<PrinterStatus> {
    const device = this.cfg?.deviceName
    if (!device)
      return { online: false, paperPresent: false, coverClosed: false, errorMessage: 'Nessuna stampante di sistema selezionata' }
    try {
      const names = await (await this.deps()).listPrinters()
      const online = names.includes(device)
      return {
        online,
        paperPresent: online,
        coverClosed: online,
        errorMessage: online ? '' : `Stampante di sistema non trovata: ${device}`,
      }
    } catch (err: unknown) {
      return { online: false, paperPresent: false, coverClosed: false,
        errorMessage: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  private printOpts(widthMm: number, heightMm: number, landscape: boolean): SilentPrintOptions | null {
    const device = this.cfg?.deviceName
    if (!device) return null
    return { deviceName: device, widthMm, heightMm, landscape }
  }

  async printLabel(label: LabelData, layout: LabelLayout): Promise<PrintResult> {
    const opts = this.printOpts(
      layout.paper.widthMm,
      layout.paper.heightMm ?? 30,
      layout.paper.orientation === 'landscape'
    )
    if (!opts) return fail('os-printer: deviceName non configurato (seleziona la stampante di sistema)')
    try {
      await (await this.deps()).printHtml(renderLabelHtml(label, layout), opts)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const widthMm = this.cfg?.paper?.widthMm ?? 80
    // altezza stimata: 5mm a riga (+10mm di respiro); i driver roll-paper troncano il vuoto
    const heightMm = this.cfg?.paper?.heightMm ?? Math.max(30, doc.lines.length * 5 + 10)
    const opts = this.printOpts(widthMm, heightMm, false)
    if (!opts) return fail('os-printer: deviceName non configurato (seleziona la stampante di sistema)')
    try {
      await (await this.deps()).printHtml(renderNonFiscalHtml(doc, widthMm), opts)
      return { ...OK }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : 'Unknown error')
    }
  }
}
```

- [ ] **Step 4: Registrare nel registry** — in `registry.ts`:

```typescript
import { OsPrinterDriver } from './os-printer'
// ...
  'os-printer': () => new OsPrinterDriver(),
```

- [ ] **Step 5: Run** — `npx vitest run src/main/drivers/os-printer.test.ts && npm test` → PASS.
- [ ] **Step 6: Commit**

```bash
git add src/main/drivers/os-printer.ts src/main/drivers/os-printer.test.ts src/main/drivers/registry.ts
git commit -m "feat: os-printer driver — silent printing via system printer drivers"
```

---

### Task 12: `printNonFiscal` su Epson FP-Mate

**Files:**
- Modify: `src/main/drivers/epson-fpmate.ts`
- Test: `src/main/drivers/epson-fpmate.test.ts`

- [ ] **Step 1: Test che falliscono** — aggiungere in `epson-fpmate.test.ts` (seguendo lo stile dei test esistenti sul builder XML):

```typescript
describe('_buildNonFiscalXml', () => {
  it('wraps lines in printerNonFiscal block', () => {
    const d = new EpsonFpMateDriver()
    const xml = d._buildNonFiscalXml({
      lines: [
        { text: 'PRECONTO', bold: true },
        { text: 'riga & speciale' },
      ],
    })
    expect(xml).toContain('<printerNonFiscal>')
    expect(xml).toContain('<beginNonFiscal')
    expect(xml).toContain('data="PRECONTO"')
    expect(xml).toContain('font="2"') // bold
    expect(xml).toContain('riga &amp; speciale')
    expect(xml).toContain('<endNonFiscal')
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementare** in `epson-fpmate.ts`:

Aggiungere `'non-fiscal'` alle capabilities:
```typescript
  readonly capabilities: Capability[] = ['fiscal-receipt', 'non-fiscal', 'daily-close', 'drawer']
```
Importare `NonFiscalDoc` dai tipi. Aggiungere i metodi:

```typescript
  _buildNonFiscalXml(doc: NonFiscalDoc): string {
    const op = this.operatorId
    let xml = '<?xml version="1.0" encoding="utf-8"?>'
    xml += '<printerNonFiscal>'
    xml += `<beginNonFiscal operator="${op}" />`
    for (const line of doc.lines) {
      // font: 1 = normale, 2 = grassetto, 4 = doppia altezza (rif. manuale FP-Mate;
      // verificare la resa di font="4" sull'unità in campo)
      const font = line.size === 'double' ? '4' : line.bold ? '2' : '1'
      xml += `<printNormal operator="${op}" font="${font}" data="${escapeXml(line.text)}" />`
    }
    xml += `<endNonFiscal operator="${op}" />`
    xml += '</printerNonFiscal>'
    return xml
  }

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    const responseXml = await this.send(this._buildNonFiscalXml(doc))
    return this._parseResponse(responseXml)
  }
```
Nota: l'XML FP-Mate non gestisce `align` per `printNormal` — l'allineamento si ignora (limite documentato del protocollo). `cut`: la fiscale taglia da sé a `endNonFiscal`.

- [ ] **Step 4: Run** — `npx vitest run src/main/drivers/epson-fpmate.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/epson-fpmate.ts src/main/drivers/epson-fpmate.test.ts
git commit -m "feat: epson-fpmate printNonFiscal via native non-fiscal XML block"
```

---

### Task 13: `printNonFiscal` su Ditron StreamWEC

**Files:**
- Modify: `src/main/drivers/ditron-streamwec.ts`
- Test: `src/main/drivers/ditron-streamwec.test.ts` (nuovo)

**Contesto:** i pcap in repo sono TLS-cifrati e `ditron.html` è solo la tastiera virtuale del FCR Manager — i comandi WEC non fiscali NON sono confermabili da repo. Implementare con costanti isolate in testa al file (stesso pattern del `TENDER` esistente) e marcare per verifica on-site. Nei pcap compaiono le chiavi di configurazione `Ecr_ScontrinoCortesia`/`Ecr_MsgCortesia`: lo scontrino di cortesia esiste sul firmware, va scoperto il comando esatto dal FCR Manager o dal manuale WEC Ditron.

- [ ] **Step 1: Test che falliscono**:

```typescript
// src/main/drivers/ditron-streamwec.test.ts
import { describe, it, expect } from 'vitest'
import { buildNonFiscal } from './ditron-streamwec'

describe('buildNonFiscal', () => {
  it('opens, prints escaped lines, closes', () => {
    const cmd = buildNonFiscal({ lines: [{ text: "Po' di testo" }, { text: 'riga2' }] })
    const lines = cmd.trim().split('\n')
    expect(lines[0]).toBe('NFIS APRI')
    expect(lines[1]).toContain('Po  di testo') // apostrofo neutralizzato come nel fiscale
    expect(lines[2]).toContain('riga2')
    expect(lines[lines.length - 1]).toBe('NFIS CHIUDI')
  })

  it('truncates lines to 40 chars', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'x'.repeat(60) }] })
    expect(cmd).toContain(`'${'x'.repeat(40)}'`)
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementare** in `ditron-streamwec.ts`:

In testa al file, sotto `TENDER`:
```typescript
// Comandi non fiscali WEC — DA VERIFICARE ON-SITE (pcap in repo sono TLS-cifrati).
// Il firmware supporta lo scontrino di cortesia (chiavi Ecr_ScontrinoCortesia nel capture):
// confermare la sintassi esatta dal FCR Manager (http://<ip>) o dal manuale WEC Ditron
// e aggiornare queste tre costanti se diverse.
const NONFISCAL_OPEN = 'NFIS APRI'
const NONFISCAL_LINE = (text: string): string => `NFIS RIGA='${text}'`
const NONFISCAL_CLOSE = 'NFIS CHIUDI'

export function buildNonFiscal(doc: NonFiscalDoc): string {
  const lines: string[] = [NONFISCAL_OPEN]
  for (const l of doc.lines) {
    lines.push(NONFISCAL_LINE(l.text.slice(0, 40).replace(/'/g, ' ')))
  }
  lines.push(NONFISCAL_CLOSE)
  return lines.join('\n') + '\n'
}
```
(importare `NonFiscalDoc` nei tipi). Nella classe:
```typescript
  readonly capabilities: Capability[] = ['fiscal-receipt', 'non-fiscal', 'daily-close', 'drawer']

  async printNonFiscal(doc: NonFiscalDoc): Promise<PrintResult> {
    return parseResult(await this.request('POST', '/cmd/wec', buildNonFiscal(doc)))
  }
```
Nota: `bold`/`size`/`align` non mappabili su WEC testo → ignorati (il protocollo stampa testo piano). `parseResult` esistente gestisce già gli `ERRORE ...` di sintassi: se il comando è sbagliato on-site, l'errore arriva pulito al gestionale.

- [ ] **Step 4: Run** — `npx vitest run src/main/drivers/ditron-streamwec.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/ditron-streamwec.ts src/main/drivers/ditron-streamwec.test.ts
git commit -m "feat: ditron-streamwec printNonFiscal (WEC command constants pending on-site check)"
```

---

### Task 14: Probing carta per-OS (`paper-info.ts`)

**Files:**
- Create: `src/main/printing/paper-info.ts`
- Test: `src/main/printing/paper-info.test.ts`

- [ ] **Step 1: Test che falliscono** (solo i parser puri):

```typescript
// src/main/printing/paper-info.test.ts
import { describe, it, expect } from 'vitest'
import { parseLpoptionsPageSizes, paperNameToMm } from './paper-info'

describe('parseLpoptionsPageSizes', () => {
  it('extracts sizes and default (starred) from lpoptions -l output', () => {
    const out = [
      'PageSize/Media Size: *62x29mm 62x100mm A4 Custom.WIDTHxHEIGHT',
      'Resolution/Resolution: 300dpi',
    ].join('\n')
    const res = parseLpoptionsPageSizes(out)
    expect(res.papers).toEqual(['62x29mm', '62x100mm', 'A4', 'Custom.WIDTHxHEIGHT'])
    expect(res.defaultPaper).toBe('62x29mm')
  })

  it('returns empty when no PageSize line', () => {
    expect(parseLpoptionsPageSizes('Duplex/Duplex: None')).toEqual({ papers: [] })
  })
})

describe('paperNameToMm', () => {
  it('parses WxHmm CUPS names', () => {
    expect(paperNameToMm('62x29mm')).toEqual({ widthMm: 62, heightMm: 29 })
  })
  it('knows common names', () => {
    expect(paperNameToMm('A4')).toEqual({ widthMm: 210, heightMm: 297 })
    expect(paperNameToMm('Letter')).toEqual({ widthMm: 216, heightMm: 279 })
  })
  it('returns null for unknown names', () => {
    expect(paperNameToMm('Custom.WIDTHxHEIGHT')).toBeNull()
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementare**:

```typescript
// src/main/printing/paper-info.ts
// Probing dei formati carta del driver di sistema. Usato SOLO in fase di
// configurazione (precompila il form della UI); mai sul percorso di stampa.
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface PaperInfo {
  papers: Array<{ name: string; widthMm?: number; heightMm?: number }>
  defaultPaper?: { name: string; widthMm?: number; heightMm?: number }
}

const KNOWN_MM: Record<string, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  Letter: { widthMm: 216, heightMm: 279 },
  Legal: { widthMm: 216, heightMm: 356 },
}

export function paperNameToMm(name: string): { widthMm: number; heightMm: number } | null {
  if (KNOWN_MM[name]) return KNOWN_MM[name]
  const m = name.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/i)
  if (m) return { widthMm: Number(m[1]), heightMm: Number(m[2]) }
  return null
}

export function parseLpoptionsPageSizes(output: string): { papers: string[]; defaultPaper?: string } {
  const line = output.split('\n').find((l) => /^PageSize\//.test(l))
  if (!line) return { papers: [] }
  const tokens = line.slice(line.indexOf(':') + 1).trim().split(/\s+/).filter(Boolean)
  let defaultPaper: string | undefined
  const papers = tokens.map((t) => {
    if (t.startsWith('*')) {
      defaultPaper = t.slice(1)
      return defaultPaper
    }
    return t
  })
  return { papers, defaultPaper }
}

function withMm(name: string): { name: string; widthMm?: number; heightMm?: number } {
  const mm = paperNameToMm(name)
  return mm ? { name, ...mm } : { name }
}

async function cupsPaperInfo(deviceName: string): Promise<PaperInfo> {
  // CUPS usa il nome coda; getPrintersAsync di Electron restituisce lo stesso nome
  const { stdout } = await execAsync(`lpoptions -p "${deviceName.replace(/"/g, '')}" -l`)
  const parsed = parseLpoptionsPageSizes(stdout)
  return {
    papers: parsed.papers.map(withMm),
    defaultPaper: parsed.defaultPaper ? withMm(parsed.defaultPaper) : undefined,
  }
}

async function windowsPaperInfo(deviceName: string): Promise<PaperInfo> {
  // Windows espone solo il formato di default in modo affidabile via PowerShell;
  // la lista completa resta a compilazione manuale nella UI.
  const safe = deviceName.replace(/[`"$]/g, '')
  const cmd = `powershell -NoProfile -Command "(Get-PrintConfiguration -PrinterName '${safe}').PaperSize"`
  const { stdout } = await execAsync(cmd)
  const name = stdout.trim()
  if (!name) return { papers: [] }
  return { papers: [withMm(name)], defaultPaper: withMm(name) }
}

export async function getPaperInfo(deviceName: string): Promise<PaperInfo> {
  try {
    if (process.platform === 'win32') return await windowsPaperInfo(deviceName)
    return await cupsPaperInfo(deviceName)
  } catch {
    return { papers: [] } // probing è best-effort: la UI ricade sull'inserimento manuale
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/main/printing/paper-info.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/printing/paper-info.ts src/main/printing/paper-info.test.ts
git commit -m "feat: per-OS paper format probing (CUPS lpoptions / PowerShell)"
```

---

### Task 15: Wiring main process — IPC e `driverConfigFrom`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Estendere `driverConfigFrom`**:

```typescript
function driverConfigFrom(pc: PrinterConfig) {
  return {
    ip: pc.connection.ip,
    port: pc.connection.port,
    timeout: pc.connection.timeout,
    operatorId: pc.operatorId,
    deptMapping: pc.deptMapping,
    deviceName: pc.connection.deviceName,
    paper: pc.paper,
    template: pc.template,
  }
}
```

- [ ] **Step 2: Nuovi handler IPC** — aggiungere accanto agli `ipcMain.handle` esistenti:

```typescript
import { listSystemPrinters } from './printing/silent-print'
import { getPaperInfo } from './printing/paper-info'
import { renderLabelHtml } from './printing/label-renderer'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE, SAMPLE_LABEL } from './printing/defaults'
import type { PaperConfig, LabelTemplate, NonFiscalDoc } from './drivers/interface'

ipcMain.handle('printers:system', () => listSystemPrinters())

ipcMain.handle('printers:paper-info', (_e, deviceName: string) => getPaperInfo(deviceName))

// Anteprima etichetta con lo stato (anche non salvato) della UI
ipcMain.handle('label:preview', (_e, paper?: PaperConfig, template?: LabelTemplate) =>
  renderLabelHtml(SAMPLE_LABEL, {
    paper: paper ?? DEFAULT_LABEL_PAPER,
    template: template ?? DEFAULT_LABEL_TEMPLATE,
  })
)
```

- [ ] **Step 3: Estendere `driver:test`** con la stampa di prova:

```typescript
ipcMain.handle(
  'driver:test',
  async (_e, printerId?: string, kind: 'status' | 'label' | 'nonfiscal' = 'status') => {
    const driver = printerId ? drivers.get(printerId) : [...drivers.values()][0]
    if (!driver) throw new Error(printerId ? `Driver not found: ${printerId}` : 'No drivers configured')

    if (kind === 'label') {
      const pc = config.get().printers.find((p) => p.id === printerId) ?? config.get().printers[0]
      if (!driver.printLabel) throw new Error('La stampante non supporta le etichette')
      const result = await driver.printLabel(SAMPLE_LABEL, {
        paper: pc?.paper ?? DEFAULT_LABEL_PAPER,
        template: pc?.template ?? DEFAULT_LABEL_TEMPLATE,
      })
      if (!result.success) throw new Error(result.errorMessage)
      emitLog(`Etichetta di prova inviata [${printerId ?? 'default'}]`)
      return driver.getStatus()
    }

    if (kind === 'nonfiscal') {
      if (!driver.printNonFiscal) throw new Error('La stampante non supporta la stampa non fiscale')
      const doc: NonFiscalDoc = {
        lines: [
          { text: 'MASHUP PRINT BRIDGE', bold: true, align: 'center' },
          { text: 'Stampa di prova', align: 'center' },
        ],
        cut: true,
      }
      const result = await driver.printNonFiscal(doc)
      if (!result.success) throw new Error(result.errorMessage)
      emitLog(`Documento di prova inviato [${printerId ?? 'default'}]`)
      return driver.getStatus()
    }

    return driver.getStatus()
  }
)
```
(sostituisce l'handler `driver:test` esistente).

- [ ] **Step 4: Verifica** — Run: `npx tsc --noEmit -p tsconfig.node.json && npm test && npm run lint`
Expected: tutto verde.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: IPC for system printers, paper probing, label preview and test prints"
```

---

### Task 16: Preload e tipi renderer

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: Aggiungere al `contextBridge` in `preload/index.ts`**:

```typescript
  testDriver: (printerId?: string, kind?: 'status' | 'label' | 'nonfiscal') =>
    ipcRenderer.invoke('driver:test', printerId, kind),
  listSystemPrinters: () => ipcRenderer.invoke('printers:system'),
  getPaperInfo: (deviceName: string) => ipcRenderer.invoke('printers:paper-info', deviceName),
  previewLabel: (paper?: unknown, template?: unknown) =>
    ipcRenderer.invoke('label:preview', paper, template),
```
(`testDriver` sostituisce la riga esistente.)

- [ ] **Step 2: Aggiornare `env.d.ts`**:

```typescript
interface Window {
  bridge: {
    getConfig(): Promise<import('../../main/config').AppConfig>
    saveConfig(partial: Record<string, unknown>): Promise<void>
    testDriver(
      printerId?: string,
      kind?: 'status' | 'label' | 'nonfiscal'
    ): Promise<import('../../main/drivers/interface').PrinterStatus>
    listDrivers(): Promise<string[]>
    listSystemPrinters(): Promise<string[]>
    getPaperInfo(deviceName: string): Promise<import('../../main/printing/paper-info').PaperInfo>
    previewLabel(
      paper?: import('../../main/drivers/interface').PaperConfig,
      template?: import('../../main/drivers/interface').LabelTemplate
    ): Promise<string>
    onLogEvent(cb: (msg: string) => void): () => void
    onUpdateAvailable(cb: (version: string) => void): () => void
  }
}
```

- [ ] **Step 3: Verifica** — Run: `npm run build` → Expected: build pulita.
- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: bridge API for system printers, paper info, label preview"
```

---

### Task 17: UI configurazione

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/PrinterCard.tsx`
- Modify: `src/renderer/src/components/ConnectionForm.tsx`
- Create: `src/renderer/src/components/LabelTemplatePanel.tsx`

Nessun test automatico (il progetto non ha infra di test renderer); verifica manuale al Task 18.

- [ ] **Step 1: `App.tsx`** — `newPrinter()` diventa:

```typescript
function newPrinter(): PrinterConfig {
  return {
    id: `printer-${Date.now()}`,
    label: 'Nuova stampante',
    role: 'receipt',
    driver: 'escpos-network',
    connection: { ip: '', port: 9100, timeout: 5000 },
    operatorId: '1',
    deptMapping: {},
  }
}
```

- [ ] **Step 2: `PrinterCard.tsx`** — sostituire la logica `FISCAL_DRIVERS` col ruolo e aggiungere selettore ruolo + pannello template + pulsante di prova:

```tsx
import React, { useState } from 'react'
import { DriverPicker } from './DriverPicker'
import { ConnectionForm } from './ConnectionForm'
import { DeptMapping } from './DeptMapping'
import { LabelTemplatePanel } from './LabelTemplatePanel'
import type { PrinterConfig, PrinterRole } from '../../../main/config'

const ROLES: Array<{ value: PrinterRole; label: string }> = [
  { value: 'fiscal', label: 'Fiscale' },
  { value: 'label', label: 'Etichette' },
  { value: 'receipt', label: 'Ricevute/comande' },
]

// Driver sensati per ruolo: la UI filtra, il server resta la vera guardia (409)
const DRIVERS_BY_ROLE: Record<PrinterRole, string[]> = {
  fiscal: ['epson-fpmate', 'ditron-wec', 'ditron-streamwec'],
  label: ['os-printer', 'escpos-network'],
  receipt: ['escpos-network', 'os-printer'],
}

interface Props {
  printer: PrinterConfig
  drivers: string[]
  onChange: (updated: PrinterConfig) => void
  onRemove?: () => void
}

export function PrinterCard({ printer, drivers, onChange, onRemove }: Props) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const runTest = async (kind: 'status' | 'label' | 'nonfiscal') => {
    setTesting(true)
    setTestResult(null)
    try {
      const status = await window.bridge.testDriver(printer.id, kind)
      setTestResult({
        ok: status.online,
        msg: kind === 'status' ? (status.online ? 'Online ✓' : status.errorMessage || 'Offline') : 'Inviato ✓',
      })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Errore' })
    } finally {
      setTesting(false)
    }
  }

  const roleDrivers = drivers.filter((d) => DRIVERS_BY_ROLE[printer.role]?.includes(d))

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <input
          className="font-medium text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 outline-none px-0.5"
          value={printer.label}
          onChange={(e) => onChange({ ...printer, label: e.target.value })}
        />
        <div className="flex items-center gap-2">
          {testResult && (
            <span className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.msg}
            </span>
          )}
          <button
            className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
            onClick={() => runTest('status')}
            disabled={testing}
          >
            {testing ? '…' : 'Test'}
          </button>
          {printer.role === 'label' && (
            <button
              className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              onClick={() => runTest('label')}
              disabled={testing}
            >
              Prova etichetta
            </button>
          )}
          {printer.role === 'receipt' && (
            <button
              className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              onClick={() => runTest('nonfiscal')}
              disabled={testing}
            >
              Prova stampa
            </button>
          )}
          {onRemove && (
            <button className="text-xs px-2 py-0.5 text-red-500 hover:text-red-700" onClick={onRemove}>
              Rimuovi
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-0.5">Ruolo</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          value={printer.role}
          onChange={(e) => {
            const role = e.target.value as PrinterRole
            onChange({ ...printer, role, driver: DRIVERS_BY_ROLE[role][0] })
          }}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <DriverPicker
        drivers={roleDrivers.length > 0 ? roleDrivers : drivers}
        value={printer.driver}
        onChange={(d) => onChange({ ...printer, driver: d })}
        className="mb-3"
      />

      <ConnectionForm
        value={printer.connection}
        mode={printer.driver === 'os-printer' ? 'system' : 'network'}
        onChange={(c) => onChange({ ...printer, connection: c })}
        onPaperDetected={(paper) => onChange({ ...printer, paper: { ...printer.paper, ...paper } })}
        onTest={() => runTest('status')}
        showTestButton={false}
      />

      {printer.role === 'fiscal' && (
        <DeptMapping
          value={printer.deptMapping}
          onChange={(m) => onChange({ ...printer, deptMapping: m })}
        />
      )}

      {printer.role === 'label' && (
        <LabelTemplatePanel
          paper={printer.paper}
          template={printer.template}
          onChange={(paper, template) => onChange({ ...printer, paper, template })}
        />
      )}
    </div>
  )
}
```
- [ ] **Step 3: `ConnectionForm.tsx`** — aggiungere modalità `system`:

```tsx
import React, { useEffect, useState } from 'react'
import type { PaperConfig } from '../../../main/drivers/interface'

interface Connection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
}

interface Props {
  value: Connection
  mode?: 'network' | 'system'
  onChange: (v: Connection) => void
  onPaperDetected?: (paper: Partial<PaperConfig>) => void
  onTest: () => Promise<void> | void
  showTestButton?: boolean
}

export function ConnectionForm({ value, mode = 'network', onChange, onPaperDetected, onTest, showTestButton = true }: Props) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [systemPrinters, setSystemPrinters] = useState<string[]>([])

  useEffect(() => {
    if (mode === 'system') {
      window.bridge.listSystemPrinters().then(setSystemPrinters).catch(() => setSystemPrinters([]))
    }
  }, [mode])

  const selectSystemPrinter = async (deviceName: string) => {
    onChange({ ...value, deviceName })
    if (!deviceName || !onPaperDetected) return
    try {
      const info = await window.bridge.getPaperInfo(deviceName)
      const def = info.defaultPaper
      if (def?.widthMm && def?.heightMm) {
        onPaperDetected({ widthMm: def.widthMm, heightMm: def.heightMm })
      }
    } catch {
      /* probing best-effort: si compila a mano */
    }
  }

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

  if (mode === 'system') {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Stampante di sistema</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          value={value.deviceName ?? ''}
          onChange={(e) => selectSystemPrinter(e.target.value)}
        >
          <option value="">— Seleziona —</option>
          {systemPrinters.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        {systemPrinters.length === 0 && (
          <p className="text-xs text-amber-600 mt-1">
            Nessuna stampante di sistema trovata. Installa il driver del produttore e riapri questa finestra.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4">
      {/* ... blocco network ESISTENTE invariato (ip / porta / timeout / test button) ... */}
    </div>
  )
}
```
(il ramo `network` resta byte-per-byte quello attuale; cambia solo la firma delle props e il ramo `system` aggiunto sopra il `return` esistente).

- [ ] **Step 4: Creare `LabelTemplatePanel.tsx`**:

```tsx
import React, { useEffect, useState } from 'react'
import type { PaperConfig, LabelTemplate } from '../../../main/drivers/interface'

const DEFAULT_PAPER: PaperConfig = {
  widthMm: 50, heightMm: 30, orientation: 'portrait',
  marginsMm: { top: 1, right: 2, bottom: 1, left: 2 },
}
const DEFAULT_TEMPLATE: LabelTemplate = { preset: 'product-price', showBarcode: true, fontScale: 1 }

interface Props {
  paper?: PaperConfig
  template?: LabelTemplate
  onChange: (paper: PaperConfig, template: LabelTemplate) => void
}

export function LabelTemplatePanel({ paper = DEFAULT_PAPER, template = DEFAULT_TEMPLATE, onChange }: Props) {
  const [previewHtml, setPreviewHtml] = useState('')

  useEffect(() => {
    window.bridge.previewLabel(paper, template).then(setPreviewHtml).catch(() => setPreviewHtml(''))
  }, [JSON.stringify(paper), JSON.stringify(template)])

  const setPaper = (patch: Partial<PaperConfig>) => onChange({ ...paper, ...patch }, template)
  const setTemplate = (patch: Partial<LabelTemplate>) => onChange(paper, { ...template, ...patch })

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">Etichetta</label>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Largh. (mm)</label>
          <input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            value={paper.widthMm}
            onChange={(e) => setPaper({ widthMm: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Alt. (mm)</label>
          <input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            value={paper.heightMm ?? 30}
            onChange={(e) => setPaper({ heightMm: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Orientamento</label>
          <select className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            value={paper.orientation ?? 'portrait'}
            onChange={(e) => setPaper({ orientation: e.target.value as PaperConfig['orientation'] })}>
            <option value="portrait">Verticale</option>
            <option value="landscape">Orizzontale</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4 mb-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={template.showBarcode}
            onChange={(e) => setTemplate({ showBarcode: e.target.checked })} />
          Barcode
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          Scala testo
          <input type="number" step="0.1" min="0.5" max="2" className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
            value={template.fontScale}
            onChange={(e) => setTemplate({ fontScale: Number(e.target.value) || 1 })} />
        </label>
      </div>
      <div className="border border-gray-200 rounded bg-gray-50 p-2 flex justify-center">
        {previewHtml ? (
          <iframe
            title="Anteprima etichetta"
            sandbox=""
            srcDoc={previewHtml}
            style={{
              width: `${paper.widthMm}mm`,
              height: `${paper.heightMm ?? 30}mm`,
              border: '1px solid #ddd',
              background: '#fff',
            }}
          />
        ) : (
          <span className="text-xs text-gray-400">Anteprima non disponibile</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Lint e build** — Run: `npm run lint && npm run build` → Expected: puliti. (Se eslint segnala la dep `JSON.stringify(...)` nello `useEffect`, sostituire con `[paper, template]` e wrappare `previewLabel` in un piccolo debounce non necessario: usare semplicemente `[paper, template]`.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/
git commit -m "feat: config UI — printer roles, system printer picker, label template with live preview"
```

---

### Task 18: Verifica end-to-end, CLAUDE.md, chiusura

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Suite completa** — Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.node.json && npm run build`
Expected: tutto verde.

- [ ] **Step 2: Smoke test manuale in dev** — Run: `npm run dev`, poi dalla UI:
1. Aggiungi stampante ruolo **Etichette** → driver `os-printer` → seleziona una stampante di sistema (su Mac va bene anche una coda PDF/inesistente per vedere lo stato) → verifica che l'anteprima etichetta si aggiorni cambiando dimensioni/barcode.
2. Salva → riapri la finestra → verifica persistenza.
3. Con server attivo: 
```bash
curl -s localhost:8765/printers | python3 -m json.tool
curl -s -X POST localhost:8765/print-label -H 'Content-Type: application/json' \
  -d '{"label":{"name":"Prova","variant":"M","price":9.9,"sku":"SKU1","barcode":"8001234567897"}}'
curl -s -X POST localhost:8765/print-nonfiscal -H 'Content-Type: application/json' \
  -d '{"lines":[{"text":"PROVA","bold":true,"align":"center"}],"cut":true}'
```
Expected: `/printers` mostra `role` e `capabilities`; le stampe rispondono `success:true` (o errore parlante se la stampante non esiste — mai dialoghi).

- [ ] **Step 3: Aggiornare `CLAUDE.md`** — sezioni da toccare:
- Driver layer: aggiungere `os-printer` all'elenco, citare capabilities e metodi opzionali.
- REST API: aggiungere righe `POST /print-label` e `POST /print-nonfiscal`, regola di risoluzione per capability, `409`.
- Config schema: aggiungere `role`, `paper`, `template`, `connection.deviceName` all'esempio.
- Architettura: aggiungere `src/main/printing/` con una riga per modulo.

- [ ] **Step 4: Commit finale**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — printing module, label/non-fiscal API, capabilities"
```

- [ ] **Step 5: Verifica hardware (fuori CI, quando possibile)** — checklist da spuntare in negozio:
- [ ] Etichetta su etichettatrice reale via `os-printer` (Win e Mac)
- [ ] Non fiscale su ESC/POS 80mm reale (accenti, €, taglio)
- [ ] Etichetta raster su ESC/POS (nitidezza barcode a 203dpi — se le barre sbavano, ridurre `moduleMm` a 0.25 o alzare la soglia in `html-to-bitmap.ts`)
- [ ] Rasterizer offscreen: salvare un capture come PNG (`image.toPNG()`) e verificare barre EAN-13 esattamente 3px/modulo e larghezza = widthPx (valida zoom su data: URL, resize DIP e misura in un colpo)
- [ ] Su Mac Retina: verificare che il capture offscreen esca a deviceScaleFactor 1.0 (se esce doppio, aggiungere guardia `image.resize`)
- [ ] Su Windows: verificare che lo spooler rispetti il `pageSize` custom in micron (alcuni driver termici usano il form del driver)
- [ ] `webContents.print` con deviceName inesistente: confermare callback `(false, reason)` su tutte le piattaforme (il timeout 30s copre il caso silenzioso)
- [ ] Etichetta landscape su QL-800/etichettatrici: il contratto attuale è dimensioni FINALI + `landscape: false`; se il driver vendor definisce il media in portrait e l'etichetta esce ruotata/clippata, passare a dimensioni swappate + `landscape: true` in os-printer (flag già riservato in SilentPrintOptions)
- [ ] Non fiscale su Ditron: se risponde `ERRORE DI SINTASSI`, correggere le tre costanti `NONFISCAL_*` in `ditron-streamwec.ts` col comando giusto dal FCR Manager
- [ ] Non fiscale su Epson FP-Mate (resa di `font="2"`/`font="4"`)
```
