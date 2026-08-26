// src/main/printing/label-renderer.ts
// Unico punto di verità per l'aspetto di etichette e documenti non fiscali.
// Output HTML autocontenuto (misure in mm, barcode SVG inline, nessuna risorsa esterna):
// - os-printer lo stampa direttamente (silent print)
// - escpos-network lo rasterizza a bitmap (html-to-bitmap.ts)
// - la finestra di configurazione lo usa come anteprima WYSIWYG dell'editor
//
// Il layout viene dal modello a elementi di label-template.ts: ogni elemento è
// un riquadro in millimetri assoluti, reso con position:absolute. Lo stesso
// modello guida zpl.ts, così anteprima e stampa Zebra coincidono.
import type { LabelData, LabelLayout, NonFiscalDoc } from '../drivers/interface'
import { barcodeSvg, barcodeModuleCount } from './barcode'
import {
  barcodeValue,
  elementText,
  resolveElements,
  resolvePaper,
  type ResolvedElement,
} from './label-template'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mm(n: number): string {
  return `${n.toFixed(2)}mm`
}

// Rotazione oraria attorno all'angolo alto-sinistro, poi ritraslata così che il
// riquadro ruotato resti ancorato a (x, y) ed estenda verso destra/basso —
// stessa convenzione dei campi ruotati ZPL (^A0R/^A0I/^A0B).
function rotationCss(el: ResolvedElement): string {
  switch (el.rotate) {
    case 90:
      return `transform:translate(${mm(el.hMm)},0) rotate(90deg);`
    case 180:
      return `transform:translate(${mm(el.wMm)},${mm(el.hMm)}) rotate(180deg);`
    case 270:
      return `transform:translate(0,${mm(el.wMm)}) rotate(-90deg);`
    default:
      return ''
  }
}

function boxCss(el: ResolvedElement): string {
  return (
    `left:${mm(el.xMm)};top:${mm(el.yMm)};width:${mm(el.wMm)};height:${mm(el.hMm)};` + rotationCss(el)
  )
}

function renderElement(el: ResolvedElement, label: LabelData): string {
  if (el.type === 'line') {
    return `<div class="el line" style="${boxCss(el)}"></div>`
  }

  if (el.type === 'barcode') {
    const value = barcodeValue(el, label)
    if (!value) return ''
    // hMm è l'altezza dell'INTERO blocco (barre + cifre): il riquadro che si
    // trascina nell'editor è esattamente quello che finisce sull'etichetta.
    const hriH = el.showHri ? el.fontMm + 0.8 : 0
    const barsH = Math.max(1, el.hMm - hriH)
    // Senza moduleMm esplicito la larghezza del modulo si ricava dalla larghezza
    // voluta: ridimensionare il riquadro allarga/stringe le barre.
    const moduleMm = el.moduleMm ?? Math.max(0.125, el.wMm / barcodeModuleCount(value))
    const svg = barcodeSvg(value, {
      heightMm: barsH,
      moduleMm,
      fontMm: el.fontMm,
      hri: el.showHri,
    })
    return `<div class="el bc" style="${boxCss(el)}text-align:${el.align};">${svg}</div>`
  }

  const text = elementText(el, label)
  if (text === null) return ''
  const styles = [
    boxCss(el),
    `font-size:${mm(el.fontMm)}`,
    `text-align:${el.align}`,
    `-webkit-line-clamp:${el.maxLines}`,
    el.bold ? 'font-weight:700' : 'font-weight:400',
    el.strikethrough ? 'text-decoration:line-through' : '',
    el.maxLines === 1 ? 'white-space:nowrap' : '',
  ]
    .filter(Boolean)
    .join(';')
  return `<div class="el txt" data-type="${el.type}" style="${styles}">${esc(text)}</div>`
}

export function renderLabelHtml(label: LabelData, layout: LabelLayout): string {
  const paper = resolvePaper(layout.paper)
  const elements = resolveElements(layout.template, paper)
  const body = elements.map((el) => renderElement(el, label)).join('')
  const w = paper.widthMm
  const h = paper.heightMm

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${w}mm ${h}mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${w}mm; height: ${h}mm; }
body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #000;
  position: relative; overflow: hidden; }
.el { position: absolute; overflow: hidden; transform-origin: 0 0; }
.txt { display: -webkit-box; -webkit-box-orient: vertical; line-height: 1.1;
  overflow-wrap: break-word; }
.line { background: #000; }
.bc { line-height: 0; }
.bc svg { display: inline-block; max-width: 100%; max-height: 100%; }
</style></head><body>${body}</body></html>`
}

export function renderNonFiscalHtml(doc: NonFiscalDoc, widthMm: number, heightMm?: number): string {
  // doc.cut è ignorato qui: la responsabilità del taglio carta appartiene al driver, non al renderer HTML.
  // heightMm: l'altezza la passa il chiamante per farla coincidere col pageSize di stampa.
  // Se omessa, si usa 297mm (A4) come fallback sicuro per driver che non impostano un pageSize esplicito.
  // Fix: numeric coercion guard against CSS injection from unvalidated IPC inputs
  const w = Number(widthMm)
  const hVal = heightMm !== undefined ? Number(heightMm) : 297
  if (!Number.isFinite(w) || !Number.isFinite(hVal)) {
    throw new Error(`Dimensioni documento non valide: ${widthMm}x${heightMm}`)
  }
  const rows = doc.lines
    .map((l) => {
      const styles = [
        `text-align:${l.align ?? 'left'}`,
        l.bold ? 'font-weight:bold' : '',
        l.size === 'double' ? 'font-size:6mm' : 'font-size:3mm',
      ]
        .filter(Boolean)
        .join(';')
      return `<div style="${styles}">${esc(l.text) || '&nbsp;'}</div>`
    })
    .join('')
  // Fix #2: "size: Xmm auto" è CSS invalido — Chromium scarta la dichiarazione e usa A4 di default.
  // L'altezza la passa il chiamante; se non specificata cade su 297mm.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${w}mm ${hVal}mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${w}mm; font-family: monospace; color: #000; padding: 2mm; white-space: pre-wrap; }
</style></head><body>${rows}</body></html>`
}
