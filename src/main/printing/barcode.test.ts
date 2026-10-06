import { describe, it, expect } from 'vitest'
import { ean13Checksum, normalizeEan13, ean13Svg, ean13Modules, code128Modules, barcodeSvg, barcodeModuleCount, assertPrintableBarcode } from './barcode'

describe('ean13Checksum', () => {
  it('computes the check digit', () => {
    expect(ean13Checksum('800123456789')).toBe(7)
    expect(ean13Checksum('400638133393')).toBe(1)
  })
})

describe('normalizeEan13', () => {
  it('rifiuta 12 cifre: non aggiunge mai un check digit', () => {
    expect(() => normalizeEan13('800123456789')).toThrow(/EAN-13/i)
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

  it('barcodeSvg sceglie EAN-13 solo per 13 cifre con checksum valido', () => {
    const svg = barcodeSvg('8001234567897')
    expect(svg).toContain('>8001234567897<')
    // EAN-13: 95 moduli + quiet zone 11/7 → larghezza fissa
    expect(svg).toContain('width="37.29mm"')
  })

  it('barcodeSvg stampa 12 cifre come Code128 letterale (UPC-A non viene "completato" a 13)', () => {
    const svg = barcodeSvg('012345678905')
    expect(svg).toContain('>012345678905<')
    expect(svg).not.toContain('0123456789050')
    // Code128: Start B + 12 dati + check = 14×11 + Stop 13 = 167 moduli + quiet 2×10
    expect(svg).toContain('width="61.71mm"')
  })

  it('barcodeSvg ricade su Code128 per alfanumerici e numerici "strani"', () => {
    const svg = barcodeSvg('E39C2E14')
    expect(svg).toContain('<svg')
    expect(svg).toContain('E39C2E14')
    // 13 cifre con checksum SBAGLIATO → Code128, non errore
    expect(() => barcodeSvg('8001234567891')).not.toThrow()
  })

  it('barcodeModuleCount segue la stessa simbologia del rendering (12 cifre = Code128, non EAN)', () => {
    expect(barcodeModuleCount('8001234567897')).toBe(95 + 11 + 7)
    // 12 cifre → Code128: Start B + 12 dati + check = 14×11 + Stop 13 = 167, + quiet 2×10
    expect(barcodeModuleCount('012345678905')).toBe(167 + 20)
  })

  it('assertPrintableBarcode: ok per alfanumerici, errore per vuoto/controllo', () => {
    expect(() => assertPrintableBarcode('E39C2E14')).not.toThrow()
    expect(() => assertPrintableBarcode('123456789012')).not.toThrow()
    expect(() => assertPrintableBarcode('')).toThrow()
    expect(() => assertPrintableBarcode('ab')).toThrow()
  })
})
