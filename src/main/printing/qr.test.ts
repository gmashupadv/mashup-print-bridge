import { describe, it, expect } from 'vitest'
import { qrFit, qrMatrix, qrModuleCount, qrSvg } from './qr'

describe('qrModuleCount (ECC M, versioni 1-10)', () => {
  it('un lotto alfanumerico corto sta nella versione 1 (21 moduli)', () => {
    expect(qrModuleCount('L-000123')).toBe(21)
  })

  it('solo cifre: la versione 1 arriva a 34 caratteri, il 35° passa alla versione 2', () => {
    expect(qrModuleCount('1'.repeat(34))).toBe(21)
    expect(qrModuleCount('1'.repeat(35))).toBe(25)
  })

  it('minuscole usano la modalità byte: 14 caratteri in v1, 15 in v2', () => {
    expect(qrModuleCount('a'.repeat(14))).toBe(21)
    expect(qrModuleCount('a'.repeat(15))).toBe(25)
  })

  it('i caratteri non ASCII contano per i loro byte UTF-8', () => {
    // 8 × "è" = 16 byte > 14 → v2
    expect(qrModuleCount('è'.repeat(8))).toBe(25)
  })

  it('oltre la capacità della versione 10 lancia un errore chiaro', () => {
    expect(() => qrModuleCount('a'.repeat(214))).toThrow(/QR/)
  })

  it('il valore vuoto non è codificabile', () => {
    expect(() => qrModuleCount('')).toThrow(/QR/)
  })
})

describe('qrFit', () => {
  it('ingrandimento = riquadro / (moduli + 8 di quiet zone), simbolo centrato', () => {
    expect(qrFit(21, 80, 80)).toEqual({ mag: 2, symbolDots: 42, offXDots: 19, offYDots: 19 })
  })

  it('usa il lato minore e centra sull\'altro asse', () => {
    expect(qrFit(21, 160, 80)).toEqual({ mag: 2, symbolDots: 42, offXDots: 59, offYDots: 19 })
  })

  it('limita l\'ingrandimento tra 1 e 10 dot per modulo', () => {
    expect(qrFit(21, 400, 400).mag).toBe(10)
    expect(qrFit(21, 10, 10).mag).toBe(1)
  })
})

describe('qrMatrix', () => {
  it('la matrice ha le dimensioni previste da qrModuleCount', () => {
    for (const v of ['L-000123', '1'.repeat(35), 'a'.repeat(15), 'è'.repeat(8), 'a'.repeat(213)]) {
      expect(qrMatrix(v).length).toBe(qrModuleCount(v))
    }
  })

  it('ha i tre finder pattern 7x7 negli angoli', () => {
    const m = qrMatrix('L-000123')
    const n = m.length
    const finder = (r0: number, c0: number): string =>
      Array.from({ length: 7 }, (_, r) =>
        Array.from({ length: 7 }, (_, c) => (m[r0 + r][c0 + c] ? '#' : '.')).join('')
      ).join('/')
    const expected = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'].join('/')
    expect(finder(0, 0)).toBe(expected)
    expect(finder(0, n - 7)).toBe(expected)
    expect(finder(n - 7, 0)).toBe(expected)
  })

  it('codifica in UTF-8 come la stampante: "è" ed "é" danno matrici diverse da Latin-1', () => {
    // 8 × "è" sono 16 byte UTF-8 (v2, 25 moduli); in Latin-1 sarebbero 8 byte (v1)
    expect(qrMatrix('è'.repeat(8)).length).toBe(25)
  })
})

describe('qrSvg', () => {
  it('è un SVG scalabile con un modulo per unità e la misura in mm', () => {
    const svg = qrSvg('L-000123', 5.25)
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="5.25mm"')
    expect(svg).toContain('height="5.25mm"')
    expect(svg).toContain('viewBox="0 0 21 21"')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })

  it('disegna solo i moduli scuri, uno sfondo bianco e nessun contenuto esterno', () => {
    const svg = qrSvg('L-000123', 5.25)
    expect(svg).toContain('fill="#fff"')
    expect(svg).toContain('fill="#000"')
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(svg).not.toContain('L-000123')
  })
})
