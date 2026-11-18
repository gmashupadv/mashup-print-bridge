import { describe, it, expect } from 'vitest'
import {
  buildDepositDoc,
  buildDepositLabelLayout,
  formatEur,
  parseDepositRequest,
  wrapText,
  RECEIPT_COLS,
  type DepositData,
} from './deposit-receipt'
import { renderLabelHtml } from './label-renderer'
import { buildLabelZpl } from './zpl'
import { DEFAULT_LABEL_PAPER } from './defaults'

const body = {
  format: 'receipt',
  copyLabels: ['Copia cliente', 'Copia negozio'],
  header: ['Sneakers Area Srl', 'Via Roma 1', '80100 Napoli (NA)', 'P.Iva 01234567890'],
  orderNumber: 'POS-1234',
  barcode: 'POS-1234',
  customerName: 'Mario Rossi',
  customerPhone: '333 1234567',
  depositDate: '18/11/2026 15:42',
  depositMethod: 'Contanti',
  total: 250,
  paid: 80,
  remaining: 170,
}

function data(over: Partial<DepositData> = {}): DepositData {
  const parsed = parseDepositRequest(body)
  if (!parsed.ok) throw new Error(parsed.error)
  return { ...parsed.request.data, ...over }
}

const texts = (doc: { lines: { text: string }[] }): string[] => doc.lines.map((l) => l.text)

describe('formatEur', () => {
  it('formatta con migliaia, virgola e due decimali', () => {
    expect(formatEur(0)).toBe('€ 0,00')
    expect(formatEur(170)).toBe('€ 170,00')
    expect(formatEur(1234.5)).toBe('€ 1.234,50')
    expect(formatEur(1234567.891)).toBe('€ 1.234.567,89')
  })
})

describe('parseDepositRequest', () => {
  it('accetta il corpo del contratto e normalizza', () => {
    const r = parseDepositRequest({ ...body, customerName: '  Mario Rossi ', printerId: 'epson' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.format).toBe('receipt')
    expect(r.request.printerId).toBe('epson')
    expect(r.request.copyLabels).toEqual(['Copia cliente', 'Copia negozio'])
    expect(r.request.data.customerName).toBe('Mario Rossi')
    expect(r.request.data.giftCardAmount).toBeUndefined()
  })

  it('header e barcode e metodo sono facoltativi', () => {
    const r = parseDepositRequest({ ...body, header: undefined, barcode: undefined, depositMethod: undefined })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.data.header).toEqual([])
    expect(r.request.data.barcode).toBe('')
    expect(r.request.data.depositMethod).toBe('')
  })

  it.each([
    [{ format: 'pdf' }, 'format'],
    [{ format: undefined }, 'format'],
    [{ copyLabels: [] }, 'copyLabels'],
    [{ copyLabels: 'Copia cliente' }, 'copyLabels'],
    [{ copyLabels: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'copyLabels'],
    [{ copyLabels: ['ok', ''] }, 'copyLabels'],
    [{ orderNumber: '' }, 'orderNumber'],
    [{ customerName: '   ' }, 'customerName'],
    [{ customerPhone: undefined }, 'customerPhone'],
    [{ depositDate: 20261118 }, 'depositDate'],
    [{ total: '250' }, 'total'],
    [{ paid: -1 }, 'paid'],
    [{ remaining: Number.NaN }, 'remaining'],
    [{ giftCardAmount: 0 }, 'giftCardAmount'],
    [{ header: 'Negozio' }, 'header'],
    [{ header: ['ok\u001b@'] }, 'header'],
    [{ customerName: 'Mario\nRossi' }, 'customerName'],
    [{ barcode: 'POS\u00011' }, 'barcode'],
    [{ barcode: 'àèì' }, 'barcode'],
    [{ printerId: 3 }, 'printerId'],
  ])('rifiuta %j citando il campo', (over, fieldName) => {
    const r = parseDepositRequest({ ...body, ...over })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.startsWith(fieldName)).toBe(true)
  })

  it('giftCardAmount > 0 passa, null vale assente', () => {
    const a = parseDepositRequest({ ...body, giftCardAmount: 30 })
    expect(a.ok && a.request.data.giftCardAmount).toBe(30)
    const b = parseDepositRequest({ ...body, giftCardAmount: null })
    expect(b.ok && b.request.data.giftCardAmount).toBeUndefined()
  })

  it('corpo assente → errore sul primo campo, niente eccezione', () => {
    const r = parseDepositRequest(undefined)
    expect(r.ok).toBe(false)
  })
})

describe('wrapText', () => {
  it('va a capo sugli spazi e spezza le parole troppo lunghe', () => {
    expect(wrapText('uno due tre', 7)).toEqual(['uno due', 'tre'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('buildDepositDoc', () => {
  it('impagina intestazione, titolo, dati, importi e copia, con taglio', () => {
    const doc = buildDepositDoc(data(), 'Copia cliente')
    const t = texts(doc)
    expect(doc.cut).toBe(true)
    expect(t.slice(0, 4)).toEqual(body.header)
    expect(t).toContain('RICEVUTA')
    expect(t).toContain('DI ACCONTO')
    expect(t.some((l) => l.startsWith('Ordine') && l.endsWith('POS-1234'))).toBe(true)
    expect(t.some((l) => l.startsWith('Cliente') && l.endsWith('Mario Rossi'))).toBe(true)
    expect(t.some((l) => l.startsWith('Telefono') && l.endsWith('333 1234567'))).toBe(true)
    expect(t.some((l) => l.startsWith('Acconto del') && l.endsWith('18/11/2026 15:42'))).toBe(true)
    expect(t.some((l) => l.startsWith('Metodo') && l.endsWith('Contanti'))).toBe(true)
    expect(t.some((l) => l.startsWith('Totale ordine') && l.endsWith('€ 250,00'))).toBe(true)
    expect(t.some((l) => l.startsWith('Versato') && l.endsWith('€ 80,00'))).toBe(true)
    expect(t.at(-1)).toBe('Copia cliente')
  })

  it('il residuo è in grassetto e doppia altezza', () => {
    const doc = buildDepositDoc(data(), 'Copia negozio')
    const i = doc.lines.findIndex((l) => l.text === 'Da saldare')
    expect(doc.lines[i].bold).toBe(true)
    expect(doc.lines[i + 1]).toMatchObject({ text: '€ 170,00', bold: true, size: 'double' })
  })

  it('in doppia nessuna riga supera i 16 caratteri della carta da 58mm', () => {
    for (const remaining of [170, 12345.67]) {
      const doc = buildDepositDoc(data({ remaining, orderNumber: 'POS-2026-000001234' }), 'X')
      for (const l of doc.lines) if (l.size === 'double') expect(l.text.length).toBeLessThanOrEqual(16)
      expect(doc.lines.find((l) => l.text === formatEur(remaining))?.size).toBe('double')
    }
    // Numero d'ordine troppo lungo per la doppia: resta in grassetto normale.
    const doc = buildDepositDoc(data({ orderNumber: 'POS-2026-000001234' }), 'X')
    expect(doc.lines.find((l) => l.barcode)).toMatchObject({ text: 'POS-2026-000001234', bold: true })
    expect(doc.lines.find((l) => l.barcode)?.size).toBeUndefined()
  })

  it('le righe d intestazione lunghe vanno a capo a 32 colonne', () => {
    const doc = buildDepositDoc(data({ header: ['Sneakers Area Srl a socio unico — Centro Commerciale Vulcano Buono'] }), 'X')
    const head = doc.lines.slice(0, doc.lines.findIndex((l) => l.text === ''))
    expect(head.length).toBeGreaterThan(1)
    for (const l of head) expect(l.text.length).toBeLessThanOrEqual(RECEIPT_COLS)
  })

  it('la riga barcode porta il numero d ordine come ripiego leggibile', () => {
    const doc = buildDepositDoc(data(), 'Copia cliente')
    const bc = doc.lines.find((l) => l.barcode)
    expect(bc).toMatchObject({ barcode: 'POS-1234', text: 'POS-1234', size: 'double' })
  })

  it('senza barcode, header e metodo non stampa quelle righe', () => {
    const doc = buildDepositDoc(data({ barcode: '', header: [], depositMethod: '' }), 'X')
    expect(doc.lines.some((l) => l.barcode)).toBe(false)
    expect(doc.lines[0].text).toBe('RICEVUTA')
    expect(texts(doc).some((l) => l.startsWith('Metodo'))).toBe(false)
  })

  it('gift card: riga "di cui" subito sotto Versato', () => {
    const t = texts(buildDepositDoc(data({ giftCardAmount: 30 }), 'X'))
    const i = t.findIndex((l) => l.startsWith('Versato'))
    expect(t[i + 1].trim().startsWith('di cui gift card')).toBe(true)
    expect(t[i + 1].endsWith('€ 30,00')).toBe(true)
  })

  it('nessuna riga supera le colonne della carta più stretta (tranne header/titolo/doppie)', () => {
    const long = data({ customerName: 'Maria Assunta Esposito De Laurentiis Della Valle' })
    const doc = buildDepositDoc(long, 'Copia cliente')
    for (const l of doc.lines) {
      if (l.size === 'double' || l.align === 'center') continue
      expect(l.text.length).toBeLessThanOrEqual(RECEIPT_COLS)
    }
    // Il nome lungo non si perde: va a capo sotto l'etichetta.
    expect(texts(doc).join(' ')).toContain('Della Valle')
  })
})

describe('buildDepositLabelLayout', () => {
  const statics = (layout: ReturnType<typeof buildDepositLabelLayout>): string[] =>
    (layout.template.elements ?? []).filter((e) => e.type === 'static').map((e) => e.text ?? '')

  const REQUIRED = ['Mario Rossi', '333 1234567', 'POS-1234', '€ 250,00', '€ 80,00', '€ 170,00', 'Copia cliente']

  it('su 50×30 tiene i campi obbligatori e toglie intestazione e metodo', () => {
    const layout = buildDepositLabelLayout(data({ giftCardAmount: 30 }), 'Copia cliente', DEFAULT_LABEL_PAPER)
    const t = statics(layout)
    for (const r of REQUIRED) expect(t).toContain(r)
    expect(t).not.toContain('Sneakers Area Srl')
    expect(t).not.toContain('Contanti')
  })

  it('su carta grande stampa tutto, barcode compreso', () => {
    const paper = { widthMm: 100, heightMm: 150 }
    const layout = buildDepositLabelLayout(data({ giftCardAmount: 30 }), 'Copia negozio', paper)
    const t = statics(layout)
    for (const r of [...REQUIRED.slice(0, -1), 'Copia negozio', 'Sneakers Area Srl', 'Contanti', '€ 30,00']) {
      expect(t).toContain(r)
    }
    const bc = layout.template.elements!.find((e) => e.type === 'barcode')
    expect(bc?.text).toBe('POS-1234')
  })

  it('tutti gli elementi stanno dentro la carta', () => {
    for (const paper of [DEFAULT_LABEL_PAPER, { widthMm: 40, heightMm: 20 }, { widthMm: 30, heightMm: 12 }, { widthMm: 62, heightMm: 100 }]) {
      const layout = buildDepositLabelLayout(data(), 'Copia cliente', paper)
      for (const el of layout.template.elements!) {
        expect(el.xMm + el.wMm).toBeLessThanOrEqual(paper.widthMm + 1e-6)
        expect(el.yMm + (el.hMm ?? 0)).toBeLessThanOrEqual(paper.heightMm! + 1e-6)
      }
    }
  })

  it('anche su carta minuscola non perde i campi obbligatori', () => {
    const layout = buildDepositLabelLayout(data(), 'Copia cliente', { widthMm: 30, heightMm: 12 })
    const t = statics(layout)
    for (const r of REQUIRED) expect(t).toContain(r)
  })

  it('il layout si stampa in HTML e in ZPL', () => {
    const layout = buildDepositLabelLayout(data(), 'Copia cliente', { widthMm: 62, heightMm: 100 })
    const label = { name: 'POS-1234', price: 170, barcode: 'POS-1234' }
    const html = renderLabelHtml(label, layout)
    expect(html).toContain('Mario Rossi')
    expect(html).toContain('€ 170,00')
    const zpl = buildLabelZpl(label, layout)
    expect(zpl).toContain('^FDMario Rossi^FS')
    expect(zpl).toContain('^BC') // Code128 del numero d'ordine
  })
})
