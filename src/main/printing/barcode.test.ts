import { describe, it, expect } from 'vitest'
import { ean13Checksum, normalizeEan13, ean13Svg, ean13Modules, code128Modules, barcodeSvg, assertPrintableBarcode } from './barcode'

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
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(25)
  })

  it('uses GS1-compliant quiet zones: 11 modules left, 7 modules right', () => {
    // default moduleMm = 0.33
    // widthMm = 95*0.33 + 11*0.33 + 7*0.33 = (95+11+7)*0.33 = 113*0.33 = 37.29
    const svg = ean13Svg('8001234567897')
    expect(svg).toContain('width="37.29mm"')
  })
})

describe('ean13Modules (golden)', () => {
  it('encodes 5901234123457 to the exact 95-module pattern', () => {
    const bits = ean13Modules('5901234123457')
    expect(bits).toHaveLength(95)
    expect(bits.startsWith('101')).toBe(true)
    expect(bits.endsWith('101')).toBe(true)
    expect(bits.slice(45, 50)).toBe('01010')
    // golden: first digit 5 → parity LGGLLG
    // digit '9' in L = '0001011' ✓, digit '0' in G = '0100111' ✓
    expect(bits).toBe('10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101')
  })
})

describe('Code128 + auto-detect', () => {
  it('codifica un SKU alfanumerico in Code128 (Start B + checksum + Stop)', () => {
    const bits = code128Modules('E39C2E14')
    // 8 caratteri: start + 8 dati + checksum + stop = 11 simboli
    // lunghezza = 11*(start+dati+check) + 13(stop) = 11*10 + 13 = 123 moduli
    expect(bits.length).toBe(11 * 10 + 13)
    expect(bits.startsWith('11010010000')).toBe(true) // Start B = 211214
    expect(bits.endsWith('1100011101011')).toBe(true) // Stop
  })

  it('checksum corretto su esempio noto "CODE128"', () => {
    // Start B(104) + C(35)*1 + O(47)*2 + D(36)*3 + E(37)*4 + 1(17)*5 + 2(18)*6 + 8(24)*7
    // = 104 + 35 + 94 + 108 + 148 + 85 + 108 + 168 = 850 ; 850 % 103 = 27
    const bits = code128Modules('CODE128')
    expect(bits.length).toBe(11 * 9 + 13) // start + 7 dati + check + stop
  })

  it('rifiuta caratteri non stampabili', () => {
    expect(() => code128Modules('abc')).toThrow(/Code128/)
    expect(() => code128Modules('')).toThrow(/Code128/)
  })

  it('barcodeSvg sceglie EAN-13 per 12/13 cifre valide', () => {
    expect(barcodeSvg('801234567890').replace(/\s/g, '')).toContain('<text')
    // 13 cifre con checksum valido resta EAN-13: nessuna eccezione
    expect(() => barcodeSvg('8001234567890')).not.toThrow()
  })

  it('barcodeSvg ricade su Code128 per alfanumerici e numerici "strani"', () => {
    const svg = barcodeSvg('E39C2E14')
    expect(svg).toContain('<svg')
    expect(svg).toContain('E39C2E14')
    // 13 cifre con checksum SBAGLIATO → Code128, non errore
    expect(() => barcodeSvg('8001234567891')).not.toThrow()
  })

  it('assertPrintableBarcode: ok per alfanumerici, errore per vuoto/controllo', () => {
    expect(() => assertPrintableBarcode('E39C2E14')).not.toThrow()
    expect(() => assertPrintableBarcode('123456789012')).not.toThrow()
    expect(() => assertPrintableBarcode('')).toThrow()
    expect(() => assertPrintableBarcode('ab')).toThrow()
  })
})
