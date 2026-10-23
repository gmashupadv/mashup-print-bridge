// src/main/printing/qr.ts
// Dimensione di un QR Code (modello 2) con correzione d'errore M, versioni 1-10.
// Serve a ricavare l'ingrandimento nativo ZPL (^BQ) da un riquadro in mm: la
// stampante sceglie da sé versione e modalità, ma per centrare il simbolo e
// rispettare la quiet zone dobbiamo sapere QUANTI moduli occuperà.
//
// La versione scelta qui è la STESSA usata per disegnare l'anteprima (qrMatrix): così
// anteprima e stampa hanno la stessa impronta, anche quando la stampante comporrebbe
// il testo in modalità miste. La stima è per eccesso: la stampante può comporre il testo in modalità miste e
// scendere di versione, mai salire. Un simbolo un filo più piccolo del previsto
// è innocuo, uno più grande invaderebbe la quiet zone.

import qrcode from 'qrcode-generator'

// La Zebra riceve il testo in UTF-8 (^CI28): la libreria di default userebbe Latin-1,
// con byte diversi e quindi un simbolo diverso per i caratteri accentati.
qrcode.stringToBytes = (text: string): number[] => Array.from(Buffer.from(text, 'utf8'))

// Capacità in caratteri per versione 1..10, ECC M (ISO/IEC 18004).
const NUMERIC_M = [34, 63, 101, 149, 202, 255, 293, 365, 432, 513]
const ALNUM_M = [20, 38, 61, 90, 122, 154, 178, 221, 262, 311]
const BYTE_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]

const ALNUM_CHARS = /^[0-9A-Z $%*+\-./:]+$/

/** Moduli per lato di un QR di versione `v`: 17 + 4v. */
export function qrModulesForVersion(version: number): number {
  return 17 + 4 * version
}

type QrMode = 'Numeric' | 'Alphanumeric' | 'Byte'

interface QrPlan {
  version: number
  modules: number
  mode: QrMode
}

/** Modalità e versione minima (ECC M) che contengono `value`. Lancia se non entra in v10. */
function qrPlan(value: string): QrPlan {
  if (value.length === 0) {
    throw new Error('Contenuto QR vuoto: niente da codificare')
  }
  let mode: QrMode
  let table: number[]
  let size: number
  if (/^[0-9]+$/.test(value)) {
    mode = 'Numeric'
    table = NUMERIC_M
    size = value.length
  } else if (ALNUM_CHARS.test(value)) {
    mode = 'Alphanumeric'
    table = ALNUM_M
    size = value.length
  } else {
    mode = 'Byte'
    table = BYTE_M
    size = Buffer.byteLength(value, 'utf8')
  }
  const idx = table.findIndex((cap) => size <= cap)
  if (idx === -1) {
    throw new Error(`Contenuto QR troppo lungo: ${size} caratteri superano la versione 10 supportata`)
  }
  return { version: idx + 1, modules: qrModulesForVersion(idx + 1), mode }
}

/** Moduli per lato del QR che codifica `value` (ECC M). Lancia se non entra in v10. */
export function qrModuleCount(value: string): number {
  return qrPlan(value).modules
}

export interface QrFit {
  /** Dot per modulo (1-10, il range di ^BQ). */
  mag: number
  /** Lato del simbolo in dot, quiet zone esclusa. */
  symbolDots: number
  /** Scostamento del simbolo dall'angolo alto-sinistro del riquadro, in dot. */
  offXDots: number
  offYDots: number
}

/**
 * Come un QR di `modules` moduli sta in un riquadro `boxWDots` × `boxHDots`: si usa il
 * lato minore, l'ingrandimento lascia 4 moduli di quiet zone per lato e il simbolo è
 * centrato sull'altro asse. Condiviso da ZPL e anteprima HTML, così coincidono.
 */
export function qrFit(modules: number, boxWDots: number, boxHDots: number): QrFit {
  const side = Math.min(boxWDots, boxHDots)
  const mag = Math.max(1, Math.min(10, Math.floor(side / (modules + 8))))
  const symbolDots = modules * mag
  return {
    mag,
    symbolDots,
    offXDots: Math.max(0, Math.round((boxWDots - symbolDots) / 2)),
    offYDots: Math.max(0, Math.round((boxHDots - symbolDots) / 2)),
  }
}

/** Matrice dei moduli (true = scuro) del QR di `value`, versione e modalità di qrPlan. */
export function qrMatrix(value: string): boolean[][] {
  const { version, mode } = qrPlan(value)
  const qr = qrcode(version as Parameters<typeof qrcode>[0], 'M')
  qr.addData(value, mode)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/**
 * SVG del QR, `sizeMm` di lato, un modulo per unità del viewBox. Il fondo è bianco
 * esplicito (il simbolo resta leggibile anche su un'etichetta con sfondo colorato) e le
 * righe di moduli scuri adiacenti sono fuse in un solo rettangolo.
 */
export function qrSvg(value: string, sizeMm: number): string {
  const m = qrMatrix(value)
  const n = m.length
  const rects: string[] = []
  for (let r = 0; r < n; r++) {
    let run = 0
    for (let c = 0; c <= n; c++) {
      if (c < n && m[r][c]) {
        run++
        continue
      }
      if (run > 0) {
        rects.push(`<rect x="${c - run}" y="${r}" width="${run}" height="1"/>`)
        run = 0
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMm.toFixed(2)}mm" height="${sizeMm.toFixed(2)}mm" ` +
    `viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/>` +
    `<g fill="#000">${rects.join('')}</g></svg>`
  )
}
