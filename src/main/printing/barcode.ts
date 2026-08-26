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
  hri?: boolean         // cifre leggibili sotto le barre (default true)
}

export function ean13Svg(code: string, opts: Ean13SvgOptions = {}): string {
  const code13 = normalizeEan13(code)
  const moduleMm = opts.moduleMm ?? 0.33
  const heightMm = opts.heightMm ?? 10
  const fontMm = opts.fontMm ?? 2.2
  const quietLeft = 11 * moduleMm
  const quietRight = 7 * moduleMm
  const hri = opts.hri !== false
  const bits = ean13Modules(code13)
  const widthMm = 95 * moduleMm + quietLeft + quietRight
  const totalH = heightMm + (hri ? fontMm + 0.8 : 0)

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
    (hri
      ? `<text x="${(widthMm / 2).toFixed(3)}" y="${(heightMm + fontMm).toFixed(3)}" ` +
        `font-family="monospace" font-size="${fontMm}" text-anchor="middle">${code13}</text>`
      : '') +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// Code128 (subset B) — per codici alfanumerici (SKU come "E39C2E14") che non
// sono EAN-13. Tabella standard: 107 pattern (valori 0-106) espressi come 6
// larghezze (bar/space alternati, somma 11 moduli); lo Stop ha 7 larghezze (13).
// ---------------------------------------------------------------------------
const CODE128_WIDTHS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
] as const

const CODE128_START_B = 104
const CODE128_STOP = 106

function widthsToBits(widths: string): string {
  let bits = ''
  for (let i = 0; i < widths.length; i++) {
    bits += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]))
  }
  return bits
}

export function isCode128Encodable(value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 32 || c > 126) return false // subset B: ASCII stampabile
  }
  return true
}

// Sequenza di moduli (bit) per l'intero Code128-B: Start B, dati, checksum, Stop.
export function code128Modules(value: string): string {
  if (!isCode128Encodable(value)) {
    throw new Error(`Barcode Code128 non valido: caratteri non stampabili in "${value}"`)
  }
  const values = [CODE128_START_B]
  for (let i = 0; i < value.length; i++) {
    values.push(value.charCodeAt(i) - 32)
  }
  let sum = CODE128_START_B
  for (let i = 1; i < values.length; i++) {
    sum += values[i] * i
  }
  values.push(sum % 103)
  values.push(CODE128_STOP)
  return values.map((v) => widthsToBits(CODE128_WIDTHS[v])).join('')
}

function esc128(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function code128Svg(value: string, opts: Ean13SvgOptions = {}): string {
  const moduleMm = opts.moduleMm ?? 0.33
  const heightMm = opts.heightMm ?? 10
  const fontMm = opts.fontMm ?? 2.2
  const hri = opts.hri !== false
  const quiet = 10 * moduleMm // quiet zone minima Code128
  const bits = code128Modules(value)
  const widthMm = bits.length * moduleMm + quiet * 2
  const totalH = heightMm + (hri ? fontMm + 0.8 : 0)

  const rects: string[] = []
  let run = 0
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') {
      run++
      continue
    }
    if (run > 0) {
      const x = quiet + (i - run) * moduleMm
      rects.push(`<rect x="${x.toFixed(3)}" y="0" width="${(run * moduleMm).toFixed(3)}" height="${heightMm}" fill="#000"/>`)
      run = 0
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${totalH.toFixed(2)}mm" ` +
    `viewBox="0 0 ${widthMm.toFixed(3)} ${totalH.toFixed(3)}">` +
    rects.join('') +
    (hri
      ? `<text x="${(widthMm / 2).toFixed(3)}" y="${(heightMm + fontMm).toFixed(3)}" ` +
        `font-family="monospace" font-size="${fontMm}" text-anchor="middle">${esc128(value)}</text>`
      : '') +
    `</svg>`
  )
}

// Auto-rilevamento del tipo: 12/13 cifre con checksum valido → EAN-13,
// altrimenti Code128. Un 13-cifre con checksum errato ricade su Code128 così
// stampa comunque (niente più 400 su SKU alfanumerici).
export function barcodeSvg(value: string, opts: Ean13SvgOptions = {}): string {
  const v = String(value).trim()
  if (/^\d{12}$/.test(v)) return ean13Svg(v, opts)
  if (/^\d{13}$/.test(v) && Number(v[12]) === ean13Checksum(v.slice(0, 12))) {
    return ean13Svg(v, opts)
  }
  return code128Svg(v, opts)
}

/**
 * Numero totale di moduli (barre+spazi+quiet zone) che occuperà il barcode.
 * Serve a ricavare la larghezza del modulo da una larghezza in mm desiderata:
 * moduleMm = larghezzaVoluta / barcodeModuleCount(valore).
 */
export function barcodeModuleCount(value: string): number {
  const v = String(value).trim()
  const isEan =
    /^\d{12}$/.test(v) || (/^\d{13}$/.test(v) && Number(v[12]) === ean13Checksum(v.slice(0, 12)))
  if (isEan) return 95 + 11 + 7 // moduli dati + quiet zone sinistra/destra
  return code128Modules(v).length + 20 // quiet zone 10 moduli per lato
}

// Validazione permissiva usata dal server: lancia solo se il valore non è
// stampabile in NESSUNA simbologia (es. vuoto o caratteri di controllo).
export function assertPrintableBarcode(value: string): void {
  const v = String(value).trim()
  if (/^\d{12,13}$/.test(v)) return // numerico → EAN-13 o Code128, sempre ok
  if (!isCode128Encodable(v)) {
    throw new Error(`Barcode non stampabile: "${value}" contiene caratteri non supportati o è vuoto`)
  }
}
