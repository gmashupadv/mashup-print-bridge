# Driver `axon-fpid` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare al bridge una stampante fiscale RT pilotata da axonFPiD_Pro_v7 (A.P.esse), scambiando file di comandi SF20 con la cartella di ascolto del suo Server di Stampa.

**Architecture:** Tre moduli: due puri (`printing/sf20.ts` per i comandi, `printing/axon-response.ts` per il Response XML) e uno di I/O (`drivers/axon-fpid.ts`) che deposita file `.TXT` nello spool e attende `Response_<job>.xml` nella cartella LOG. La sintassi SF20 di vendita non è documentata da nessuna fonte disponibile: è isolata in `sf20.ts` dietro funzioni che lanciano un errore descrittivo, e si completa dopo la sessione presso il cliente.

**Tech Stack:** TypeScript, Electron (main process), vitest, `fast-xml-parser` (già dipendenza del progetto), React + Tailwind per la UI di configurazione.

**Spec:** `docs/superpowers/specs/2026-07-28-axon-fpid-design.md`

## Global Constraints

- Commenti e stringhe utente in **italiano**, identificatori in **inglese** (convenzione del repo).
- `npm run lint` gira con `--max-warnings 0`: deve restare pulito ad ogni commit.
- `npm test` (vitest) deve passare ad ogni commit.
- Nessuna dipendenza npm nuova. `fast-xml-parser` è già presente e va riusato.
- Il driver **non ritenta mai** un'operazione fallita: le Post Action le esegue già axonFPiD.
- File di comandi scritti in **`latin1` (CP1252) con terminatori CRLF**.
- Timeout di default per questo driver: **30000 ms**.
- Non replicare la tabella dei Reply Code del manuale: la descrizione dell'errore arriva già dal Response XML.
- Branch di lavoro: `feat/axon-fpid-driver` (già creato, contiene la spec).

## File Structure

| File | Stato | Responsabilità |
|---|---|---|
| `src/main/config.ts` | modifica | `spoolDir` / `logDir` in `PrinterConnection` |
| `src/main/drivers/interface.ts` | modifica | `spoolDir` / `logDir` in `DriverConfig` |
| `src/main/index.ts` | modifica | propagazione in `driverConfigFrom`, IPC `driver:probe` e `dialog:pick-folder` |
| `src/main/printing/axon-response.ts` | nuovo | parsing Response XML, legenda Post Action |
| `src/main/printing/sf20.ts` | nuovo | comandi SF20, sanitizzazione, composizione file |
| `src/main/drivers/axon-fpid.ts` | nuovo | spool, coda seriale, polling, `PrinterDriver` |
| `src/main/drivers/registry.ts` | modifica | registrazione `axon-fpid` |
| `src/preload/index.ts` | modifica | `probePrinter`, `pickFolder` |
| `src/renderer/src/env.d.ts` | modifica | tipi delle due API nuove |
| `src/renderer/src/components/ConnectionForm.tsx` | modifica | modo `'spool'` |
| `src/renderer/src/components/PrinterCard.tsx` | modifica | driver nel ruolo fiscale, modo `'spool'`, pannello Sonda |
| `docs/axon-fpid-setup.md` | nuovo | checklist operativa per la sessione dal cliente |
| `CLAUDE.md` | modifica | driver registrato, campi di configurazione |

---

### Task 1: Configurazione — `spoolDir` e `logDir` end-to-end

**Files:**
- Modify: `src/main/config.ts:8-13`
- Modify: `src/main/drivers/interface.ts:50-59`
- Modify: `src/main/index.ts:38-49`
- Test: `src/main/config.test.ts`

**Interfaces:**
- Consumes: niente (primo task).
- Produces: `PrinterConnection.spoolDir?: string`, `PrinterConnection.logDir?: string`, `DriverConfig.spoolDir?: string`, `DriverConfig.logDir?: string`. Il Task 4 li legge in `connect()`.

- [ ] **Step 1: Scrivi il test che fallisce**

In coda a `src/main/config.test.ts`:

```typescript
it('preserva spoolDir e logDir nella configurazione della stampante', async () => {
  const file = path.join(tmpdir(), `cfg-${Date.now()}-spool.json`)
  const manager = createConfigManager(file)
  await manager.save({
    printers: [
      {
        id: 'fiscal',
        label: 'Hydra',
        role: 'fiscal',
        driver: 'axon-fpid',
        connection: {
          ip: '',
          port: 0,
          timeout: 30000,
          spoolDir: 'C:\\axonFPiD_Pro_v7\\Spool',
          logDir: 'C:\\axonFPiD_Pro_v7\\Log',
        },
        operatorId: '1',
        deptMapping: {},
      },
    ],
  })

  const reloaded = createConfigManager(file).get()
  expect(reloaded.printers[0].connection.spoolDir).toBe('C:\\axonFPiD_Pro_v7\\Spool')
  expect(reloaded.printers[0].connection.logDir).toBe('C:\\axonFPiD_Pro_v7\\Log')
})
```

Se `path` / `tmpdir` non sono già importati nel file di test, aggiungi in testa:

```typescript
import * as path from 'node:path'
import { tmpdir } from 'node:os'
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx vitest run src/main/config.test.ts -t "spoolDir"`
Expected: FAIL — errore di tipo TypeScript su `spoolDir` non esistente in `PrinterConnection`.

- [ ] **Step 3: Aggiungi i campi a `PrinterConnection`**

In `src/main/config.ts`, sostituisci l'interfaccia:

```typescript
export interface PrinterConnection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
  /** axon-fpid: cartella di ascolto del Server di Stampa di axonFPiD_Pro_v7. */
  spoolDir?: string
  /** axon-fpid: cartella "LOG e file di risposta" di axonFPiD. Default: spoolDir. */
  logDir?: string
}
```

- [ ] **Step 4: Aggiungi i campi a `DriverConfig`**

In `src/main/drivers/interface.ts`, sostituisci l'interfaccia:

```typescript
export interface DriverConfig {
  ip: string
  port: number
  timeout: number
  operatorId: string
  deptMapping: Record<string, number>
  deviceName?: string
  spoolDir?: string
  logDir?: string
  paper?: PaperConfig
  template?: LabelTemplate
}
```

- [ ] **Step 5: Propaga in `driverConfigFrom`**

In `src/main/index.ts`, dentro `driverConfigFrom`, aggiungi dopo la riga `deviceName:`:

```typescript
    spoolDir: pc.connection.spoolDir,
    logDir: pc.connection.logDir,
```

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `npx vitest run src/main/config.test.ts`
Expected: PASS, incluso il test nuovo.

- [ ] **Step 7: Lint e commit**

```bash
npm run lint
git add src/main/config.ts src/main/config.test.ts src/main/drivers/interface.ts src/main/index.ts
git commit -m "feat(config): campi spoolDir e logDir per il driver axon-fpid"
```

---

### Task 2: Parsing del Response XML di axonFPiD

**Files:**
- Create: `src/main/printing/axon-response.ts`
- Test: `src/main/printing/axon-response.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `parseAxonResponse(xml: string): AxonResponse`
  - `firstTag(res: AxonResponse, name: string): string`
  - `describeFailure(res: AxonResponse): string`
  - `POST_ACTIONS: Record<string, string>`
  - `PAPER_OUT_REPLIES: Set<string>`, `COVER_OPEN_REPLIES: Set<string>`
  - tipi `AxonResponse`, `AxonException`

  `AxonResponse.tags` è `Record<string, string[]>` — **sempre array**, perché un file di sonda contiene 60 comandi `d/x/` e produce 60 occorrenze dello stesso TAG.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `src/main/printing/axon-response.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseAxonResponse,
  firstTag,
  describeFailure,
  PAPER_OUT_REPLIES,
} from './axon-response'

const OK_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>OK</ESITO>
  <REPLY>00</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>02</FISCAL_STATUS>
  <CMD_X_ULTIMO_NUMERO_SCONTRINO>123</CMD_X_ULTIMO_NUMERO_SCONTRINO>
  <CMD_a_ECR_MATRICOLA>8A014141</CMD_a_ECR_MATRICOLA>
</RESPONSE>`

const ERROR_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>NON OK</ESITO>
  <REPLY>2D</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>06</FISCAL_STATUS>
  <ECCEZIONE>
    <NUMERO_RIGA_ECCEZIONE>001</NUMERO_RIGA_ECCEZIONE>
    <COMANDO_ECCEZIONE>3/S/PROVA</COMANDO_ECCEZIONE>
    <REPLY_ECCEZIONE>44</REPLY_ECCEZIONE>
    <DEVICE_STATUS_ECCEZIONE>00</DEVICE_STATUS_ECCEZIONE>
    <FISCAL_STATUS_ECCEZIONE>06</FISCAL_STATUS_ECCEZIONE>
    <DESC_ERRORE_ECCEZIONE>Carta Finita</DESC_ERRORE_ECCEZIONE>
    <AZIONE_ECCEZIONE>4</AZIONE_ECCEZIONE>
  </ECCEZIONE>
</RESPONSE>`

const PROBE_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>OK</ESITO>
  <REPLY>00</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>02</FISCAL_STATUS>
  <CMD_e_VAT_A>4</CMD_e_VAT_A>
  <CMD_e_VAT_B>10</CMD_e_VAT_B>
  <CMD_d_DPT_NUMERO>1</CMD_d_DPT_NUMERO>
  <CMD_d_DPT_DESCRIZIONE>ALIMENTARI</CMD_d_DPT_DESCRIZIONE>
  <CMD_d_DPT_ALIQUOTAIVA>1</CMD_d_DPT_ALIQUOTAIVA>
  <CMD_d_DPT_NUMERO>2</CMD_d_DPT_NUMERO>
  <CMD_d_DPT_DESCRIZIONE>BEVANDE</CMD_d_DPT_DESCRIZIONE>
  <CMD_d_DPT_ALIQUOTAIVA>2</CMD_d_DPT_ALIQUOTAIVA>
</RESPONSE>`

describe('parseAxonResponse', () => {
  it('legge esito e stati da una risposta OK', () => {
    const res = parseAxonResponse(OK_XML)
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
    expect(res.deviceStatus).toBe('00')
    expect(res.fiscalStatus).toBe('02')
    expect(res.exception).toBeNull()
  })

  it('espone i TAG di interrogazione', () => {
    const res = parseAxonResponse(OK_XML)
    expect(firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO')).toBe('123')
    expect(firstTag(res, 'CMD_a_ECR_MATRICOLA')).toBe('8A014141')
  })

  it('restituisce stringa vuota per un TAG assente', () => {
    expect(firstTag(parseAxonResponse(OK_XML), 'CMD_INESISTENTE')).toBe('')
  })

  it('legge il blocco ECCEZIONE di una risposta NON OK', () => {
    const res = parseAxonResponse(ERROR_XML)
    expect(res.ok).toBe(false)
    expect(res.exception?.reply).toBe('44')
    expect(res.exception?.description).toBe('Carta Finita')
    expect(res.exception?.command).toBe('3/S/PROVA')
    expect(res.exception?.action).toBe('4')
  })

  it('conserva le occorrenze ripetute dello stesso TAG in ordine', () => {
    const res = parseAxonResponse(PROBE_XML)
    expect(res.tags['CMD_d_DPT_NUMERO']).toEqual(['1', '2'])
    expect(res.tags['CMD_d_DPT_DESCRIZIONE']).toEqual(['ALIMENTARI', 'BEVANDE'])
    expect(res.tags['CMD_d_DPT_ALIQUOTAIVA']).toEqual(['1', '2'])
  })

  it('rifiuta un XML senza tag RESPONSE', () => {
    expect(() => parseAxonResponse('<ALTRO></ALTRO>')).toThrow(/RESPONSE/)
  })
})

describe('describeFailure', () => {
  it('compone descrizione, comando e post action', () => {
    const msg = describeFailure(parseAxonResponse(ERROR_XML))
    expect(msg).toContain('Carta Finita')
    expect(msg).toContain('3/S/PROVA')
    expect(msg).toContain('comando ripetuto')
  })

  it('ripiega sul reply code se manca il blocco ECCEZIONE', () => {
    const res = parseAxonResponse(OK_XML)
    const failed = { ...res, ok: false, reply: '2D' }
    expect(describeFailure(failed)).toContain('2D')
  })
})

describe('classificazione delle condizioni fisiche', () => {
  it('riconosce il reply code di carta finita', () => {
    expect(PAPER_OUT_REPLIES.has('44')).toBe(true)
  })
})
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npx vitest run src/main/printing/axon-response.test.ts`
Expected: FAIL — `Cannot find module './axon-response'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `src/main/printing/axon-response.ts`:

```typescript
// Parsing del file Response_<job>.xml scritto da axonFPiD_Pro_v7 al termine
// dell'elaborazione di un file di comandi SF20.
//
// Nota di design: non replichiamo la tabella dei Reply Code del manuale (0-176,
// con descrizioni che cambiano per modello). Il Response porta già dentro
// <ECCEZIONE> sia la descrizione dell'errore sia la Post Action intrapresa da
// axonFPiD: sarebbe una copia rumorosa di dati che il file ci consegna risolti.
import { XMLParser } from 'fast-xml-parser'

// parseTagValue: false → i valori restano stringhe. Serve per non perdere gli
// zeri iniziali di REPLY ("00") e delle matricole.
const parser = new XMLParser({ parseTagValue: false, trimValues: true })

/** Legenda "TABELLA DESCRIZIONE POST ACTION" del manuale axonFPiD_Pro_v7. */
export const POST_ACTIONS: Record<string, string> = {
  '1': 'comando ripetuto',
  '2': 'errore ignorato, stampa proseguita',
  '3': 'attesa ripristino stampante, comando saltato',
  '4': 'attesa ripristino stampante, comando ripetuto',
  '5': 'comando ripetuto subito',
  '9': 'errore grave, invio comandi interrotto',
}

/** Reply Code che segnalano una condizione fisica, non un errore di comando. */
export const PAPER_OUT_REPLIES = new Set(['44'])
export const COVER_OPEN_REPLIES = new Set(['51'])

export interface AxonException {
  lineNumber: string
  command: string
  reply: string
  deviceStatus: string
  fiscalStatus: string
  description: string
  action: string
}

export interface AxonResponse {
  ok: boolean
  reply: string
  deviceStatus: string
  fiscalStatus: string
  exception: AxonException | null
  /**
   * TAG CMD_* dei comandi di interrogazione contenuti nel file inviato.
   * Sempre array: un file di sonda contiene 60 comandi `d/x/` e produce 60
   * occorrenze dello stesso TAG, in ordine di documento.
   */
  tags: Record<string, string[]>
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function push(out: Record<string, string[]>, key: string, value: unknown): void {
  const list = out[key] ?? (out[key] = [])
  list.push(str(value))
}

function collectTags(node: unknown, out: Record<string, string[]>): void {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectTags(item, out)
    return
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null && typeof item === 'object') collectTags(item, out)
        else if (key.startsWith('CMD_')) push(out, key, item)
      }
    } else if (value != null && typeof value === 'object') {
      collectTags(value, out)
    } else if (key.startsWith('CMD_')) {
      push(out, key, value)
    }
  }
}

export function parseAxonResponse(xml: string): AxonResponse {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const root = parsed['RESPONSE'] as Record<string, unknown> | undefined
  if (!root) throw new Error('Response XML privo del tag <RESPONSE>')

  const tags: Record<string, string[]> = {}
  collectTags(root, tags)

  const raw = root['ECCEZIONE']
  const exc = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined

  return {
    ok: str(root['ESITO']).toUpperCase() === 'OK',
    reply: str(root['REPLY']),
    deviceStatus: str(root['DEVICE_STATUS']),
    fiscalStatus: str(root['FISCAL_STATUS']),
    exception: exc
      ? {
          lineNumber: str(exc['NUMERO_RIGA_ECCEZIONE']),
          command: str(exc['COMANDO_ECCEZIONE']),
          reply: str(exc['REPLY_ECCEZIONE']),
          deviceStatus: str(exc['DEVICE_STATUS_ECCEZIONE']),
          fiscalStatus: str(exc['FISCAL_STATUS_ECCEZIONE']),
          description: str(exc['DESC_ERRORE_ECCEZIONE']),
          action: str(exc['AZIONE_ECCEZIONE']),
        }
      : null,
    tags,
  }
}

export function firstTag(res: AxonResponse, name: string): string {
  return res.tags[name]?.[0] ?? ''
}

/** Messaggio leggibile dal POS a partire da una Response non riuscita. */
export function describeFailure(res: AxonResponse): string {
  const exc = res.exception
  if (!exc) return `Stampa non riuscita (REPLY ${res.reply || '?'})`
  const parts = [exc.description || `Reply Code ${exc.reply || '?'}`]
  if (exc.command) parts.push(`comando "${exc.command}"`)
  const action = POST_ACTIONS[exc.action]
  if (action) parts.push(action)
  return parts.join(' — ')
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npx vitest run src/main/printing/axon-response.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/main/printing/axon-response.ts src/main/printing/axon-response.test.ts
git commit -m "feat(printing): parsing del Response XML di axonFPiD_Pro_v7"
```

---

### Task 3: Comandi SF20

**Files:**
- Create: `src/main/printing/sf20.ts`
- Test: `src/main/printing/sf20.test.ts`

**Interfaces:**
- Consumes: `ReceiptData` da `src/main/drivers/interface.ts`.
- Produces:
  - `QUERY` (oggetto con `status`, `firmware`, `identity`, `lastDocuments`, `lastClosure`, `vatTable`, `dateTime`, `department(n)`)
  - `amount(value: number): string`
  - `sanitize(text: string, maxLength?: number): string`
  - `buildCommandFile(commands: string[]): string`
  - `buildProbe(departmentCount?: number): string[]`
  - `buildReceipt(data: ReceiptData, operatorId: string): string[]` — **lancia** finché la sintassi non è nota
  - `buildDailyClose(operatorId: string): string[]` — **lancia**
  - `buildOpenDrawer(operatorId: string): string[]` — **lancia**
  - `Sf20CommandUnavailableError`

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `src/main/printing/sf20.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  QUERY,
  amount,
  sanitize,
  buildCommandFile,
  buildProbe,
  buildReceipt,
  buildDailyClose,
  buildOpenDrawer,
  Sf20CommandUnavailableError,
} from './sf20'

describe('amount', () => {
  it('formatta con due decimali e punto', () => {
    expect(amount(1)).toBe('1.00')
    expect(amount(12.5)).toBe('12.50')
    expect(amount(0.019)).toBe('0.02')
  })
})

describe('sanitize', () => {
  it('rimuove le barre, che nel protocollo separano i campi', () => {
    expect(sanitize('Pane 1/2 kg')).toBe('Pane 1 2 kg')
  })

  it('collassa spazi, newline e tabulazioni', () => {
    expect(sanitize('Riga\r\nunica\tsola')).toBe('Riga unica sola')
  })

  it('tronca alla lunghezza massima', () => {
    expect(sanitize('A'.repeat(50), 30)).toHaveLength(30)
  })
})

describe('buildCommandFile', () => {
  it('usa CRLF e chiude con un terminatore di riga', () => {
    expect(buildCommandFile(['v/', 'a/'])).toBe('v/\r\na/\r\n')
  })
})

describe('buildProbe', () => {
  it('contiene solo comandi di interrogazione', () => {
    const commands = buildProbe(3)
    expect(commands).toEqual(['v/', 'a/', ',/10/', 'X/', 'e/', 'd/1/', 'd/2/', 'd/3/'])
  })

  it('interroga 60 reparti per default', () => {
    expect(buildProbe()).toHaveLength(65)
  })
})

describe('comandi di vendita non ancora determinati', () => {
  const data = {
    items: [{ description: 'PROVA', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 }],
    discount: 0,
    payments: [{ description: 'Contanti', amount: 1, paymentType: 0 }],
  }

  it('buildReceipt lancia un errore che indirizza alla procedura', () => {
    expect(() => buildReceipt(data, '1')).toThrow(Sf20CommandUnavailableError)
    expect(() => buildReceipt(data, '1')).toThrow(/Scontrini di test/)
  })

  it('buildDailyClose lancia', () => {
    expect(() => buildDailyClose('1')).toThrow(Sf20CommandUnavailableError)
  })

  it('buildOpenDrawer lancia', () => {
    expect(() => buildOpenDrawer('1')).toThrow(Sf20CommandUnavailableError)
  })
})

describe('QUERY', () => {
  it('numera i reparti', () => {
    expect(QUERY.department(7)).toBe('d/7/')
  })
})
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npx vitest run src/main/printing/sf20.test.ts`
Expected: FAIL — `Cannot find module './sf20'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `src/main/printing/sf20.ts`:

```typescript
// Protocollo SF20 (A.P.esse / Micrelec): comandi ASCII a campi separati da "/",
// una riga per comando, ogni riga terminata da "/".
//
// I comandi di INTERROGAZIONE sono documentati nel manuale axonFPiD_Pro_v7,
// sezione "Elenco Comandi SF20 gestiti con risposta nel file Response_...".
// I comandi di VENDITA non lo sono: vedi il blocco in fondo al file.
import type { ReceiptData } from '../drivers/interface'

/** Comandi di interrogazione documentati. Non scrivono nulla sulla RT. */
export const QUERY = {
  dateTime: 't/',
  status: ',/10/',
  firmware: 'v/',
  identity: 'a/',
  lastDocuments: 'X/',
  lastClosure: 'i/',
  vatTable: 'e/',
  department: (n: number): string => `d/${n}/`,
} as const

/** Importo in euro: due decimali, separatore punto. */
export function amount(value: number): string {
  return value.toFixed(2)
}

/**
 * Testo libero destinato a un campo comando. La "/" separa i campi del
 * protocollo, quindi va rimossa insieme a newline e tabulazioni.
 */
export function sanitize(text: string, maxLength = 30): string {
  return text
    .replace(/[/\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** File di comandi per il Server di Stampa: CRLF, il consumatore è Windows. */
export function buildCommandFile(commands: string[]): string {
  return commands.join('\r\n') + '\r\n'
}

/**
 * Sonda di configurazione: versione FW, identità, stato, ultimi documenti,
 * tabella IVA e tutti i reparti. Sole interrogazioni, nessuna scrittura.
 */
export function buildProbe(departmentCount = 60): string[] {
  const commands: string[] = [
    QUERY.firmware,
    QUERY.identity,
    QUERY.status,
    QUERY.lastDocuments,
    QUERY.vatTable,
  ]
  for (let n = 1; n <= departmentCount; n++) commands.push(QUERY.department(n))
  return commands
}

// ---------------------------------------------------------------------------
// Comandi di vendita — DA DETERMINARE SUL CAMPO
//
// Nessuna delle fonti disponibili documenta la sintassi di vendita, subtotale,
// sconto, pagamento, chiusura giornaliera e apertura cassetto:
//   - axonfpid_pro_v7.txt elenca solo i comandi di interrogazione;
//   - sf20.txt e' il libretto dell'ECR e non contiene il protocollo.
// Unico indizio: il manuale axonFPiD mostra "3/S/xxxxxx..." come esempio di
// COMANDO_ECCEZIONE, quindi la forma e' quella dei campi separati da "/".
//
// Procedura per ricavarla: docs/axon-fpid-setup.md, passo 7.
// ---------------------------------------------------------------------------

export class Sf20CommandUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `Comando SF20 per "${operation}" non ancora determinato. Ricavare la sintassi da ` +
        'axonFPiD_Pro_v7 → Pannello del Tecnico → "Stampa Scontrini di test", quindi ' +
        'completare src/main/printing/sf20.ts (vedi docs/axon-fpid-setup.md).'
    )
    this.name = 'Sf20CommandUnavailableError'
  }
}

export function buildReceipt(_data: ReceiptData, _operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('scontrino fiscale')
}

export function buildDailyClose(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('chiusura giornaliera')
}

export function buildOpenDrawer(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('apertura cassetto')
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npx vitest run src/main/printing/sf20.test.ts`
Expected: PASS, 11 test.

- [ ] **Step 5: Lint e commit**

Se ESLint segnala i parametri inutilizzati, verifica che il prefisso `_` sia già configurato come eccezione in `.eslintrc.cjs`; se non lo è, usa la stessa convenzione già presente in `ditron-streamwec.ts` (`_operatorId`), che passa il lint.

```bash
npm run lint
git add src/main/printing/sf20.ts src/main/printing/sf20.test.ts
git commit -m "feat(printing): comandi SF20 di interrogazione e sonda"
```

---

### Task 4: Driver `axon-fpid` — trasporto su spool

**Files:**
- Create: `src/main/drivers/axon-fpid.ts`
- Modify: `src/main/drivers/registry.ts`
- Test: `src/main/drivers/axon-fpid.test.ts`

**Interfaces:**
- Consumes: `parseAxonResponse`, `firstTag`, `describeFailure` (Task 2); `QUERY`, `buildCommandFile`, `buildProbe`, `buildReceipt`, `buildDailyClose`, `buildOpenDrawer` (Task 3); `DriverConfig.spoolDir`/`logDir` (Task 1).
- Produces:
  - `AxonFpidDriver` (classe, registrata come `axon-fpid`)
  - `AxonFpidDriver.probeConfig(): Promise<AxonProbe>` — usata dal Task 6
  - tipi `AxonProbe`, `AxonDepartment`
  - `deptMappingFromProbe(probe: AxonProbe): Record<string, number>` — usata dal Task 6

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `src/main/drivers/axon-fpid.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { AxonFpidDriver, deptMappingFromProbe } from './axon-fpid'
import type { AxonProbe } from './axon-fpid'

let root = ''
let spoolDir = ''
let logDir = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axon-'))
  spoolDir = path.join(root, 'spool')
  logDir = path.join(root, 'log')
  await mkdir(spoolDir, { recursive: true })
  await mkdir(logDir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function connect(timeout = 2000): Promise<AxonFpidDriver> {
  const driver = new AxonFpidDriver()
  await driver.connect({
    ip: '',
    port: 0,
    timeout,
    operatorId: '1',
    deptMapping: {},
    spoolDir,
    logDir,
  })
  return driver
}

/**
 * Finto axonFPiD: attende un .txt nello spool, lo consuma e scrive la Response
 * nella cartella LOG. Restituisce il contenuto del file consumato.
 */
async function serveOnce(xmlFor: (commands: string) => string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const entries = await readdir(spoolDir)
    const job = entries.find((e) => e.endsWith('.txt'))
    if (job) {
      const jobPath = path.join(spoolDir, job)
      const commands = await readFile(jobPath, 'latin1')
      await unlink(jobPath)
      const base = job.replace(/\.txt$/, '')
      await writeFile(path.join(logDir, `Response_${base}.xml`), xmlFor(commands), 'latin1')
      return commands
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('nessun file comparso nello spool')
}

const OK_RESPONSE = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_virgola_ECR_STATO>1</CMD_virgola_ECR_STATO></RESPONSE>`

describe('trasporto su cartella di ascolto', () => {
  it('deposita un .txt e legge la Response corrispondente', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
  })

  it('scrive i comandi in CRLF e non lascia file temporanei', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    await driver.submit(['v/', 'a/'])
    expect(await served).toBe('v/\r\na/\r\n')
    expect(await readdir(spoolDir)).toEqual([])
  })

  it('cancella la Response dopo averla letta', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    await driver.submit(['v/'])
    await served
    expect(await readdir(logDir)).toEqual([])
  })

  it('diagnostica il Server di Stampa non attivo quando il file resta nello spool', async () => {
    const driver = await connect(400)
    await expect(driver.submit(['v/'])).rejects.toThrow(/Server di Stampa/)
  })

  it('avverte che il documento potrebbe essere stampato se manca solo la Response', async () => {
    const driver = await connect(600)
    const consume = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) return unlink(path.join(spoolDir, job))
        await new Promise((r) => setTimeout(r, 10))
      }
    })()
    await expect(driver.submit(['v/'])).rejects.toThrow(/NON ristampare/)
    await consume
  })

  it('serializza i job: il secondo file compare solo dopo il primo', async () => {
    const driver = await connect()
    const seen: string[] = []
    const server = (async () => {
      for (let n = 0; n < 2; n++) seen.push(await serveOnce(() => OK_RESPONSE))
    })()
    await Promise.all([driver.submit(['v/']), driver.submit(['a/'])])
    await server
    expect(seen).toEqual(['v/\r\n', 'a/\r\n'])
  })
})

describe('getStatus', () => {
  it('segnala carta assente in presenza del file flag', async () => {
    const driver = await connect()
    await writeFile(path.join(logDir, 'Fine_Carta.log'), 'fine carta', 'latin1')
    const served = serveOnce(() => OK_RESPONSE)
    const status = await driver.getStatus()
    await served
    expect(status.online).toBe(true)
    expect(status.paperPresent).toBe(false)
    expect(status.coverClosed).toBe(true)
  })

  it('è offline se axonFPiD non risponde', async () => {
    const driver = await connect(300)
    const status = await driver.getStatus()
    expect(status.online).toBe(false)
    expect(status.errorMessage).not.toBe('')
  })
})

describe('probeConfig', () => {
  const PROBE_RESPONSE = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_v_ECR_VERSIONEFW>V2 R1 B7 F064</CMD_v_ECR_VERSIONEFW>
<CMD_a_ECR_MATRICOLA>8A014141</CMD_a_ECR_MATRICOLA>
<CMD_a_ECR_CODICEMODELLO>TN</CMD_a_ECR_CODICEMODELLO>
<CMD_e_VAT_A>4</CMD_e_VAT_A><CMD_e_VAT_B>10</CMD_e_VAT_B>
<CMD_e_VAT_C>22</CMD_e_VAT_C><CMD_e_VAT_D>0</CMD_e_VAT_D><CMD_e_VAT_E>0</CMD_e_VAT_E>
<CMD_d_DPT_NUMERO>1</CMD_d_DPT_NUMERO><CMD_d_DPT_DESCRIZIONE>ALIMENTARI</CMD_d_DPT_DESCRIZIONE>
<CMD_d_DPT_ALIQUOTAIVA>1</CMD_d_DPT_ALIQUOTAIVA>
<CMD_d_DPT_NUMERO>2</CMD_d_DPT_NUMERO><CMD_d_DPT_DESCRIZIONE>BEVANDE</CMD_d_DPT_DESCRIZIONE>
<CMD_d_DPT_ALIQUOTAIVA>3</CMD_d_DPT_ALIQUOTAIVA></RESPONSE>`

  it('ricostruisce identità, tabella IVA e reparti', async () => {
    const driver = await connect()
    const served = serveOnce(() => PROBE_RESPONSE)
    const probe = await driver.probeConfig()
    await served
    expect(probe.firmware).toBe('V2 R1 B7 F064')
    expect(probe.serial).toBe('8A014141')
    expect(probe.vatTable).toEqual({ A: '4', B: '10', C: '22', D: '0', E: '0' })
    expect(probe.departments).toEqual([
      { number: '1', description: 'ALIMENTARI', vatCode: '1' },
      { number: '2', description: 'BEVANDE', vatCode: '3' },
    ])
  })
})

describe('deptMappingFromProbe', () => {
  it('mappa aliquota su primo reparto che la usa', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '10', C: '22', D: '0', E: '0' },
      departments: [
        { number: '1', description: 'ALIMENTARI', vatCode: '1' },
        { number: '2', description: 'BEVANDE', vatCode: '3' },
        { number: '3', description: 'ALTRO', vatCode: '3' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 1, '22.00': 2 })
  })

  it('ignora reparti con codice IVA fuori range', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '', C: '', D: '', E: '' },
      departments: [
        { number: '1', description: 'X', vatCode: '9' },
        { number: '2', description: 'Y', vatCode: '1' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 2 })
  })
})

describe('operazioni non ancora implementabili', () => {
  it('printReceipt fallisce con un messaggio che indirizza alla procedura', async () => {
    const driver = await connect()
    await expect(
      driver.printReceipt({
        items: [{ description: 'X', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 }],
        discount: 0,
        payments: [{ description: 'Contanti', amount: 1, paymentType: 0 }],
      })
    ).rejects.toThrow(/Scontrini di test/)
  })
})
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npx vitest run src/main/drivers/axon-fpid.test.ts`
Expected: FAIL — `Cannot find module './axon-fpid'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `src/main/drivers/axon-fpid.ts`:

```typescript
// Driver per stampanti fiscali RT pilotate da axonFPiD_Pro_v7 (A.P.esse).
//
// Non parla con la stampante: deposita file di comandi SF20 nella cartella di
// ascolto del Server di Stampa di axonFPiD e legge il file Response_<job>.xml
// che l'applicazione scrive nella cartella LOG.
//
// Il nome del file è l'unica chiave di correlazione fra richiesta e risposta,
// quindi deve essere univoco per job.
import { writeFile, rename, readFile, unlink, access } from 'node:fs/promises'
import * as path from 'node:path'
import type {
  Capability,
  DriverConfig,
  PrinterDriver,
  PrinterStatus,
  PrintResult,
  ReceiptData,
} from './interface'
import { parseAxonResponse, describeFailure, firstTag } from '../printing/axon-response'
import type { AxonResponse } from '../printing/axon-response'
import * as sf20 from '../printing/sf20'

const POLL_INTERVAL_MS = 250
const STATUS_CACHE_MS = 10_000
const DEFAULT_TIMEOUT_MS = 30_000

// File flag creati da axonFPiD nella cartella LOG finché la condizione è vera.
const FLAG_PAPER_OUT = ['Fine_Carta.log', 'Quasi_Fine_Carta.log']
const FLAG_COVER_OPEN = 'Sportello_Aperto.log'
const FLAG_FATAL = 'Errore_Grave.log'
const FLAG_DISPLAY = 'Display_Non_OK.log'

const VAT_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

export interface AxonDepartment {
  number: string
  description: string
  vatCode: string
}

export interface AxonProbe {
  firmware: string
  serial: string
  model: string
  lastReceiptNumber: string
  /** Lettera aliquota → percentuale, come programmata sulla stampante. */
  vatTable: Record<string, string>
  departments: AxonDepartment[]
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * deptMapping = aliquota IVA (due decimali) → primo reparto che la usa.
 * Il codice IVA del reparto è 1..5 e punta alle lettere A..E della tabella.
 */
export function deptMappingFromProbe(probe: AxonProbe): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (const dept of probe.departments) {
    const letter = VAT_LETTERS[Number(dept.vatCode) - 1]
    if (!letter) continue
    const rate = probe.vatTable[letter]
    if (rate == null || rate === '') continue
    const number = Number(dept.number)
    if (!Number.isFinite(number) || number <= 0) continue
    const key = Number(rate).toFixed(2)
    if (!(key in mapping)) mapping[key] = number
  }
  return mapping
}

function toPrintResult(res: AxonResponse): PrintResult {
  return {
    success: res.ok,
    receiptNumber: firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO'),
    closureNumber: firstTag(res, 'CMD_i_Z_NUMERO'),
    printerSerial: firstTag(res, 'CMD_a_ECR_MATRICOLA'),
    errorMessage: res.ok ? '' : describeFailure(res),
  }
}

export class AxonFpidDriver implements PrinterDriver {
  readonly name = 'axon-fpid'
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']

  private spoolDir = ''
  private logDir = ''
  private timeout = DEFAULT_TIMEOUT_MS
  private operatorId = '1'
  private seq = 0
  private queue: Promise<unknown> = Promise.resolve()
  private statusCache: { at: number; status: PrinterStatus } | null = null

  async connect(config: DriverConfig): Promise<void> {
    if (!config.spoolDir) {
      throw new Error('axon-fpid: cartella di ascolto (spoolDir) non configurata')
    }
    this.spoolDir = config.spoolDir
    this.logDir = config.logDir || config.spoolDir
    this.timeout = config.timeout > 0 ? config.timeout : DEFAULT_TIMEOUT_MS
    this.operatorId = config.operatorId
    this.statusCache = null
  }

  async disconnect(): Promise<void> {}

  /** La RT è una sola: i job non devono mai interlacciarsi. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async submit(commands: string[]): Promise<AxonResponse> {
    return this.enqueue(() => this.submitNow(commands))
  }

  private async submitNow(commands: string[]): Promise<AxonResponse> {
    const jobName = `mashup-${Date.now()}-${++this.seq}`
    const tmpPath = path.join(this.spoolDir, `${jobName}.tmp`)
    const jobPath = path.join(this.spoolDir, `${jobName}.txt`)

    // Scrittura su .tmp + rename atomico: axonFPiD sorveglia la cartella e
    // leggerebbe un .txt ancora incompleto.
    // latin1 = CP1252, il consumatore è un'applicazione Windows ANSI.
    await writeFile(tmpPath, sf20.buildCommandFile(commands), 'latin1')
    await rename(tmpPath, jobPath)

    // Il manuale è ambiguo sull'inclusione dell'estensione originale nel nome
    // della Response: cerchiamo entrambe le forme.
    const candidates = [
      path.join(this.logDir, `Response_${jobName}.xml`),
      path.join(this.logDir, `Response_${jobName}.txt.xml`),
    ]

    const deadline = Date.now() + this.timeout
    let pickedUp = false

    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        if (await exists(candidate)) {
          const xml = await readFile(candidate, 'latin1')
          await unlink(candidate).catch(() => undefined)
          return parseAxonResponse(xml)
        }
      }
      if (!pickedUp && !(await exists(jobPath))) pickedUp = true
      await delay(POLL_INTERVAL_MS)
    }

    if (!pickedUp && (await exists(jobPath))) {
      await unlink(jobPath).catch(() => undefined)
      throw new Error(
        `axonFPiD non ha prelevato il file entro ${this.timeout} ms: Server di Stampa non ` +
          `attivo, o cartella di ascolto errata (${this.spoolDir}). Il documento NON è stato stampato.`
      )
    }

    throw new Error(
      `Nessun Response XML entro ${this.timeout} ms in ${this.logDir}. Il documento è stato ` +
        'consegnato alla stampante e potrebbe essere stato emesso: NON ristampare senza verifica. ' +
        'Controllare che RESPONSE XML sia attivo in axonFPiD (pannello "LOG e file di risposta") ' +
        'e che la cartella LOG configurata sia quella giusta.'
    )
  }

  private async readFlags(): Promise<Pick<PrinterStatus, 'paperPresent' | 'coverClosed' | 'errorMessage'>> {
    const [paperOut, coverOpen, fatal, display] = await Promise.all([
      Promise.all(FLAG_PAPER_OUT.map((f) => exists(path.join(this.logDir, f)))),
      exists(path.join(this.logDir, FLAG_COVER_OPEN)),
      exists(path.join(this.logDir, FLAG_FATAL)),
      exists(path.join(this.logDir, FLAG_DISPLAY)),
    ])

    let errorMessage = ''
    if (fatal) {
      const detail = await readFile(path.join(this.logDir, FLAG_FATAL), 'latin1').catch(() => '')
      errorMessage = `Errore grave stampante: ${detail.trim() || 'vedi Errore_Grave.log'}`
    } else if (display) {
      errorMessage = 'Display della stampante disconnesso'
    }

    return {
      paperPresent: !paperOut.some(Boolean),
      coverClosed: !coverOpen,
      errorMessage,
    }
  }

  /**
   * Liveness reale (sonda ,/10/) piu` granularità dai file flag, con cache:
   * senza cache ogni GET /status del POS accoderebbe un job nella coda della
   * fiscale, finendo dietro a un eventuale scontrino in corso.
   */
  async getStatus(): Promise<PrinterStatus> {
    const cached = this.statusCache
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status
    const status = await this.readStatus()
    this.statusCache = { at: Date.now(), status }
    return status
  }

  private async readStatus(): Promise<PrinterStatus> {
    const flags = await this.readFlags()
    try {
      const res = await this.submit([sf20.QUERY.status])
      return {
        online: res.ok,
        paperPresent: flags.paperPresent,
        coverClosed: flags.coverClosed,
        errorMessage: res.ok ? flags.errorMessage : describeFailure(res),
      }
    } catch (err: unknown) {
      return {
        online: false,
        paperPresent: flags.paperPresent,
        coverClosed: flags.coverClosed,
        errorMessage: err instanceof Error ? err.message : 'Errore sconosciuto',
      }
    }
  }

  /** Legge dalla stampante identità, tabella IVA e reparti programmati. */
  async probeConfig(): Promise<AxonProbe> {
    const res = await this.submit(sf20.buildProbe())
    const numbers = res.tags['CMD_d_DPT_NUMERO'] ?? []
    const descriptions = res.tags['CMD_d_DPT_DESCRIZIONE'] ?? []
    const vatCodes = res.tags['CMD_d_DPT_ALIQUOTAIVA'] ?? []

    const vatTable: Record<string, string> = {}
    for (const letter of VAT_LETTERS) vatTable[letter] = firstTag(res, `CMD_e_VAT_${letter}`)

    return {
      firmware: firstTag(res, 'CMD_v_ECR_VERSIONEFW'),
      serial: firstTag(res, 'CMD_a_ECR_MATRICOLA'),
      model: firstTag(res, 'CMD_a_ECR_CODICEMODELLO'),
      lastReceiptNumber: firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO'),
      vatTable,
      departments: numbers.map((number, i) => ({
        number,
        description: descriptions[i] ?? '',
        vatCode: vatCodes[i] ?? '',
      })),
    }
  }

  async printReceipt(data: ReceiptData): Promise<PrintResult> {
    // X/ e a/ accodati alla vendita: la stessa Response porta numero scontrino
    // e matricola, senza un secondo giro nella coda di stampa.
    const commands = [
      ...sf20.buildReceipt(data, this.operatorId),
      sf20.QUERY.lastDocuments,
      sf20.QUERY.identity,
    ]
    return toPrintResult(await this.submit(commands))
  }

  async dailyClose(operatorId: string): Promise<PrintResult> {
    const commands = [
      ...sf20.buildDailyClose(operatorId || this.operatorId),
      sf20.QUERY.lastClosure,
      sf20.QUERY.identity,
    ]
    return toPrintResult(await this.submit(commands))
  }

  async openDrawer(operatorId: string): Promise<void> {
    const res = await this.submit(sf20.buildOpenDrawer(operatorId || this.operatorId))
    if (!res.ok) throw new Error(describeFailure(res))
  }
}
```

- [ ] **Step 4: Registra il driver**

In `src/main/drivers/registry.ts`, aggiungi l'import e la voce nella mappa:

```typescript
import { AxonFpidDriver } from './axon-fpid'
```

```typescript
  'axon-fpid': () => new AxonFpidDriver(),
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `npx vitest run src/main/drivers/axon-fpid.test.ts`
Expected: PASS, 13 test.

Se il test "serializza i job" risulta instabile, la causa è nel finto server, non nel driver: `serveOnce` deve completare il primo job prima di cercare il secondo. Non aggiungere ritardi nel driver per farlo passare.

- [ ] **Step 6: Esegui l'intera suite**

Run: `npm test`
Expected: PASS, nessuna regressione sugli altri driver.

- [ ] **Step 7: Lint e commit**

```bash
npm run lint
git add src/main/drivers/axon-fpid.ts src/main/drivers/axon-fpid.test.ts src/main/drivers/registry.ts
git commit -m "feat(drivers): driver axon-fpid su cartella di ascolto axonFPiD"
```

---

### Task 5: UI di configurazione — modo `spool`

**Files:**
- Modify: `src/main/index.ts` (nuovo handler `dialog:pick-folder`)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/renderer/src/components/ConnectionForm.tsx`
- Modify: `src/renderer/src/components/PrinterCard.tsx:18,161`

**Interfaces:**
- Consumes: `PrinterConnection.spoolDir`/`logDir` (Task 1); driver `axon-fpid` registrato (Task 4).
- Produces: `window.bridge.pickFolder(): Promise<string | null>`; `ConnectionForm` accetta `mode="spool"`.

- [ ] **Step 1: Aggiungi l'handler IPC per la scelta cartella**

In `src/main/index.ts`, aggiungi `dialog` all'import da `electron`:

```typescript
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } from 'electron'
```

e accanto agli altri `ipcMain.handle`:

```typescript
// Selettore di cartella per il driver axon-fpid (cartella di ascolto e LOG)
ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
```

- [ ] **Step 2: Esponi l'API nel preload**

In `src/preload/index.ts`, aggiungi alla mappa dell'API:

```typescript
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
```

- [ ] **Step 3: Dichiara il tipo nel renderer**

In `src/renderer/src/env.d.ts`, dentro l'interfaccia di `window.bridge`:

```typescript
    pickFolder(): Promise<string | null>
```

- [ ] **Step 4: Aggiungi il modo `spool` a `ConnectionForm`**

In `src/renderer/src/components/ConnectionForm.tsx`, estendi l'interfaccia locale e la prop `mode`:

```typescript
interface Connection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
  spoolDir?: string
  logDir?: string
}
```

```typescript
  mode?: 'network' | 'system' | 'spool'
```

Aggiungi il gestore, sopra il `return`:

```typescript
  const pickInto = async (field: 'spoolDir' | 'logDir') => {
    const folder = await window.bridge.pickFolder()
    if (folder) onChange({ ...value, [field]: folder })
  }
```

Sostituisci la condizione del ramo di rendering `mode === 'system' ? (…) : (…)` con una catena a tre, inserendo il ramo `spool` prima di quello di rete:

```tsx
      {mode === 'spool' ? (
        <div className="flex flex-col gap-2 mb-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Cartella di ascolto (Server di Stampa)
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="C:\axonFPiD_Pro_v7\Spool"
                value={value.spoolDir ?? ''}
                onChange={(e) => onChange({ ...value, spoolDir: e.target.value })}
              />
              <button
                className="text-sm px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                onClick={() => pickInto('spoolDir')}
              >
                Sfoglia
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Cartella LOG e file di risposta
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="C:\axonFPiD_Pro_v7\Log"
                value={value.logDir ?? ''}
                onChange={(e) => onChange({ ...value, logDir: e.target.value })}
              />
              <button
                className="text-sm px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                onClick={() => pickInto('logDir')}
              >
                Sfoglia
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Se vuota si usa la cartella di ascolto. Deve avere RESPONSE XML attivo in axonFPiD.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Timeout (ms)</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="30000"
              type="number"
              value={value.timeout}
              onChange={(e) => onChange({ ...value, timeout: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : mode === 'system' ? (
```

- [ ] **Step 5: Collega il driver in `PrinterCard`**

In `src/renderer/src/components/PrinterCard.tsx` riga 18, aggiungi il driver al ruolo fiscale:

```typescript
  fiscal: ['epson-fpmate', 'ditron-keycode', 'ditron-streamwec', 'axon-fpid'],
```

e alla riga 161 sostituisci la scelta del modo:

```tsx
        mode={
          printer.driver === 'os-printer'
            ? 'system'
            : printer.driver === 'axon-fpid'
              ? 'spool'
              : 'network'
        }
```

- [ ] **Step 6: Verifica compilazione e lint**

Run: `npm run build && npm run lint`
Expected: build senza errori TypeScript, lint pulito.

- [ ] **Step 7: Verifica manuale nella UI**

Run: `npm run dev`
Verifica: creando una stampante di ruolo Fiscale, `axon-fpid` compare nel selettore driver; selezionandolo appaiono i due campi cartella con il pulsante Sfoglia; il salvataggio persiste i percorsi (riapri la finestra di configurazione e controlla).

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts \
        src/renderer/src/components/ConnectionForm.tsx \
        src/renderer/src/components/PrinterCard.tsx
git commit -m "feat(ui): configurazione cartelle spool e log per axon-fpid"
```

---

### Task 6: Sonda di configurazione

**Files:**
- Modify: `src/main/index.ts` (handler `driver:probe`)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Create: `src/renderer/src/components/AxonProbePanel.tsx`
- Modify: `src/renderer/src/components/PrinterCard.tsx`

**Interfaces:**
- Consumes: `AxonFpidDriver.probeConfig()`, `deptMappingFromProbe`, tipi `AxonProbe`/`AxonDepartment` (Task 4).
- Produces: `window.bridge.probePrinter(printerId: string): Promise<AxonProbe>`; componente `AxonProbePanel`.

- [ ] **Step 1: Aggiungi l'handler IPC**

In `src/main/index.ts`, accanto agli altri `ipcMain.handle`:

```typescript
// Sonda di configurazione: canale separato da driver:test, che restituisce
// sempre un PrinterStatus mentre qui la struttura di ritorno è diversa.
ipcMain.handle('driver:probe', async (_e, printerId: string) => {
  const driver = drivers.get(printerId)
  if (!driver) throw new Error(`Driver not found: ${printerId}`)
  const probe = (driver as { probeConfig?: () => Promise<unknown> }).probeConfig
  if (typeof probe !== 'function') {
    throw new Error('Questo driver non supporta la sonda di configurazione')
  }
  const result = await probe.call(driver)
  emitLog(`Sonda di configurazione eseguita [${printerId}]`)
  return result
})
```

- [ ] **Step 2: Esponi l'API nel preload**

In `src/preload/index.ts`:

```typescript
  probePrinter: (printerId: string) => ipcRenderer.invoke('driver:probe', printerId),
```

- [ ] **Step 3: Dichiara il tipo nel renderer**

In `src/renderer/src/env.d.ts`, dentro l'interfaccia di `window.bridge`:

```typescript
    probePrinter(printerId: string): Promise<import('../../main/drivers/axon-fpid').AxonProbe>
```

- [ ] **Step 4: Crea il pannello**

Crea `src/renderer/src/components/AxonProbePanel.tsx`:

```tsx
import React, { useState } from 'react'
import { deptMappingFromProbe } from '../../../main/drivers/axon-fpid'
import type { AxonProbe } from '../../../main/drivers/axon-fpid'

interface Props {
  printerId: string
  onApplyDeptMapping: (mapping: Record<string, number>) => void
}

export function AxonProbePanel({ printerId, onApplyDeptMapping }: Props) {
  const [running, setRunning] = useState(false)
  const [probe, setProbe] = useState<AxonProbe | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      setProbe(await window.bridge.probePrinter(printerId))
    } catch (err) {
      setProbe(null)
      setError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setRunning(false)
    }
  }

  const configured = probe?.departments.filter((d) => d.description.trim() !== '') ?? []

  return (
    <div className="mb-4 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-2">
        <button
          className="text-sm px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
          onClick={run}
          disabled={running}
        >
          {running ? 'Lettura…' : 'Sonda configurazione'}
        </button>
        <span className="text-xs text-gray-500">
          Legge dalla stampante aliquote IVA e reparti programmati
        </span>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {probe && (
        <div className="mt-3 text-xs text-gray-700">
          <p>
            <strong>{probe.model || 'RT'}</strong> · matricola {probe.serial || '—'} · FW{' '}
            {probe.firmware || '—'} · ultimo scontrino {probe.lastReceiptNumber || '—'}
          </p>

          <p className="mt-2">
            Aliquote IVA:{' '}
            {Object.entries(probe.vatTable)
              .map(([letter, rate]) => `${letter}=${rate || '—'}%`)
              .join('  ')}
          </p>

          <p className="mt-2">Reparti programmati: {configured.length}</p>
          {configured.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
              {configured.map((d) => (
                <li key={d.number}>
                  {d.number} — {d.description} (IVA {d.vatCode})
                </li>
              ))}
            </ul>
          )}

          <button
            className="mt-2 text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => onApplyDeptMapping(deptMappingFromProbe(probe))}
          >
            Applica a mappatura reparti
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Innesta il pannello in `PrinterCard`**

In `src/renderer/src/components/PrinterCard.tsx`, aggiungi l'import:

```typescript
import { AxonProbePanel } from './AxonProbePanel'
```

e inserisci il pannello subito prima del componente `DeptMapping` già presente nel JSX:

```tsx
      {printer.driver === 'axon-fpid' && (
        <AxonProbePanel
          printerId={printer.id}
          onApplyDeptMapping={(deptMapping) => onChange({ ...printer, deptMapping })}
        />
      )}
```

- [ ] **Step 6: Verifica compilazione, lint e suite**

Run: `npm run build && npm run lint && npm test`
Expected: tutto verde.

`deptMappingFromProbe` è una funzione pura importata dal main nel renderer — è lo stesso schema già usato per i tipi di `main/config` e `main/drivers/interface` in `PrinterCard.tsx`. Se il bundler del renderer si lamenta dell'import di un modulo che tira dentro `node:fs`, sposta `deptMappingFromProbe` e i tipi `AxonProbe`/`AxonDepartment` in un file nuovo `src/main/printing/axon-probe.ts` (nessuna dipendenza da `node:`), reimportandoli sia da `axon-fpid.ts` sia dal pannello; aggiorna in tal caso anche il test del Task 4.

- [ ] **Step 7: Verifica manuale**

Run: `npm run dev`
Verifica: con un driver `axon-fpid` configurato, il pulsante "Sonda configurazione" compare; senza axonFPiD in ascolto restituisce il messaggio diagnostico del Server di Stampa non attivo (non un errore generico).

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts \
        src/renderer/src/components/AxonProbePanel.tsx \
        src/renderer/src/components/PrinterCard.tsx
git commit -m "feat(ui): sonda di configurazione axon-fpid con auto-compilazione reparti"
```

---

### Task 7: Documentazione operativa

**Files:**
- Create: `docs/axon-fpid-setup.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: tutto quanto costruito nei task precedenti.
- Produces: la checklist che guida la sessione presso il cliente.

- [ ] **Step 1: Scrivi la guida di installazione**

Crea `docs/axon-fpid-setup.md`:

````markdown
# Collegamento stampante fiscale via axonFPiD_Pro_v7 (`axon-fpid`)

Il driver `axon-fpid` non parla con la stampante: scambia file con il **Server di
Stampa** di axonFPiD_Pro_v7, che a sua volta pilota la RT.

```
POS → bridge → <spool>/job.txt → axonFPiD → RT
                <log>/Response_job.xml ←
```

## 1. axonFPiD_Pro_v7

Installare l'applicazione sul PC POS (default `C:\axonFPiD_Pro_v7`).

**Connessione Stampante** — Ethernet TCPIP, IP della RT, porta 9101 (oppure
RS232 / USB virtual COM a 115200 baud). Sulla stampante, menù Ethernet,
selezionare TCPIP.

**Server di Stampa**
- Cartella di ascolto: una cartella dedicata, es. `C:\axonFPiD_Pro_v7\Spool`
- Nome file: `*`
- Estensione: `TXT`
- ESTENSIONI NON UTILIZZABILI: **aggiungere `TMP`**

Il bridge scrive `job.tmp` e poi lo rinomina in `job.txt`: il rename è atomico ed
evita che axonFPiD legga un file ancora incompleto. Escludere `TMP` è la difesa
di riserva.

**LOG e file di risposta**
- Cartella LOG: es. `C:\axonFPiD_Pro_v7\Log`
- **RESPONSE XML: attivo** — obbligatorio, senza questo ogni stampa va in timeout
- Attivare anche i file flag: Fine Carta, Sportello, Errore Grave, Display

**Modalità Esecuzione FPiD**: `Minimized` o `Iconized`, così l'app resta attiva
in tray. Su Windows 10/11 avviarla da Utilità di Pianificazione, non
dall'Esecuzione Automatica (indicazione dello stesso manuale A.P.esse).

## 2. Stampante

Portare la RT in modalità **EMISSIONE RICEVUTA**: la tastiera è protetta e
l'apparecchio accetta comandi di vendita solo da PC.

## 3. Bridge

Configurazione stampante → ruolo **Fiscale** → driver **axon-fpid**.
Impostare cartella di ascolto e cartella LOG (pulsante Sfoglia), timeout 30000 ms.

Premere **Testa connessione**. Il messaggio d'errore distingue i casi:

| Messaggio | Causa |
|---|---|
| "Server di Stampa non attivo, o cartella di ascolto errata" | il file resta nello spool: axonFPiD non è in esecuzione o guarda un'altra cartella |
| "Nessun Response XML … NON ristampare" | il file è stato prelevato ma non torna risposta: RESPONSE XML disattivato o cartella LOG sbagliata |

## 4. Sonda di configurazione

Premere **Sonda configurazione**. Legge dalla stampante versione FW, matricola,
tabella delle aliquote IVA e i 60 reparti con la rispettiva aliquota.

Premere **Applica a mappatura reparti** per generare `deptMapping` dalla
configurazione reale della RT.

Non compilare la mappatura a mano: la corrispondenza aliquota↔reparto dipende da
come la stampante è stata programmata e varia da installazione a installazione.

## 5. Ricavare i comandi SF20 di vendita

**Questo passo è quello che sblocca la stampa degli scontrini.** Finché non è
fatto, `/print`, `/daily-close` e `/open-drawer` rispondono con un errore che
rimanda a questa sezione.

In axonFPiD_Pro_v7:

1. **Pannello del Tecnico → Stampa Scontrini di test.** La finestra mostra a
   sinistra i comandi SF20 dello scontrino di esempio selezionato e a destra
   l'anteprima di stampa. Serve almeno il primo esempio: una vendita a reparto
   più la chiusura con un pagamento.
2. Fotografare o trascrivere i comandi.
3. Facoltativo ma utile: **Invia Comandi SF20 o File TXT** permette di inviare
   un singolo comando e leggerne la risposta, per validare la sintassi prima di
   scriverla nel codice.

Le informazioni da ricavare:

| Operazione | Cosa serve |
|---|---|
| Riga di vendita | comando, campi reparto / prezzo / quantità / descrizione |
| Sconto | comando e se si applica a riga o a subtotale |
| Subtotale | comando |
| Pagamento e chiusura | comando, codice pagamento, gestione dell'importo parziale per lo split |
| Chiusura giornaliera | comando di azzeramento Z1 |
| Apertura cassetto | comando |

Codici di pagamento programmati di fabbrica sull'SF20 (`sf20.txt`):
1 Contante, 2 Crediti (non riscosso), 3 Ticket, 4 Bancomat, 5 Carta di credito,
6-10 programmabili. Da confermare con `{/x/` o con la stampa "lista pagamenti".

4. Completare `buildReceipt`, `buildDailyClose` e `buildOpenDrawer` in
   `src/main/printing/sf20.ts`, sostituendo il lancio di
   `Sf20CommandUnavailableError`, e aggiungere i test corrispondenti in
   `src/main/printing/sf20.test.ts`.

## 6. Collaudo

- Verifica accenti: stampare una descrizione con `à è ì ò ù`. Il bridge scrive i
  file in CP1252; se i caratteri risultano errati, cambiare l'encoding in
  `submitNow` (`src/main/drivers/axon-fpid.ts`).
- Verifica del nome della Response: alla prima stampa riuscita controllare se
  axonFPiD ha scritto `Response_<job>.xml` o `Response_<job>.txt.xml`. Il driver
  gestisce entrambe le forme; una volta accertata quella vera si può rimuovere
  l'altra dal polling.
- Scontrino di prova da 0,01 € con il pulsante di test fiscale della UI.
````

- [ ] **Step 2: Aggiorna `CLAUDE.md`**

Nella sezione "Registered drivers", aggiungi in fondo alla lista:

```markdown
- `axon-fpid` — stampanti fiscali RT pilotate da **axonFPiD_Pro_v7** (A.P.esse): il driver non parla con la stampante ma deposita file di comandi **SF20** nella cartella di ascolto del Server di Stampa e legge `Response_<job>.xml` dalla cartella LOG (`fiscal-receipt`, `daily-close`, `drawer`). Scrittura `.tmp` + rename atomico, coda seriale, timeout diagnostico a tre esiti. **La sintassi SF20 di vendita non è documentata da nessuna fonte disponibile**: `printing/sf20.ts` la isola dietro `Sf20CommandUnavailableError` — vedi `docs/axon-fpid-setup.md`. La sonda (`driver:probe`) legge tabella IVA e reparti dalla RT per generare `deptMapping`.
```

Nella sezione "Config schema", dopo la descrizione di `connection.deviceName`, aggiungi:

```markdown
`connection.spoolDir` / `connection.logDir` (cartella di ascolto e cartella LOG di axonFPiD, richieste da `axon-fpid`).
```

Nella sezione "Notes", aggiungi alla lista dei file di reverse engineering:

```markdown
- `axonfpid_pro_v7.txt` e `sf20.txt` sono i manuali A.P.esse / Micrelec usati per il driver `axon-fpid` — non fanno parte della build.
```

- [ ] **Step 3: Verifica finale**

Run: `npm run lint && npm test && npm run build`
Expected: tutto verde.

- [ ] **Step 4: Commit**

```bash
git add docs/axon-fpid-setup.md CLAUDE.md
git commit -m "docs: guida di installazione axon-fpid e procedura per i comandi SF20"
```

---

## Stato dopo il piano

Il driver è completo, registrato, testato e configurabile. Restano **tre funzioni
in `src/main/printing/sf20.ts`** che lanciano `Sf20CommandUnavailableError`
finché non arrivano i comandi di vendita dal Pannello del Tecnico. Tutto il resto
— trasporto, diagnostica, stato, sonda, UI — è verificato e funzionante.
