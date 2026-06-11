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
})
