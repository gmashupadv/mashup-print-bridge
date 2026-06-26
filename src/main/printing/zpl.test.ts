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
    expect(zpl).toContain('19,90 €')
  })

  it('stampa il prezzo di confronto barrato (testo + linea ^GB) se maggiore del prezzo', () => {
    const zpl = buildLabelZpl({ ...base, compareAtPrice: 29.9 }, layout)
    expect(zpl).toContain('29,90 €')
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
})
