// src/main/printing/zpl.ts
// Genera ZPL (Zebra Programming Language) per etichette prodotto.
// Usato dal driver zpl-network per stampanti che emulano Zebra (Printex G300, Godex, TSC, Zebra…).
// I barcode sono NATIVI della stampante (^BE EAN-13, ^BC Code128): niente raster, niente offscreen.
import type { LabelData, LabelLayout } from '../drivers/interface'
import { DEFAULT_LABEL_PAPER } from './defaults'
import { ean13Checksum } from './barcode'

// 203 dpi è lo standard Zebra (8 dot/mm). Il G300 è 200dpi → ~1.5% di scostamento, irrilevante.
const DOTS_PER_MM = 8

// ZPL usa ^ e ~ come prefissi comando: vanno neutralizzati nei dati di testo.
function zplText(s: string): string {
  return s.replace(/[\^~]/g, ' ')
}

function eurIt(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €'
}

interface BarcodeField {
  command: string
  data: string
}

// EAN-13 se 12/13 cifre (checksum valido per i 13), altrimenti Code128 — stessa logica di barcodeSvg.
function barcodeField(raw: string, moduleDots: number, heightDots: number): BarcodeField {
  const v = raw.trim()
  if (/^\d{12}$/.test(v) || (/^\d{13}$/.test(v) && Number(v[12]) === ean13Checksum(v.slice(0, 12)))) {
    // ^BE = EAN-13: passiamo 12 cifre, il check digit lo calcola la stampante
    return { command: `^BY${moduleDots}^BEN,${heightDots},Y,N`, data: v.slice(0, 12) }
  }
  return { command: `^BY${moduleDots}^BCN,${heightDots},Y,N,N`, data: v }
}

export function buildLabelZpl(label: LabelData, layout: LabelLayout, dotsPerMm = DOTS_PER_MM): string {
  const paper = { ...DEFAULT_LABEL_PAPER, ...layout.paper }
  const m = { ...DEFAULT_LABEL_PAPER.marginsMm!, ...paper.marginsMm }
  const fs = layout.template.fontScale || 1
  const widthDots = Math.round(paper.widthMm * dotsPerMm)
  const heightDots = Math.round((paper.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!) * dotsPerMm)
  const x = Math.round(m.left * dotsPerMm)
  const innerW = widthDots - Math.round((m.left + m.right) * dotsPerMm)
  let y = Math.round(m.top * dotsPerMm)

  const lines: string[] = ['^XA', '^CI28', `^PW${widthDots}`, `^LL${heightDots}`, '^LH0,0']

  // Nome prodotto: word-wrap su max 2 righe nella larghezza interna (^FB)
  const nameH = Math.round(28 * fs)
  lines.push(`^FO${x},${y}^A0N,${nameH},${nameH}^FB${innerW},2,0,L^FD${zplText(label.name)}^FS`)
  y += nameH * 2 + 6

  if (label.variant) {
    const vH = Math.round(20 * fs)
    lines.push(`^FO${x},${y}^A0N,${vH},${vH}^FD${zplText(label.variant)}^FS`)
    y += vH + 4
  }

  // Prezzo (grande) a sinistra; SKU piccolo allineato a destra sulla stessa riga
  const priceH = Math.round(44 * fs)
  lines.push(`^FO${x},${y}^A0N,${priceH},${priceH}^FD${zplText(eurIt(label.price))}^FS`)
  if (label.sku) {
    const skuH = Math.round(20 * fs)
    lines.push(`^FO${x},${y}^A0N,${skuH},${skuH}^FB${innerW},1,0,R^FD${zplText(label.sku)}^FS`)
  }
  y += priceH + 8

  // Barcode nativo in fondo, se c'è spazio
  if (layout.template.showBarcode && label.barcode) {
    const bottom = Math.round(m.bottom * dotsPerMm)
    const bcH = Math.min(Math.round(12 * dotsPerMm), heightDots - y - bottom - 12)
    if (bcH > 10) {
      const bf = barcodeField(String(label.barcode), 2, bcH)
      lines.push(`^FO${x},${y}${bf.command}^FD${bf.data}^FS`)
    }
  }

  lines.push('^XZ')
  return lines.join('\n') + '\n'
}
