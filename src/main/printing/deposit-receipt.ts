// src/main/printing/deposit-receipt.ts
// Ricevuta di acconto (POST /print-deposit): validazione della richiesta e
// impaginazione, in due forme:
//   - scontrino  → NonFiscalDoc, una per copia, come buildCourtesyDoc
//   - etichetta  → LabelLayout a elementi 'static' + 'barcode' sulla carta della
//                  stampante etichette, quindi stampabile da HTML, ZPL e raster
//                  ESC/POS senza un motore dedicato
// Il gestionale manda i numeri già calcolati: qui si formattano, mai si ricalcolano.
// Nessuna dipendenza da rete/driver/Electron → testabile in isolamento.
import type {
  LabelElement,
  LabelLayout,
  NonFiscalDoc,
  NonFiscalLine,
  PaperConfig,
} from '../drivers/interface'
import { assertPrintableBarcode } from './barcode'
import { resolvePaper } from './label-template'

export type DepositFormat = 'receipt' | 'label'

export interface DepositData {
  header: string[]
  orderNumber: string
  /** Vuoto = niente barcode. */
  barcode: string
  customerName: string
  customerPhone: string
  depositDate: string
  depositMethod: string
  total: number
  paid: number
  remaining: number
  /** Parte di `paid` pagata con gift card; assente = nessuna riga "di cui gift card". */
  giftCardAmount?: number
}

export interface DepositRequest {
  format: DepositFormat
  printerId?: string
  copyLabels: string[]
  data: DepositData
}

export const MAX_DEPOSIT_COPIES = 5

// Colonne del documento: 32 è la riga più stretta fra le stampanti supportate
// (carta 58mm, axonFPiD che tronca a 32). Su carta 80mm la ricevuta resta
// allineata a sinistra di qualche colonna, ma non va mai a capo in modo diverso
// da stampante a stampante.
export const RECEIPT_COLS = 32

/** `€ 1.234,56`: separatore delle migliaia, due decimali, virgola. */
export function formatEur(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}€ ${grouped},${dec}`
}

// --- Validazione -----------------------------------------------------------

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32 || c === 127) return true
  }
  return false
}

type Parsed = { ok: true; request: DepositRequest } | { ok: false; error: string }

/**
 * Valida il corpo di /print-deposit e lo normalizza (trim, default).
 * Gli errori iniziano col nome del campo, come chiede il contratto.
 */
export function parseDepositRequest(body: unknown): Parsed {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const fail = (error: string): Parsed => ({ ok: false, error })

  const requiredText = (field: string): string | Parsed => {
    const v = b[field]
    if (typeof v !== 'string' || v.trim() === '') return fail(`${field} (stringa non vuota) è obbligatorio`)
    if (hasControlChars(v)) return fail(`${field} contiene caratteri di controllo`)
    return v.trim()
  }
  const optionalText = (field: string): string | Parsed => {
    const v = b[field]
    if (v === undefined || v === null) return ''
    if (typeof v !== 'string') return fail(`${field} deve essere una stringa`)
    if (hasControlChars(v)) return fail(`${field} contiene caratteri di controllo`)
    return v.trim()
  }
  const amount = (field: string): number | Parsed => {
    const v = b[field]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return fail(`${field} (numero finito ≥ 0) è obbligatorio`)
    }
    return v
  }

  if (b.format !== 'receipt' && b.format !== 'label') {
    return fail("format deve essere 'receipt' o 'label'")
  }
  const format = b.format

  if (b.printerId !== undefined && b.printerId !== null && typeof b.printerId !== 'string') {
    return fail('printerId deve essere una stringa')
  }
  const printerId = typeof b.printerId === 'string' && b.printerId !== '' ? b.printerId : undefined

  const copies = b.copyLabels
  if (!Array.isArray(copies) || copies.length === 0) {
    return fail('copyLabels (array di stringhe non vuoto) è obbligatorio')
  }
  if (copies.length > MAX_DEPOSIT_COPIES) {
    return fail(`copyLabels ammette al massimo ${MAX_DEPOSIT_COPIES} voci`)
  }
  if (!copies.every((c) => typeof c === 'string' && c.trim() !== '' && !hasControlChars(c))) {
    return fail('copyLabels deve contenere stringhe non vuote, senza caratteri di controllo')
  }

  let header: string[] = []
  if (b.header !== undefined && b.header !== null) {
    if (!Array.isArray(b.header) || !b.header.every((h) => typeof h === 'string')) {
      return fail('header deve essere un array di stringhe')
    }
    if (b.header.some((h) => hasControlChars(h as string))) {
      return fail('header contiene caratteri di controllo')
    }
    header = (b.header as string[]).map((h) => h.trim()).filter((h) => h !== '')
  }

  const fields: Record<string, string> = {}
  for (const f of ['orderNumber', 'customerName', 'customerPhone', 'depositDate']) {
    const r = requiredText(f)
    if (typeof r !== 'string') return r
    fields[f] = r
  }
  for (const f of ['barcode', 'depositMethod']) {
    const r = optionalText(f)
    if (typeof r !== 'string') return r
    fields[f] = r
  }
  if (fields.barcode !== '') {
    try {
      assertPrintableBarcode(fields.barcode)
    } catch (err: unknown) {
      return fail(`barcode: ${err instanceof Error ? err.message : 'non stampabile'}`)
    }
  }

  const nums: Record<string, number> = {}
  for (const f of ['total', 'paid', 'remaining']) {
    const r = amount(f)
    if (typeof r !== 'number') return r
    nums[f] = r
  }

  let giftCardAmount: number | undefined
  const gc = b.giftCardAmount
  if (gc !== undefined && gc !== null) {
    if (typeof gc !== 'number' || !Number.isFinite(gc) || gc <= 0) {
      return fail('giftCardAmount deve essere un numero finito > 0')
    }
    giftCardAmount = gc
  }

  return {
    ok: true,
    request: {
      format,
      printerId,
      copyLabels: (copies as string[]).map((c) => c.trim()),
      data: {
        header,
        orderNumber: fields.orderNumber,
        barcode: fields.barcode,
        customerName: fields.customerName,
        customerPhone: fields.customerPhone,
        depositDate: fields.depositDate,
        depositMethod: fields.depositMethod,
        total: nums.total,
        paid: nums.paid,
        remaining: nums.remaining,
        giftCardAmount,
      },
    },
  }
}

// --- Scontrino -------------------------------------------------------------

/** Spezza il testo in righe di al massimo `cols` caratteri, sugli spazi quando può. */
export function wrapText(text: string, cols = RECEIPT_COLS): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    if (line && line.length + 1 + w.length <= cols) {
      line += ' ' + w
      continue
    }
    if (line) out.push(line)
    while (w.length > cols) {
      out.push(w.slice(0, cols))
      w = w.slice(cols)
    }
    line = w
  }
  if (line) out.push(line)
  return out.length > 0 ? out : ['']
}

/**
 * Riga "etichetta ........ valore" su RECEIPT_COLS colonne. Se non entra, il
 * valore va a capo sotto l'etichetta: nessun driver tronca un nome o un telefono.
 */
function field(label: string, value: string, bold = false): NonFiscalLine[] {
  const gap = RECEIPT_COLS - label.length - value.length
  if (gap >= 1) return [{ text: label + ' '.repeat(gap) + value, bold }]
  return [{ text: label, bold }, ...wrapText(value).map((text) => ({ text, bold, align: 'right' as const }))]
}

// In doppia dimensione ESC/POS raddoppia anche la larghezza: sulla carta da 58mm
// ci stanno 16 caratteri. Un testo più lungo andrebbe a capo a metà parola, quindi
// scende a grassetto normale (succede al titolo intero e ai numeri d'ordine lunghi).
const DOUBLE_COLS = RECEIPT_COLS / 2

function big(text: string): NonFiscalLine {
  return text.length <= DOUBLE_COLS
    ? { text, bold: true, size: 'double', align: 'center' }
    : { text, bold: true, align: 'center' }
}

/** Una copia della ricevuta, chiusa dal taglio. */
export function buildDepositDoc(data: DepositData, copyLabel: string): NonFiscalDoc {
  const lines: NonFiscalLine[] = []
  const blank = (): void => {
    lines.push({ text: '' })
  }

  if (data.header.length > 0) {
    for (const h of data.header) for (const text of wrapText(h)) lines.push({ text, align: 'center' })
    blank()
  }

  // Su due righe: "RICEVUTA DI ACCONTO" non sta nelle 16 colonne della doppia.
  lines.push(big('RICEVUTA'), big('DI ACCONTO'))
  blank()

  // Il barcode codifica il numero d'ordine. Chi non sa stamparlo stampa `text`:
  // il numero d'ordine in doppia altezza, che resta leggibile al banco.
  if (data.barcode) {
    lines.push({ ...big(data.orderNumber), barcode: data.barcode })
    blank()
  }

  lines.push(...field('Ordine', data.orderNumber))
  lines.push(...field('Cliente', data.customerName))
  lines.push(...field('Telefono', data.customerPhone))
  lines.push(...field('Acconto del', data.depositDate))
  if (data.depositMethod) lines.push(...field('Metodo', data.depositMethod))
  blank()

  lines.push(...field('Totale ordine', formatEur(data.total)))
  lines.push(...field('Versato', formatEur(data.paid)))
  if (data.giftCardAmount !== undefined) {
    lines.push(...field('  di cui gift card', formatEur(data.giftCardAmount)))
  }
  blank()
  // Il residuo è la riga che conta: etichetta sopra, importo in doppia sotto.
  lines.push({ text: 'Da saldare', bold: true, align: 'center' }, big(formatEur(data.remaining)))
  blank()

  lines.push({ text: copyLabel, bold: true, align: 'center' })
  return { lines, cut: true }
}

// --- Etichetta ---------------------------------------------------------------

type RowKind = 'text' | 'pair' | 'barcode'

interface Row {
  kind: RowKind
  /** Più basso = tolto prima quando la carta non basta. Infinity = non si toglie mai. */
  priority: number
  /** Moltiplicatore del corpo base (titolo, residuo più grandi). */
  scale: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  text?: string
  value?: string
}

const LABEL_MAX_FONT_MM = 4
// Sotto questo corpo si tolgono righe facoltative. Con le sole righe obbligatorie
// il corpo può scendere oltre: su una carta minuscola un testo piccolo è meglio
// di un importo che esce dall'etichetta.
const LABEL_MIN_FONT_MM = 2.2
const ROW_PITCH = 1.25
const BARCODE_MIN_MM = 6
const BARCODE_MAX_MM = 10
// Respiro sotto le barre: la riga successiva non deve toccare il barcode.
const BARCODE_GAP_MM = 1

function depositRows(data: DepositData, copyLabel: string): Row[] {
  const KEEP = Number.POSITIVE_INFINITY
  const rows: Row[] = []
  // Intestazione e metodo sono i primi a sparire sulle carte piccole (50×30);
  // nome, telefono, numero d'ordine, i tre importi e la copia restano sempre.
  for (const h of data.header) rows.push({ kind: 'text', priority: 1, scale: 0.8, align: 'center', text: h })
  rows.push({ kind: 'text', priority: 6, scale: 1.1, bold: true, align: 'center', text: 'RICEVUTA DI ACCONTO' })
  if (data.barcode) rows.push({ kind: 'barcode', priority: 3, scale: 1, text: data.barcode })
  rows.push({ kind: 'pair', priority: KEEP, scale: 1, text: 'Ordine', value: data.orderNumber, bold: true })
  rows.push({ kind: 'pair', priority: KEEP, scale: 1, text: 'Cliente', value: data.customerName })
  rows.push({ kind: 'pair', priority: KEEP, scale: 1, text: 'Telefono', value: data.customerPhone })
  rows.push({ kind: 'pair', priority: 5, scale: 1, text: 'Acconto del', value: data.depositDate })
  if (data.depositMethod) rows.push({ kind: 'pair', priority: 2, scale: 1, text: 'Metodo', value: data.depositMethod })
  rows.push({ kind: 'pair', priority: KEEP, scale: 1, text: 'Totale ordine', value: formatEur(data.total) })
  rows.push({ kind: 'pair', priority: KEEP, scale: 1, text: 'Versato', value: formatEur(data.paid) })
  if (data.giftCardAmount !== undefined) {
    rows.push({ kind: 'pair', priority: 4, scale: 0.9, text: 'di cui gift card', value: formatEur(data.giftCardAmount) })
  }
  rows.push({ kind: 'pair', priority: KEEP, scale: 1.2, bold: true, text: 'Da saldare', value: formatEur(data.remaining) })
  rows.push({ kind: 'text', priority: KEEP, scale: 0.9, bold: true, align: 'center', text: copyLabel })
  return rows
}

/** Corpo base che fa entrare le righe nell'altezza utile, col barcode a misura fissa. */
function baseFont(rows: Row[], innerH: number): { font: number; barcodeH: number } {
  const textUnits = rows.filter((r) => r.kind !== 'barcode').reduce((s, r) => s + r.scale * ROW_PITCH, 0)
  const hasBarcode = rows.some((r) => r.kind === 'barcode')
  // Il barcode prende una fetta proporzionale, dentro i limiti di leggibilità.
  const barcodeH = hasBarcode ? Math.min(BARCODE_MAX_MM, Math.max(BARCODE_MIN_MM, innerH * 0.22)) : 0
  const reserved = hasBarcode ? barcodeH + BARCODE_GAP_MM : 0
  const font = textUnits > 0 ? (innerH - reserved) / textUnits : LABEL_MAX_FONT_MM
  return { font: Math.min(LABEL_MAX_FONT_MM, font), barcodeH }
}

/**
 * Layout dell'etichetta di acconto sulla carta della stampante etichette.
 * Righe impilate dall'alto; se il corpo scenderebbe sotto LABEL_MIN_FONT_MM si
 * tolgono le righe meno importanti (intestazione, metodo, barcode, gift card,
 * data, titolo, in quest'ordine) finché il resto entra.
 */
export function buildDepositLabelLayout(
  data: DepositData,
  copyLabel: string,
  paperConfig: PaperConfig
): LabelLayout {
  const paper = resolvePaper(paperConfig)
  let rows = depositRows(data, copyLabel)
  let fit = baseFont(rows, paper.innerH)
  while (fit.font < LABEL_MIN_FONT_MM) {
    const droppable = rows.filter((r) => Number.isFinite(r.priority))
    if (droppable.length === 0) break
    const lowest = Math.min(...droppable.map((r) => r.priority))
    // Le righe d'intestazione hanno la stessa priorità e se ne vanno insieme.
    rows = rows.filter((r) => r.priority !== lowest)
    fit = baseFont(rows, paper.innerH)
  }
  const font = fit.font

  const x = paper.margins.left
  const w = paper.innerW
  const elements: LabelElement[] = []
  let y = paper.margins.top
  rows.forEach((r, i) => {
    if (r.kind === 'barcode') {
      elements.push({
        id: `deposit-${i}`,
        type: 'barcode',
        xMm: x,
        yMm: y,
        wMm: w,
        hMm: fit.barcodeH,
        align: 'center',
        // Il numero d'ordine è già scritto nella riga "Ordine": niente cifre sotto.
        showHri: false,
        text: r.text,
      })
      y += fit.barcodeH + BARCODE_GAP_MM
      return
    }
    const fontMm = font * r.scale
    const h = fontMm * ROW_PITCH
    const common = { yMm: y, hMm: h, fontMm, bold: r.bold === true, maxLines: 1, autoFit: true, minFontMm: 1 }
    if (r.kind === 'text') {
      elements.push({ id: `deposit-${i}`, type: 'static', xMm: x, wMm: w, align: r.align ?? 'left', text: r.text, ...common })
    } else {
      // Etichetta a sinistra, valore a destra; il valore ha più spazio perché è
      // lui a dover restare intero (nome lungo, importi a quattro cifre).
      const labelW = w * 0.42
      elements.push({ id: `deposit-${i}-k`, type: 'static', xMm: x, wMm: labelW, align: 'left', text: r.text, ...common })
      elements.push({
        id: `deposit-${i}-v`,
        type: 'static',
        xMm: x + labelW,
        wMm: w - labelW,
        align: 'right',
        text: r.value,
        ...common,
      })
    }
    y += h
  })

  return {
    paper: paperConfig,
    template: { version: 2, fontScale: 1, elements },
  }
}
