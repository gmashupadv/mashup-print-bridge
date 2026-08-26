// src/main/printing/zpl.ts
// Genera ZPL (Zebra Programming Language) per etichette prodotto.
// Usato dal driver zpl-network per stampanti che emulano Zebra (Printex G300, Godex, TSC, Zebra…).
// I barcode sono NATIVI della stampante (^BE EAN-13, ^BC Code128): niente raster, niente offscreen.
//
// Il layout arriva dallo stesso modello a elementi che alimenta l'anteprima HTML
// (label-template.ts): i millimetri diventano dot con ^FO x,y, quindi ciò che si
// vede nell'editor è ciò che esce dalla Zebra.
import type { LabelData, LabelLayout, LabelRotation } from '../drivers/interface'
import { ean13Checksum, barcodeModuleCount } from './barcode'
import {
  barcodeValue,
  elementText,
  resolveElements,
  resolvePaper,
  type ResolvedElement,
} from './label-template'

// 203 dpi è lo standard Zebra (8 dot/mm). Il G300 è 200dpi → ~1.5% di scostamento, irrilevante.
const DOTS_PER_MM = 8

// ZPL usa ^ e ~ come prefissi comando: vanno neutralizzati nei dati di testo.
function zplText(s: string): string {
  return s.replace(/[\^~]/g, ' ')
}

// N = 0°, R = 90° orario, I = 180°, B = 270°. Stessa convenzione della rotazione CSS
// nell'anteprima: il campo resta ancorato a (x, y) ed estende verso destra/basso.
function orientation(rotate: LabelRotation): 'N' | 'R' | 'I' | 'B' {
  return rotate === 90 ? 'R' : rotate === 180 ? 'I' : rotate === 270 ? 'B' : 'N'
}

function alignLetter(align: ResolvedElement['align']): 'L' | 'C' | 'R' {
  return align === 'center' ? 'C' : align === 'right' ? 'R' : 'L'
}

interface BarcodeField {
  command: string
  data: string
}

// EAN-13 se 12/13 cifre (checksum valido per i 13), altrimenti Code128 — stessa logica di barcodeSvg.
function barcodeField(
  raw: string,
  moduleDots: number,
  heightDots: number,
  o: string,
  hri: boolean
): BarcodeField {
  const v = raw.trim()
  const h = hri ? 'Y' : 'N'
  if (/^\d{12}$/.test(v) || (/^\d{13}$/.test(v) && Number(v[12]) === ean13Checksum(v.slice(0, 12)))) {
    // ^BE = EAN-13: passiamo 12 cifre, il check digit lo calcola la stampante
    return { command: `^BY${moduleDots}^BE${o},${heightDots},${h},N`, data: v.slice(0, 12) }
  }
  return { command: `^BY${moduleDots}^BC${o},${heightDots},${h},N,N`, data: v }
}

export function buildLabelZpl(label: LabelData, layout: LabelLayout, dotsPerMm = DOTS_PER_MM): string {
  const paper = resolvePaper(layout.paper)
  const elements = resolveElements(layout.template, paper)
  const dots = (v: number): number => Math.max(0, Math.round(v * dotsPerMm))

  const widthDots = dots(paper.widthMm)
  const heightDots = dots(paper.heightMm)
  const lines: string[] = ['^XA', '^CI28', `^PW${widthDots}`, `^LL${heightDots}`, '^LH0,0']

  for (const el of elements) {
    const x = dots(el.xMm)
    const y = dots(el.yMm)
    const o = orientation(el.rotate)

    if (el.type === 'line') {
      const t = Math.max(1, dots(el.hMm))
      lines.push(`^FO${x},${y}^GB${Math.max(1, dots(el.wMm))},${t},${t}^FS`)
      continue
    }

    if (el.type === 'barcode') {
      const value = barcodeValue(el, label)
      if (!value) continue
      // hMm è l'altezza dell'intero blocco: le cifre HRI vanno sottratte alle barre,
      // esattamente come nell'anteprima HTML.
      const hriH = el.showHri ? el.fontMm + 0.8 : 0
      const barsDots = Math.max(1, dots(Math.max(1, el.hMm - hriH)))
      // Larghezza modulo: esplicita se impostata, altrimenti ricavata dalla larghezza
      // del riquadro. ^BY vuole un intero di dot, minimo 1 (sotto non è stampabile).
      const moduleMm = el.moduleMm ?? el.wMm / barcodeModuleCount(value)
      const moduleDots = Math.max(1, Math.min(10, Math.round(moduleMm * dotsPerMm)))
      const bf = barcodeField(value, moduleDots, barsDots, o, el.showHri)
      lines.push(`^FO${x},${y}${bf.command}^FD${zplText(bf.data)}^FS`)
      continue
    }

    const text = elementText(el, label)
    if (text === null) continue
    const fontDots = Math.max(6, dots(el.fontMm))
    const blockDots = Math.max(fontDots, dots(el.wMm))
    lines.push(
      `^FO${x},${y}^A0${o},${fontDots},${fontDots}` +
        `^FB${blockDots},${el.maxLines},0,${alignLetter(el.align)}` +
        `^FD${zplText(text)}^FS`
    )

    // Barrato: ZPL non ha il line-through, si disegna un filetto a metà altezza.
    // Larghezza stimata dal numero di caratteri (font scalabile ^A0 ≈ 0.6 em di avanzamento).
    if (el.strikethrough && el.rotate === 0) {
      const textW = Math.round(text.length * fontDots * 0.6)
      const offset =
        el.align === 'center'
          ? Math.round((dots(el.wMm) - textW) / 2)
          : el.align === 'right'
            ? dots(el.wMm) - textW
            : 0
      lines.push(`^FO${x + Math.max(0, offset)},${y + Math.round(fontDots / 2)}^GB${textW},2,2^FS`)
    }
  }

  lines.push('^XZ')
  return lines.join('\n') + '\n'
}
