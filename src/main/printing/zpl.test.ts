import { describe, it, expect } from 'vitest'
import { buildLabelZpl } from './zpl'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './defaults'
import type { LabelData, LabelLayout } from '../drivers/interface'

const layout: LabelLayout = { paper: DEFAULT_LABEL_PAPER, template: DEFAULT_LABEL_TEMPLATE }
const base: LabelData = { name: 'Maglietta', price: 19.9 }

describe('buildLabelZpl', () => {
  it('apre con ^XA/^CI28 e chiude con ^XZ, con larghezza/altezza in dot', () => {
    const zpl = buildLabelZpl(base, layout)
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^CI28')
    // 50mm * 8 dot/mm = 400 ; 30mm * 8 = 240
    expect(zpl).toContain('^PW400')
    expect(zpl).toContain('^LL240')
  })

  it('stampa nome e prezzo in euro con la virgola', () => {
    const zpl = buildLabelZpl(base, layout)
    expect(zpl).toContain('^FDMaglietta^FS')
    expect(zpl).toContain('€ 19,90')
  })

  it('stampa il prezzo di confronto barrato (testo + linea ^GB) se maggiore del prezzo', () => {
    const zpl = buildLabelZpl({ ...base, compareAtPrice: 29.9 }, layout)
    expect(zpl).toContain('€ 29,90')
    expect(zpl).toContain('^GB')
  })

  it('non stampa il prezzo di confronto se non maggiore del prezzo', () => {
    expect(buildLabelZpl({ ...base, compareAtPrice: 19.9 }, layout)).not.toContain('^GB')
    expect(buildLabelZpl({ ...base, compareAtPrice: 9.9 }, layout)).not.toContain('^GB')
    expect(buildLabelZpl(base, layout)).not.toContain('^GB')
  })

  it('usa il barcode EAN-13 nativo (^BE) con 12 cifre per i codici numerici', () => {
    const zpl = buildLabelZpl({ ...base, barcode: '8001234567897' }, layout) // checksum valido
    expect(zpl).toContain('^BEN,')
    expect(zpl).toContain('^FD800123456789^FS') // 13 → 12 cifre (la stampante calcola il check)
  })

  it('un EAN-13 con checksum errato ricade su Code128 (stampa comunque)', () => {
    const zpl = buildLabelZpl({ ...base, barcode: '8001234567890' }, layout)
    expect(zpl).toContain('^BCN,')
    expect(zpl).toContain('^FD8001234567890^FS')
  })

  it('usa Code128 (^BC) per gli SKU alfanumerici', () => {
    const zpl = buildLabelZpl({ ...base, barcode: 'E39C2E14' }, layout)
    expect(zpl).toContain('^BCN,')
    expect(zpl).toContain('^FDE39C2E14^FS')
  })

  it('omette il barcode quando showBarcode è false', () => {
    const noBc: LabelLayout = { paper: DEFAULT_LABEL_PAPER, template: { ...DEFAULT_LABEL_TEMPLATE, showBarcode: false } }
    const zpl = buildLabelZpl({ ...base, barcode: '8001234567890' }, noBc)
    expect(zpl).not.toContain('^BE')
    expect(zpl).not.toContain('^BC')
  })

  it('neutralizza ^ e ~ nel testo (sono prefissi comando ZPL)', () => {
    const zpl = buildLabelZpl({ name: 'A^B~C', price: 1 }, layout)
    expect(zpl).toContain('^FDA B C^FS')
  })

  // --- Modello a elementi: le stesse coordinate mm dell'anteprima HTML ---

  it('con elements espliciti stampa SOLO gli elementi elencati, alle coordinate date', () => {
    const zpl = buildLabelZpl(
      { name: 'Matita', price: 1.5, sku: 'MAT-1', barcode: '8001234567897' },
      {
        paper: { widthMm: 30, heightMm: 12 },
        template: {
          version: 2,
          elements: [
            { id: 'p', type: 'price', xMm: 2, yMm: 3, wMm: 26, hMm: 7, fontMm: 5, align: 'center' },
          ],
        },
      }
    )
    // 2mm * 8 dot/mm = 16 ; 3mm = 24 ; corpo 5mm = 40 dot ; blocco 26mm = 208
    expect(zpl).toContain('^FO16,24^A0N,40,40^FB208,1,0,C^FD€ 1,50^FS')
    expect(zpl).not.toContain('Matita')
    expect(zpl).not.toContain('MAT-1')
    expect(zpl).not.toContain('^BE')
  })

  it('salta gli elementi con visible: false', () => {
    const zpl = buildLabelZpl(
      { name: 'Matita', price: 1.5 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [
            { id: 'n', type: 'name', xMm: 2, yMm: 2, wMm: 40, hMm: 4, visible: false },
            { id: 'p', type: 'price', xMm: 2, yMm: 8, wMm: 40, hMm: 5 },
          ],
        },
      }
    )
    expect(zpl).not.toContain('Matita')
    expect(zpl).toContain('€ 1,50')
  })

  it('la rotazione a 90° usa il font ruotato ^A0R', () => {
    const zpl = buildLabelZpl(
      { name: 'A', price: 1 },
      {
        paper: { widthMm: 12, heightMm: 40 },
        template: {
          version: 2,
          elements: [{ id: 'p', type: 'price', xMm: 2, yMm: 2, wMm: 30, hMm: 6, rotate: 90 }],
        },
      }
    )
    expect(zpl).toContain('^A0R,')
  })

  it('showHri false chiede alla stampante di non stampare le cifre', () => {
    const el = (showHri: boolean): LabelLayout => ({
      paper: DEFAULT_LABEL_PAPER,
      template: {
        version: 2,
        elements: [{ id: 'b', type: 'barcode', xMm: 2, yMm: 2, wMm: 40, hMm: 12, showHri }],
      },
    })
    expect(buildLabelZpl({ ...base, barcode: '8001234567897' }, el(true))).toContain('^BEN,')
    const noHri = buildLabelZpl({ ...base, barcode: '8001234567897' }, el(false))
    expect(/\^BEN,\d+,N,N/.test(noHri)).toBe(true)
  })

  it('la larghezza del riquadro barcode determina il modulo ^BY', () => {
    const make = (wMm: number) =>
      buildLabelZpl(
        { ...base, barcode: '8001234567897' },
        {
          paper: { widthMm: 60, heightMm: 30 },
          template: {
            version: 2,
            elements: [{ id: 'b', type: 'barcode', xMm: 2, yMm: 2, wMm, hMm: 12 }],
          },
        }
      )
    // 113 moduli EAN-13 (quiet zone incluse): 20mm → ~1.4 dot, 45mm → ~3.2 dot
    expect(make(20)).toContain('^BY1^BE')
    expect(make(45)).toContain('^BY3^BE')
  })

  it('una linea diventa un rettangolo ^GB pieno', () => {
    const zpl = buildLabelZpl(
      { name: 'A', price: 1 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 'l', type: 'line', xMm: 2, yMm: 10, wMm: 46, hMm: 0.5 }],
        },
      }
    )
    // 46mm = 368 dot, spessore 0.5mm = 4 dot
    expect(zpl).toContain('^FO16,80^GB368,4,4^FS')
  })

  it('un testo fisso finisce sull\'etichetta anche senza dati prodotto', () => {
    const zpl = buildLabelZpl(
      { name: 'A', price: 1 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 't', type: 'static', xMm: 2, yMm: 2, wMm: 40, hMm: 4, text: 'SALDI' }],
        },
      }
    )
    expect(zpl).toContain('^FDSALDI^FS')
  })
})
