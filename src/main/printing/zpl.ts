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
  // Respiro extra in alto: ~1.5mm sopra il margine configurato, così la prima riga non resta
  // incollata/tagliata al bordo superiore (offset tipico di queste etichettatrici termiche).
  const top = Math.round((m.top + 1.5) * dotsPerMm)
  const bottom = Math.round(m.bottom * dotsPerMm)
  const innerW = widthDots - Math.round((m.left + m.right) * dotsPerMm)

  const lines: string[] = ['^XA', '^CI28', `^PW${widthDots}`, `^LL${heightDots}`, '^LH0,0']

  // --- Barcode ancorato in basso: 7mm di barre (leggibile, non invadente; prima erano 12mm). ---
  // Riserviamo il blocco in fondo PRIMA di posizionare il resto, così il prezzo gli sta sopra.
  const hasBarcode = !!(layout.template.showBarcode && label.barcode)
  const barcodeH = Math.round(7 * dotsPerMm)
  const barcodeBlock = hasBarcode ? barcodeH + Math.round(3 * dotsPerMm) : 0 // +3mm per la riga cifre HRI
  const barcodeY = heightDots - bottom - barcodeBlock

  // --- Prezzo (moderato, non gigante: 30 dot vs i 44 di prima), ancorato sopra il barcode. ---
  // Il prezzo di confronto barrato va IN LINEA, a destra del prezzo: recupera una riga verticale.
  const priceH = Math.round(30 * fs)
  const cmp = Number(label.compareAtPrice)
  const hasCompare = Number.isFinite(cmp) && cmp > label.price
  const cmpH = Math.round(18 * fs)
  const priceBlockH = priceH // compare è in linea, non aggiunge altezza

  // --- Nome: font compatto (22 dot). Il numero di righe è ADATTIVO allo spazio disponibile
  //     sopra il blocco prezzo: titoli lunghi prendono fino a 4 righe su etichette grandi,
  //     meno su quelle piccole — così non sforano mai sul prezzo/barcode. ---
  const nameH = Math.round(22 * fs)
  const vH = Math.round(17 * fs)
  const variantBlock = label.variant ? vH + 4 : 0
  const priceBlockY = Math.max(top, barcodeY - 6 - priceBlockH)
  const availForName = priceBlockY - top - variantBlock - 6
  const nameLines = Math.max(1, Math.min(4, Math.floor(availForName / nameH)))

  let y = top
  lines.push(`^FO${x},${y}^A0N,${nameH},${nameH}^FB${innerW},${nameLines},0,L^FD${zplText(label.name)}^FS`)
  y += nameH * nameLines + 6

  if (label.variant) {
    lines.push(`^FO${x},${y}^A0N,${vH},${vH}^FD${zplText(label.variant)}^FS`)
    y += vH + 4
  }

  const py = priceBlockY
  lines.push(`^FO${x},${py}^A0N,${priceH},${priceH}^FD${zplText(eurIt(label.price))}^FS`)

  // Prezzo di confronto barrato IN LINEA, a destra del prezzo (allineato in basso alla sua baseline).
  if (hasCompare) {
    const cmpStr = eurIt(cmp)
    const priceW = Math.round(eurIt(label.price).length * priceH * 0.6)
    const cmpX = x + priceW + Math.round(2 * dotsPerMm)
    const cmpY = py + (priceH - cmpH)
    lines.push(`^FO${cmpX},${cmpY}^A0N,${cmpH},${cmpH}^FD${zplText(cmpStr)}^FS`)
    const cmpW = Math.round(cmpStr.length * cmpH * 0.6)
    lines.push(`^FO${cmpX},${cmpY + Math.round(cmpH / 2)}^GB${cmpW},2,2^FS`)
  }

  // SKU piccolo, allineato a destra sulla riga del prezzo (come le etichette retail).
  if (label.sku) {
    const skuH = Math.round(16 * fs)
    lines.push(`^FO${x},${py + (priceH - skuH)}^A0N,${skuH},${skuH}^FB${innerW},1,0,R^FD${zplText(label.sku)}^FS`)
  }

  // Barcode nativo in fondo.
  if (hasBarcode) {
    const bf = barcodeField(String(label.barcode), 2, barcodeH)
    lines.push(`^FO${x},${barcodeY}${bf.command}^FD${bf.data}^FS`)
  }

  lines.push('^XZ')
  return lines.join('\n') + '\n'
}
