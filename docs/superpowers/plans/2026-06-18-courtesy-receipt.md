# Scontrino di cortesia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere `POST /print-courtesy`: il POS invia dati strutturati e il bridge stampa uno scontrino di cortesia (documento non fiscale) su qualunque stampante con capability `non-fiscal`.

**Architecture:** Un formatter puro (`printing/courtesy-receipt.ts`) trasforma il payload strutturato in `NonFiscalDoc`; un endpoint (`server.ts`) valida e instrada al `printNonFiscal` del driver risolto per capability. Nessuna modifica ai driver.

**Tech Stack:** TypeScript, Fastify, vitest. electron-vite per la build.

## Global Constraints

- Lint deve restare pulito: `npm run lint` (`eslint … --max-warnings 0`).
- Test con vitest: `npx vitest run <file>` per singolo file, `npm test` per la suite.
- Identificatori in inglese, stringhe utente in italiano (convenzione del repo).
- Il formatter NON deve importare nulla di rete/driver/Electron: solo tipi da `drivers/interface`.
- Riusare la capability `non-fiscal` esistente: NON aggiungere metodi o capability ai driver.

---

### Task 1: Formatter `buildCourtesyDoc`

**Files:**
- Create: `src/main/printing/courtesy-receipt.ts`
- Test: `src/main/printing/courtesy-receipt.test.ts`

**Interfaces:**
- Consumes: `NonFiscalDoc`, `NonFiscalLine` da `src/main/drivers/interface.ts` (`NonFiscalDoc = { lines: NonFiscalLine[]; cut?: boolean }`, `NonFiscalLine = { text: string; bold?; size?; align? }`).
- Produces:
  - `interface CourtesyData { header: string[]; number?: string; date?: string; items: string[]; returnPolicy?: string[]; footer?: string[] }`
  - `function buildCourtesyDoc(data: CourtesyData): NonFiscalDoc`

- [ ] **Step 1: Write the failing test**

Create `src/main/printing/courtesy-receipt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCourtesyDoc } from './courtesy-receipt'
import type { NonFiscalDoc } from '../drivers/interface'

const texts = (doc: NonFiscalDoc): string[] => doc.lines.map((l) => l.text)

describe('buildCourtesyDoc', () => {
  it('compone i blocchi in ordine con una riga vuota tra di essi', () => {
    const doc = buildCourtesyDoc({
      header: ['I.P.S. S.R.L.', 'P.Iva 02782600619'],
      number: '1329',
      date: '17/06/2026',
      items: ['ABITO DONNA'],
      returnPolicy: ['Hai 30 giorni'],
      footer: ['RT 2CITP017007'],
    })
    expect(texts(doc)).toEqual([
      'I.P.S. S.R.L.',
      'P.Iva 02782600619',
      '',
      'Scontrino di cortesia 1329',
      'del 17/06/2026',
      '',
      'ABITO DONNA',
      '',
      'Hai 30 giorni',
      '',
      'RT 2CITP017007',
    ])
  })

  it('header + items soli: nessuna riga vuota orfana', () => {
    const doc = buildCourtesyDoc({ header: ['NEGOZIO'], items: ['ART'] })
    expect(texts(doc)).toEqual(['NEGOZIO', '', 'ART'])
  })

  it('titolo composto solo dai campi presenti (niente "del undefined")', () => {
    const doc = buildCourtesyDoc({ header: ['N'], number: '5', items: ['A'] })
    expect(texts(doc)).toContain('Scontrino di cortesia 5')
    expect(texts(doc).join('\n')).not.toContain('undefined')
  })

  it('non produce mai due righe vuote consecutive', () => {
    const doc = buildCourtesyDoc({ header: ['N'], items: ['A'], footer: ['F'] })
    const t = texts(doc)
    for (let i = 1; i < t.length; i++) {
      expect(t[i] === '' && t[i - 1] === '').toBe(false)
    }
    expect(doc.cut).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/printing/courtesy-receipt.test.ts`
Expected: FAIL — "Failed to resolve import './courtesy-receipt'" / `buildCourtesyDoc is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/printing/courtesy-receipt.ts`:

```ts
// src/main/printing/courtesy-receipt.ts
// Formatter puro: dati strutturati dello scontrino di cortesia → NonFiscalDoc.
// Possiede il layout (ordine blocchi, righe vuote tra blocchi, titolo).
// Nessuna dipendenza da rete/driver/Electron → testabile in isolamento.
import type { NonFiscalDoc, NonFiscalLine } from '../drivers/interface'

export interface CourtesyData {
  header: string[]
  number?: string
  date?: string
  items: string[]
  returnPolicy?: string[]
  footer?: string[]
}

export function buildCourtesyDoc(data: CourtesyData): NonFiscalDoc {
  const blocks: string[][] = [data.header]

  const title: string[] = []
  if (data.number) title.push(`Scontrino di cortesia ${data.number}`)
  if (data.date) title.push(`del ${data.date}`)
  if (title.length > 0) blocks.push(title)

  blocks.push(data.items)
  if (data.returnPolicy && data.returnPolicy.length > 0) blocks.push(data.returnPolicy)
  if (data.footer && data.footer.length > 0) blocks.push(data.footer)

  const lines: NonFiscalLine[] = []
  blocks.forEach((block, i) => {
    if (i > 0) lines.push({ text: '' }) // separatore fra blocchi, mai orfano
    for (const text of block) lines.push({ text })
  })
  return { lines, cut: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/printing/courtesy-receipt.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/main/printing/courtesy-receipt.ts src/main/printing/courtesy-receipt.test.ts
git commit -m "feat(courtesy): formatter buildCourtesyDoc (payload strutturato → NonFiscalDoc)"
```

---

### Task 2: Endpoint `POST /print-courtesy`

**Files:**
- Modify: `src/main/server.ts` (import in cima; nuova route accanto a `/print-nonfiscal`)
- Test: `src/main/server.test.ts` (append in fondo)

**Interfaces:**
- Consumes: `buildCourtesyDoc`, `CourtesyData` da `./printing/courtesy-receipt`; `resolveByCapability(printers, cap, id?)` già in `server.ts`; `getPrinters()` dalle opzioni; `driver.printNonFiscal(doc)`.
- Produces: route HTTP `POST /print-courtesy`, body `CourtesyData & { printerId?: string }`. Validazione: `header` e `items` array di stringhe non vuoti → 400; routing 404/409/503 come gli altri endpoint; 200 con il `PrintResult` del driver.

- [ ] **Step 1: Write the failing test**

Append a `src/main/server.test.ts` (usa gli helper esistenti `makeMockDriver`, `makeOpts`, e l'import `vi` già presente in cima al file):

```ts
describe('POST /print-courtesy', () => {
  const valid = { header: ['I.P.S. S.R.L.'], items: ['ABITO DONNA'], number: '1329' }

  it('400 se manca header', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: { items: ['A'] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
  })

  it('400 se manca items', async () => {
    const app = buildServer(makeOpts())
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: { header: ['N'] } })
    expect(res.statusCode).toBe(400)
  })

  it('200 e invoca printNonFiscal con payload valido', async () => {
    const driver = makeMockDriver()
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({ method: 'POST', url: '/print-courtesy', payload: valid })
    expect(res.statusCode).toBe(200)
    expect((driver.printNonFiscal as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('409 se la stampante richiesta non ha capability non-fiscal', async () => {
    const driver = makeMockDriver({ capabilities: ['fiscal-receipt'] })
    const app = buildServer(makeOpts(driver))
    const res = await app.inject({
      method: 'POST',
      url: '/print-courtesy',
      payload: { ...valid, printerId: 'fiscal' },
    })
    expect(res.statusCode).toBe(409)
  })
})
```

Note: `makeOpts(driver)` crea una stampante con `id: 'fiscal'`; il mock di default ha tutte le capability (incluso `non-fiscal`), quindi il caso 200 risolve la prima stampante. Nel caso 409 il driver dichiara solo `fiscal-receipt`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/server.test.ts -t "print-courtesy"`
Expected: FAIL — la route non esiste, Fastify risponde 404 (≠ 400/200/409 attesi).

- [ ] **Step 3: Add the import**

In `src/main/server.ts`, accanto agli altri import in cima (es. dopo `import { normalizeEan13/assertPrintableBarcode } …` o dopo l'import di `defaults`):

```ts
import { buildCourtesyDoc, type CourtesyData } from './printing/courtesy-receipt'
```

- [ ] **Step 4: Add the route**

In `src/main/server.ts`, subito dopo la route `app.post(... '/print-nonfiscal' ...)` (e prima di `/print-label`), inserire:

```ts
  app.post<{ Body: CourtesyData & { printerId?: string } }>(
    '/print-courtesy',
    async (req, reply) => {
      const isStrArray = (v: unknown): v is string[] =>
        Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
      if (!isStrArray(req.body.header)) {
        reply.status(400)
        return { success: false, error: 'header (array di stringhe non vuoto) è obbligatorio' }
      }
      if (!isStrArray(req.body.items)) {
        reply.status(400)
        return { success: false, error: 'items (array di stringhe non vuoto) è obbligatorio' }
      }
      const resolved = resolveByCapability(getPrinters(), 'non-fiscal', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      try {
        return await resolved.printer.driver.printNonFiscal!(buildCourtesyDoc(req.body))
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/server.test.ts -t "print-courtesy"`
Expected: PASS (4 test).

- [ ] **Step 6: Full suite + lint + commit**

```bash
npm test
npm run lint
git add src/main/server.ts src/main/server.test.ts
git commit -m "feat(courtesy): POST /print-courtesy (valida payload, instrada a non-fiscal)"
```

---

### Task 3: Documentazione REST + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (tabella REST API e, se presente, la sezione che elenca gli endpoint)

**Interfaces:**
- Consumes: niente (solo docs). Allinea la documentazione all'endpoint del Task 2.

- [ ] **Step 1: Update the REST table**

In `CLAUDE.md`, nella tabella "REST API (localhost:8765)", aggiungere una riga dopo `/print-nonfiscal`:

```markdown
| POST | `/print-courtesy` | Scontrino di cortesia (non fiscale); body `{ header[], items[], number?, date?, returnPolicy?[], footer?[], printerId? }` |
```

E, sotto la tabella, una riga di dettaglio coerente con le altre:

```markdown
`/print-courtesy`: documento non fiscale strutturato. `header` e `items` (array di stringhe non vuoti) sono obbligatori → **400** altrimenti. Il layout (ordine blocchi, righe vuote, titolo "Scontrino di cortesia N") è prodotto da `printing/courtesy-receipt.ts`; l'invio passa per la capability `non-fiscal` (stessa regola 404/409/503). Lo split payment NON è qui: è già gestito da `/print` via l'array `payments`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta POST /print-courtesy nella REST API"
```

---

## Self-Review

**1. Spec coverage:**
- Endpoint dedicato `/print-courtesy` → Task 2. ✓
- Payload strutturato a blocchi → Task 1 (`CourtesyData`). ✓
- Bridge possiede il layout (ordine, righe vuote, titolo) → Task 1 (`buildCourtesyDoc`). ✓
- Riuso capability `non-fiscal`, driver invariati → Task 2 (instrada a `printNonFiscal`). ✓
- Validazione header+items → 400; routing 404/409/503 → Task 2. ✓
- Solo descrizione per gli articoli → `items: string[]` in `CourtesyData`. ✓
- Split payment già supportato → documentato (Task 3), nessun task di codice. ✓
- Testing formatter + endpoint → Task 1 e Task 2. ✓

**2. Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando concreto. ✓

**3. Type consistency:** `CourtesyData` e `buildCourtesyDoc(data): NonFiscalDoc` definiti in Task 1 e consumati con gli stessi nomi/firme in Task 2. `NonFiscalDoc = { lines, cut? }` coerente con `drivers/interface.ts`. ✓
