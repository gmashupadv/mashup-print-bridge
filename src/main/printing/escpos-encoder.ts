// src/main/printing/escpos-encoder.ts
// Encoder ESC/POS standard (Epson TM e compatibili). CP858 per i caratteri italiani + €.
import type { NonFiscalDoc } from '../drivers/interface'
import { code128Modules, isCode128Encodable, isEan13 } from './barcode'

const ESC = 0x1b
const GS = 0x1d

const CP858: Record<string, number> = {
  'à': 0x85, 'è': 0x8a, 'é': 0x82, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97,
  'À': 0xb7, 'È': 0xd4, 'É': 0x90, 'Ì': 0xde, 'Ò': 0xe3, 'Ù': 0xeb,
  '°': 0xf8, '€': 0xd5, 'ç': 0x87, 'ü': 0x81, 'ö': 0x94, 'ä': 0x84,
  '£': 0x9c, 'ñ': 0xa4, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
}

export function encodeCp858(s: string): Buffer {
  s = s.normalize('NFC')
  const bytes: number[] = []
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code < 0x20) bytes.push(0x20)  // replace control chars (incl. ESC/GS) with space
    else if (code < 0x80) bytes.push(code)
    else bytes.push(CP858[ch] ?? 0x3f)
  }
  return Buffer.from(bytes)
}

// Larghezza stampabile più stretta fra le teste supportate (58mm → 48mm a 8 dot/mm):
// la larghezza del modulo si sceglie perché il barcode ci stia comunque.
const BARCODE_MAX_DOTS = 384
const BARCODE_HEIGHT_DOTS = 80 // 10mm

/**
 * Barcode nativo (GS k, funzione B). Stessa regola di /print-label: EAN-13 solo
 * con 13 cifre e checksum valido, altrimenti Code128 set B della stringa esatta.
 * Null se il valore non è codificabile: il chiamante stampa il testo di ripiego.
 */
export function encodeBarcode(value: string): Buffer | null {
  const v = value.trim()
  if (!isCode128Encodable(v)) return null
  let symbol: Buffer
  let modules: number
  if (isEan13(v)) {
    symbol = Buffer.concat([Buffer.from([GS, 0x6b, 67, 13]), Buffer.from(v, 'ascii')])
    modules = 95 + 18
  } else {
    // "{B" seleziona il set B; una graffa nei dati va raddoppiata.
    const data = Buffer.from('{B' + v.replace(/\{/g, '{{'), 'ascii')
    if (data.length > 255) return null
    symbol = Buffer.concat([Buffer.from([GS, 0x6b, 73, data.length]), data])
    modules = code128Modules(v).length + 20
  }
  const width = modules * 3 <= BARCODE_MAX_DOTS ? 3 : modules * 2 <= BARCODE_MAX_DOTS ? 2 : 1
  return Buffer.concat([
    Buffer.from([GS, 0x68, BARCODE_HEIGHT_DOTS]), // altezza
    Buffer.from([GS, 0x77, width]),               // larghezza modulo
    Buffer.from([GS, 0x48, 2]),                   // cifre sotto le barre
    Buffer.from([GS, 0x66, 0]),                   // font A per le cifre
    symbol,
  ])
}

export function encodeNonFiscal(doc: NonFiscalDoc): Buffer {
  const parts: Buffer[] = [
    Buffer.from([ESC, 0x40]),      // init
    Buffer.from([ESC, 0x74, 19]),  // select codepage CP858
  ]
  for (const line of doc.lines) {
    const align = line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0
    parts.push(Buffer.from([ESC, 0x61, align]))
    const barcode = line.barcode ? encodeBarcode(line.barcode) : null
    if (barcode) {
      parts.push(barcode)
      parts.push(Buffer.from([0x0a]))
      continue
    }
    parts.push(Buffer.from([ESC, 0x45, line.bold ? 1 : 0]))
    parts.push(Buffer.from([GS, 0x21, line.size === 'double' ? 0x11 : 0x00]))
    parts.push(encodeCp858(line.text))
    parts.push(Buffer.from([0x0a]))
  }
  parts.push(Buffer.from([ESC, 0x64, 4])) // feed 4 righe prima del taglio/strappo
  if (doc.cut) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00])) // partial cut con feed
  return Buffer.concat(parts)
}

// Bitmap monocromatica row-major, bit MSB-first, rowBytes = ceil(widthPx/8). 1 = nero.
export interface MonoBitmap {
  widthPx: number
  heightPx: number
  data: Uint8Array
}

export function encodeRaster(bmp: MonoBitmap): Buffer {
  const rowBytes = Math.ceil(bmp.widthPx / 8)
  const expected = rowBytes * bmp.heightPx
  if (bmp.data.length !== expected) {
    throw new Error(`encodeRaster: expected ${expected} bytes, got ${bmp.data.length}`)
  }
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, bmp.heightPx & 0xff, bmp.heightPx >> 8]),
    Buffer.from(bmp.data),
  ])
}
