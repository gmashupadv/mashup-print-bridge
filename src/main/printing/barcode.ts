// src/main/printing/barcode.ts
// EAN-13 → SVG. Tabelle standard GS1 (L/G/R + parità della prima cifra).

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

export function ean13Checksum(digits12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

export function normalizeEan13(code: string): string {
  if (/^\d{12}$/.test(code)) return code + String(ean13Checksum(code))
  if (/^\d{13}$/.test(code)) {
    if (Number(code[12]) !== ean13Checksum(code.slice(0, 12))) {
      throw new Error(`Barcode EAN-13 con checksum non valido: ${code}`)
    }
    return code
  }
  throw new Error(`Barcode non valido: atteso EAN-13 (12/13 cifre), ricevuto "${code}"`)
}

export function ean13Modules(code13: string): string {
  const first = Number(code13[0])
  const parity = PARITY[first]
  let bits = '101'
  for (let i = 1; i <= 6; i++) {
    const d = Number(code13[i])
    bits += parity[i - 1] === 'L' ? L[d] : G[d]
  }
  bits += '01010'
  for (let i = 7; i <= 12; i++) {
    bits += R[Number(code13[i])]
  }
  return bits + '101' // 95 moduli totali
}

export interface Ean13SvgOptions {
  heightMm?: number     // altezza barre
  moduleMm?: number     // larghezza di un modulo
  fontMm?: number       // altezza testo leggibile
}

export function ean13Svg(code: string, opts: Ean13SvgOptions = {}): string {
  const code13 = normalizeEan13(code)
  const moduleMm = opts.moduleMm ?? 0.33
  const heightMm = opts.heightMm ?? 10
  const fontMm = opts.fontMm ?? 2.2
  const quietLeft = 11 * moduleMm
  const quietRight = 7 * moduleMm
  const bits = ean13Modules(code13)
  const widthMm = 95 * moduleMm + quietLeft + quietRight
  const totalH = heightMm + fontMm + 0.8

  const rects: string[] = []
  let run = 0
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') {
      run++
      continue
    }
    if (run > 0) {
      const x = quietLeft + (i - run) * moduleMm
      rects.push(`<rect x="${x.toFixed(3)}" y="0" width="${(run * moduleMm).toFixed(3)}" height="${heightMm}" fill="#000"/>`)
      run = 0
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${totalH.toFixed(2)}mm" ` +
    `viewBox="0 0 ${widthMm.toFixed(3)} ${totalH.toFixed(3)}">` +
    rects.join('') +
    `<text x="${(widthMm / 2).toFixed(3)}" y="${(heightMm + fontMm).toFixed(3)}" ` +
    `font-family="monospace" font-size="${fontMm}" text-anchor="middle">${code13}</text>` +
    `</svg>`
  )
}
