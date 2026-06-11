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
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(25)
  })
})
