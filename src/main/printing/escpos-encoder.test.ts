import { describe, it, expect } from 'vitest'
import { encodeCp858, encodeNonFiscal, encodeRaster } from './escpos-encoder'

describe('encodeCp858', () => {
  it('passes through ASCII and maps Italian accents and euro', () => {
    expect([...encodeCp858('Abc')]).toEqual([0x41, 0x62, 0x63])
    expect([...encodeCp858('è')]).toEqual([0x8a])
    expect([...encodeCp858('€')]).toEqual([0xd5])
    expect([...encodeCp858('☃')]).toEqual([0x3f]) // fallback '?'
  })
})

describe('encodeNonFiscal', () => {
  it('emits init, codepage, per-line styling, feed and cut', () => {
    const buf = encodeNonFiscal({
      lines: [{ text: 'HI', bold: true, size: 'double', align: 'center' }],
      cut: true,
    })
    const bytes = [...buf]
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40])          // ESC @
    expect(bytes.slice(2, 5)).toEqual([0x1b, 0x74, 19])      // ESC t 19 → CP858
    expect(buf.includes(Buffer.from([0x1b, 0x61, 1]))).toBe(true)   // center
    expect(buf.includes(Buffer.from([0x1b, 0x45, 1]))).toBe(true)   // bold on
    expect(buf.includes(Buffer.from([0x1d, 0x21, 0x11]))).toBe(true) // double w+h
    expect(buf.includes(Buffer.from('HI'))).toBe(true)
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]) // GS V partial cut
  })

  it('omits cut when cut=false', () => {
    const buf = encodeNonFiscal({ lines: [{ text: 'X' }], cut: false })
    expect(buf.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))).toBe(false)
  })
})

describe('encodeRaster', () => {
  it('builds GS v 0 header from bitmap dims', () => {
    // 16px wide (2 byte/row), 2 righe
    const data = new Uint8Array([0xff, 0x00, 0x00, 0xff])
    const buf = encodeRaster({ widthPx: 16, heightPx: 2, data })
    expect([...buf.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0])
    expect([...buf.slice(8)]).toEqual([0xff, 0x00, 0x00, 0xff])
  })

  it('throws when data.length does not match rowBytes * heightPx', () => {
    // 16px wide → rowBytes=2, heightPx=2 → expected 4 bytes; we pass 3
    const data = new Uint8Array([0xff, 0x00, 0x00]) // 3 bytes instead of 4
    expect(() => encodeRaster({ widthPx: 16, heightPx: 2, data })).toThrow(/expected 4.*got 3/i)
  })
})

describe('encodeCp858 — control-char sanitization, NFC, extended map', () => {
  it('replaces ESC and GS control chars with spaces (command injection guard)', () => {
    // \x1b = ESC, \x1d = GS, X is 0x58
    expect([...encodeCp858('\x1b\x1dX')]).toEqual([0x20, 0x20, 0x58])
  })

  it('normalizes decomposed è (e + combining grave) to NFC before mapping', () => {
    // 'e' (U+0065) + combining grave (U+0300) → NFC → 'è' (U+00E8) → CP858 0x8a
    const decomposed = 'è'
    expect([...encodeCp858(decomposed)]).toEqual([0x8a])
  })

  it('maps £ to 0x9c (extended CP858)', () => {
    expect([...encodeCp858('£')]).toEqual([0x9c])
  })

  it('maps ñ to 0xa4, á to 0xa0, í to 0xa1, ó to 0xa2, ú to 0xa3 (extended CP858)', () => {
    expect([...encodeCp858('ñ')]).toEqual([0xa4])
    expect([...encodeCp858('á')]).toEqual([0xa0])
    expect([...encodeCp858('í')]).toEqual([0xa1])
    expect([...encodeCp858('ó')]).toEqual([0xa2])
    expect([...encodeCp858('ú')]).toEqual([0xa3])
  })
})

describe('encodeNonFiscal — embedded newline sanitization', () => {
  it('does not emit 0x0a mid-line for text containing \\n', () => {
    // 'A\nB' → after sanitization: A (0x41), space (0x20), B (0x42), then line-ending LF (0x0a)
    const buf = encodeNonFiscal({ lines: [{ text: 'A\nB' }], cut: false })
    // Find the encoded text bytes by locating 0x41 in the buffer
    const bytes = [...buf]
    const aIdx = bytes.indexOf(0x41)
    expect(aIdx).toBeGreaterThanOrEqual(0)
    // The four bytes starting at A must be [0x41, 0x20, 0x42, 0x0a]
    expect(bytes.slice(aIdx, aIdx + 4)).toEqual([0x41, 0x20, 0x42, 0x0a])
  })
})
