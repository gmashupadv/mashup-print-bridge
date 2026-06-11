import { describe, it, expect } from 'vitest'
import { parseLpoptionsPageSizes, paperNameToMm } from './paper-info'

describe('parseLpoptionsPageSizes', () => {
  it('extracts sizes and default (starred) from lpoptions -l output', () => {
    const out = [
      'PageSize/Media Size: *62x29mm 62x100mm A4 Custom.WIDTHxHEIGHT',
      'Resolution/Resolution: 300dpi',
    ].join('\n')
    const res = parseLpoptionsPageSizes(out)
    expect(res.papers).toEqual(['62x29mm', '62x100mm', 'A4', 'Custom.WIDTHxHEIGHT'])
    expect(res.defaultPaper).toBe('62x29mm')
  })

  it('returns empty when no PageSize line', () => {
    expect(parseLpoptionsPageSizes('Duplex/Duplex: None')).toEqual({ papers: [] })
  })
})

describe('paperNameToMm', () => {
  it('parses WxHmm CUPS names', () => {
    expect(paperNameToMm('62x29mm')).toEqual({ widthMm: 62, heightMm: 29 })
  })
  it('knows common names', () => {
    expect(paperNameToMm('A4')).toEqual({ widthMm: 210, heightMm: 297 })
    expect(paperNameToMm('Letter')).toEqual({ widthMm: 216, heightMm: 279 })
  })
  it('returns null for unknown names', () => {
    expect(paperNameToMm('Custom.WIDTHxHEIGHT')).toBeNull()
  })
})
