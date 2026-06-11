import { describe, it, expect } from 'vitest'
import { ean13Checksum, normalizeEan13, ean13Svg, ean13Modules } from './barcode'

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
