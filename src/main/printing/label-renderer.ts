// src/main/printing/label-renderer.ts
// Unico punto di verità per l'aspetto di etichette e documenti non fiscali.
// Output HTML autocontenuto (misure in mm, barcode SVG inline, nessuna risorsa esterna):
// - os-printer lo stampa direttamente (silent print)
// - escpos-network lo rasterizza a bitmap (html-to-bitmap.ts)
import type { LabelData, LabelLayout, NonFiscalDoc } from '../drivers/interface'
import { ean13Svg } from './barcode'
import { DEFAULT_LABEL_PAPER } from './defaults'

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
  // Fix #6: use DEFAULT_LABEL_PAPER for fallback margins and height instead of duplicating literals
  const m = paper.marginsMm ?? DEFAULT_LABEL_PAPER.marginsMm!
  const w = paper.widthMm
  const h = paper.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!
  const fs = template.fontScale || 1
  const innerW = w - m.left - m.right
  const innerH = h - m.top - m.bottom

  const barcodeSvg =
    template.showBarcode && label.barcode
      ? ean13Svg(label.barcode, {
          heightMm: Math.min(10, innerH * 0.35),
          // Fix #4: 0.375mm = 3 dot esatti a 203dpi — evita barre anti-aliased nella rasterizzazione ESC/POS
          moduleMm: 0.375,
        })
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
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.variant { font-size: ${(2.6 * fs).toFixed(2)}mm; }
.row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.5mm; }
.price { font-size: ${(4.2 * fs).toFixed(2)}mm; font-weight: 700; white-space: nowrap; }
.sku { font-size: ${(2.2 * fs).toFixed(2)}mm; font-family: monospace; }
.barcode { margin-top: auto; text-align: center; flex-shrink: 0; }
.barcode svg { max-width: ${innerW}mm; }
</style></head><body><div class="inner">${parts.join('')}</div></body></html>`
}

export function renderNonFiscalHtml(doc: NonFiscalDoc, widthMm: number, heightMm?: number): string {
  // doc.cut è ignorato qui: la responsabilità del taglio carta appartiene al driver, non al renderer HTML.
  // heightMm: l'altezza la passa il chiamante per farla coincidere col pageSize di stampa.
  // Se omessa, si usa 297mm (A4) come fallback sicuro per driver che non impostano un pageSize esplicito.
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
@page { size: ${widthMm}mm ${heightMm ?? 297}mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${widthMm}mm; font-family: monospace; color: #000; padding: 2mm; white-space: pre-wrap; }
</style></head><body>${rows}</body></html>`
}
