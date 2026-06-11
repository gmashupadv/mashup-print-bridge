// src/main/printing/label-renderer.ts
// Unico punto di verità per l'aspetto di etichette e documenti non fiscali.
// Output HTML autocontenuto (misure in mm, barcode SVG inline, nessuna risorsa esterna):
// - os-printer lo stampa direttamente (silent print)
// - escpos-network lo rasterizza a bitmap (html-to-bitmap.ts)
import type { LabelData, LabelLayout, NonFiscalDoc } from '../drivers/interface'
import { ean13Svg } from './barcode'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function eurIt(n: number): string {
  return `€ ${n.toFixed(2).replace('.', ',')}`
}

export function renderLabelHtml(label: LabelData, layout: LabelLayout): string {
  const { paper, template } = layout
  const m = paper.marginsMm ?? { top: 1, right: 2, bottom: 1, left: 2 }
  const w = paper.widthMm
  const h = paper.heightMm ?? 30
  const fs = template.fontScale || 1
  const innerW = w - m.left - m.right
  const innerH = h - m.top - m.bottom

  const barcodeSvg =
    template.showBarcode && label.barcode
      ? ean13Svg(label.barcode, { heightMm: Math.min(10, innerH * 0.35), moduleMm: 0.33 })
      : ''

  const parts: string[] = []
  parts.push(`<div class="name">${esc(label.name)}</div>`)
  if (label.variant) parts.push(`<div class="variant">${esc(label.variant)}</div>`)
  parts.push(
    `<div class="row"><span class="price">${eurIt(label.price)}</span>` +
      (label.sku ? `<span class="sku">${esc(label.sku)}</span>` : '') +
      `</div>`
  )
  if (barcodeSvg) parts.push(`<div class="barcode">${barcodeSvg}</div>`)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${w}mm ${h}mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${w}mm; height: ${h}mm; }
body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #000;
  padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; overflow: hidden; }
.inner { width: ${innerW}mm; height: ${innerH}mm; display: flex; flex-direction: column; }
.name { font-size: ${(3.2 * fs).toFixed(2)}mm; font-weight: 700; line-height: 1.15;
  overflow: hidden; }
.variant { font-size: ${(2.6 * fs).toFixed(2)}mm; }
.row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.5mm; }
.price { font-size: ${(4.2 * fs).toFixed(2)}mm; font-weight: 700; }
.sku { font-size: ${(2.2 * fs).toFixed(2)}mm; font-family: monospace; }
.barcode { margin-top: auto; text-align: center; }
.barcode svg { max-width: ${innerW}mm; }
</style></head><body><div class="inner">${parts.join('')}</div></body></html>`
}

export function renderNonFiscalHtml(doc: NonFiscalDoc, widthMm: number): string {
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${widthMm}mm auto; margin: 0; }
* { margin: 0; padding: 0; }
body { width: ${widthMm}mm; font-family: monospace; color: #000; padding: 2mm; white-space: pre-wrap; }
</style></head><body>${rows}</body></html>`
}
