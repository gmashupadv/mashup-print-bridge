import { describe, it, expect } from 'vitest'
import { renderLabelHtml, renderNonFiscalHtml } from './label-renderer'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './defaults'
import type { LabelLayout } from '../drivers/interface'

const layout = { paper: DEFAULT_LABEL_PAPER, template: DEFAULT_LABEL_TEMPLATE }

describe('renderLabelHtml', () => {
  it('renders name, variant, price, sku and barcode svg', () => {
    const html = renderLabelHtml(
      { name: 'T-shirt', variant: 'M / Nero', price: 19.9, sku: 'TSH-M', barcode: '8001234567897' },
      layout
    )
    expect(html).toContain('T-shirt')
    expect(html).toContain('M / Nero')
    expect(html).toContain('19,90')
    expect(html).toContain('TSH-M')
    expect(html).toContain('<svg')
    expect(html).toContain('@page')
  })

  it('omits missing optional fields without leaving empty blocks', () => {
    const html = renderLabelHtml({ name: 'X', price: 5 }, layout)
    expect(html).not.toContain('data-type="variant"')
    expect(html).not.toContain('data-type="sku"')
    expect(html).not.toContain('data-type="compareAtPrice"')
    expect(html).not.toContain('<svg')
  })

  it('renders compareAtPrice struck-through when greater than price', () => {
    const html = renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 29.9 }, layout)
    expect(html).toContain('data-type="compareAtPrice"')
    expect(html).toContain('29,90')
    expect(html).toContain('line-through')
  })

  it('hides compareAtPrice when not greater than price', () => {
    expect(renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 19.9 }, layout)).not.toContain(
      'data-type="compareAtPrice"'
    )
    expect(renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 9.9 }, layout)).not.toContain(
      'data-type="compareAtPrice"'
    )
    expect(renderLabelHtml({ name: 'X', price: 19.9 }, layout)).not.toContain(
      'data-type="compareAtPrice"'
    )
  })

  it('escapes HTML in user data', () => {
    const html = renderLabelHtml({ name: '<b>x</b>', price: 1 }, layout)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('hides barcode when template.showBarcode is false', () => {
    const html = renderLabelHtml(
      { name: 'X', price: 1, barcode: '8001234567897' },
      { ...layout, template: { ...DEFAULT_LABEL_TEMPLATE, showBarcode: false } }
    )
    expect(html).not.toContain('<svg')
  })

  it('renders an alphanumeric SKU as Code128 instead of throwing', () => {
    const html = renderLabelHtml({ name: 'X', price: 1, barcode: 'E39C2E14' }, layout)
    expect(html).toContain('E39C2E14')
    expect(html).toContain('<svg')
  })

  it('throws only on a barcode with unprintable characters', () => {
    expect(() => renderLabelHtml({ name: 'X', price: 1, barcode: 'A\x01B' }, layout)).toThrow()
  })

  // Barcode mai sacrificato: sul layout automatico 50x30 il nome resta a 3 righe
  it('il nome del layout automatico si ferma a 3 righe', () => {
    const html = renderLabelHtml({ name: 'A', price: 1 }, layout)
    expect(html).toContain('-webkit-line-clamp:3')
  })

  // Barcode mai sacrificato: è un riquadro ancorato in basso, non un blocco in flusso
  it('il barcode del layout automatico è ancorato sotto il prezzo', () => {
    const html = renderLabelHtml({ name: 'A', price: 1, barcode: '8001234567897' }, layout)
    const bcTop = /class="el bc" style="left:[\d.]+mm;top:([\d.]+)mm/.exec(html)
    const priceTop = /data-type="price" style="left:[\d.]+mm;top:([\d.]+)mm/.exec(html)
    expect(bcTop).not.toBeNull()
    expect(priceTop).not.toBeNull()
    expect(Number(bcTop![1])).toBeGreaterThan(Number(priceTop![1]))
  })

  // Il prezzo su una riga sola non va mai a capo
  it('il prezzo a riga singola non va a capo', () => {
    const html = renderLabelHtml({ name: 'A', price: 1 }, layout)
    expect(html).toContain('white-space:nowrap')
  })

  // New: @page contains exactly size: 50mm 30mm with default layout
  it('@page has size: 50mm 30mm with default layout', () => {
    const html = renderLabelHtml({ name: 'A', price: 1 }, layout)
    expect(html).toContain('size: 50mm 30mm')
  })

  // New: layout without marginsMm/heightMm (paper only {widthMm: 40}) uses defaults
  it('paper without marginsMm/heightMm uses DEFAULT_LABEL_PAPER fallback values', () => {
    const minimalLayout = {
      paper: { widthMm: 40 },
      template: DEFAULT_LABEL_TEMPLATE,
    }
    const html = renderLabelHtml({ name: 'A', price: 1 }, minimalLayout)
    // width is 40mm
    expect(html).toContain('40mm')
    // height fallback from DEFAULT_LABEL_PAPER.heightMm = 30
    expect(html).toContain('size: 40mm 30mm')
  })

  // FIX — numeric coercion: CSS injection guard via injected widthMm string
  it('throws on non-finite widthMm (e.g. "50mm; } </style><script>")', () => {
    const injected = '50mm; } </style><script>' as unknown as number
    expect(() =>
      renderLabelHtml(
        { name: 'A', price: 1 },
        { paper: { ...DEFAULT_LABEL_PAPER, widthMm: injected }, template: DEFAULT_LABEL_TEMPLATE }
      )
    ).toThrow(/non valide/)
  })

  // FIX — numeric coercion: partial marginsMm must not produce NaN in CSS
  it('partial marginsMm { top: 2 } uses defaults for missing sides and never emits NaN', () => {
    const html = renderLabelHtml(
      { name: 'A', price: 1 },
      {
        paper: { ...DEFAULT_LABEL_PAPER, marginsMm: { top: 2 } as unknown as { top: number; right: number; bottom: number; left: number } },
        template: DEFAULT_LABEL_TEMPLATE,
      }
    )
    expect(html).not.toContain('NaN')
    // default marginsMm = { top:1, right:2, bottom:1, left:2 }; top forzato a 2 →
    // il layout automatico parte dall'angolo (left 2mm, top 2mm)
    expect(html).toContain('data-type="name" style="left:2.00mm;top:2.00mm')
  })

  // --- Modello a elementi (layout personalizzato) ---

  it('con elements espliciti stampa SOLO gli elementi elencati', () => {
    const html = renderLabelHtml(
      { name: 'Matita', price: 1.5, sku: 'MAT-1', barcode: '8001234567897' },
      {
        paper: { widthMm: 30, heightMm: 12 },
        template: {
          version: 2,
          elements: [
            { id: 'p', type: 'price', xMm: 1, yMm: 2, wMm: 28, hMm: 7, fontMm: 5, align: 'center' },
          ],
        },
      }
    )
    expect(html).toContain('1,50')
    expect(html).not.toContain('Matita')
    expect(html).not.toContain('MAT-1')
    expect(html).not.toContain('<svg')
  })

  it('salta gli elementi con visible: false', () => {
    const html = renderLabelHtml(
      { name: 'Matita', price: 1.5 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [
            { id: 'n', type: 'name', xMm: 1, yMm: 1, wMm: 40, hMm: 4, visible: false },
            { id: 'p', type: 'price', xMm: 1, yMm: 6, wMm: 40, hMm: 5 },
          ],
        },
      }
    )
    expect(html).not.toContain('Matita')
    expect(html).toContain('1,50')
  })

  it('fontScale moltiplica il corpo di tutti gli elementi', () => {
    const template = {
      version: 2 as const,
      fontScale: 2,
      elements: [{ id: 'p', type: 'price' as const, xMm: 1, yMm: 1, wMm: 40, hMm: 8, fontMm: 3 }],
    }
    const html = renderLabelHtml({ name: 'A', price: 1 }, { paper: DEFAULT_LABEL_PAPER, template })
    expect(html).toContain('font-size:6.00mm')
  })

  it('il campo text fa da formato tramite il segnaposto {value}', () => {
    const html = renderLabelHtml(
      { name: 'A', price: 1, sku: 'AB-12' },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 's', type: 'sku', xMm: 1, yMm: 1, wMm: 40, hMm: 4, text: 'Cod. {value}' }],
        },
      }
    )
    expect(html).toContain('Cod. AB-12')
  })

  it('un testo fisso viene stampato anche senza dati prodotto', () => {
    const html = renderLabelHtml(
      { name: 'A', price: 1 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 't', type: 'static', xMm: 1, yMm: 1, wMm: 40, hMm: 4, text: 'SALDI' }],
        },
      }
    )
    expect(html).toContain('SALDI')
  })

  it('la rotazione a 90° emette la transform CSS ancorata a (x, y)', () => {
    const html = renderLabelHtml(
      { name: 'A', price: 1 },
      {
        paper: { widthMm: 12, heightMm: 40 },
        template: {
          version: 2,
          elements: [
            { id: 'p', type: 'price', xMm: 2, yMm: 2, wMm: 30, hMm: 6, rotate: 90 },
          ],
        },
      }
    )
    expect(html).toContain('transform:translate(6.00mm,0) rotate(90deg)')
  })

  it('showHri false toglie le cifre sotto le barre', () => {
    const withHri = renderLabelHtml(
      { name: 'A', price: 1, barcode: '8001234567897' },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 'b', type: 'barcode', xMm: 1, yMm: 1, wMm: 40, hMm: 12 }],
        },
      }
    )
    const noHri = renderLabelHtml(
      { name: 'A', price: 1, barcode: '8001234567897' },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [
            { id: 'b', type: 'barcode', xMm: 1, yMm: 1, wMm: 40, hMm: 12, showHri: false },
          ],
        },
      }
    )
    expect(withHri).toContain('8001234567897</text>')
    expect(noHri).toContain('<svg')
    expect(noHri).not.toContain('</text>')
  })

  it('la larghezza del riquadro barcode determina la larghezza delle barre', () => {
    const make = (wMm: number) =>
      renderLabelHtml(
        { name: 'A', price: 1, barcode: '8001234567897' },
        {
          paper: { widthMm: 60, heightMm: 30 },
          template: {
            version: 2,
            elements: [{ id: 'b', type: 'barcode', xMm: 1, yMm: 1, wMm, hMm: 12 }],
          },
        }
      )
    const narrow = /<svg[^>]*width="([\d.]+)mm"/.exec(make(20))
    const wide = /<svg[^>]*width="([\d.]+)mm"/.exec(make(40))
    expect(Number(narrow![1])).toBeCloseTo(20, 1)
    expect(Number(wide![1])).toBeCloseTo(40, 1)
  })

  it('una linea diventa un rettangolo pieno', () => {
    const html = renderLabelHtml(
      { name: 'A', price: 1 },
      {
        paper: DEFAULT_LABEL_PAPER,
        template: {
          version: 2,
          elements: [{ id: 'l', type: 'line', xMm: 2, yMm: 10, wMm: 46, hMm: 0.4 }],
        },
      }
    )
    expect(html).toContain('class="el line" style="left:2.00mm;top:10.00mm;width:46.00mm;height:0.40mm')
  })
})

describe('renderNonFiscalHtml', () => {
  it('renders lines with style attributes', () => {
    const html = renderNonFiscalHtml(
      { lines: [{ text: 'PRECONTO', bold: true, size: 'double', align: 'center' }, { text: 'riga' }] },
      80
    )
    expect(html).toContain('PRECONTO')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('text-align:center')
  })

  // Fix #2: valid @page size for non fiscal
  it('@page has size: 80mm 297mm (not "auto")', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'x' }] }, 80)
    expect(html).toContain('size: 80mm 297mm')
    expect(html).not.toContain('size: 80mm auto')
  })

  // Fix #3: box-sizing: border-box in reset
  it('CSS reset includes box-sizing: border-box', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'x' }] }, 80)
    expect(html).toContain('box-sizing: border-box')
  })

  // New: empty line renders &nbsp;
  it('empty text line renders as &nbsp;', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: '' }] }, 80)
    expect(html).toContain('&nbsp;')
  })

  // New: size double → font-size:6mm
  it('size double renders font-size:6mm', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'X', size: 'double' }] }, 80)
    expect(html).toContain('font-size:6mm')
  })

  // New: align right → text-align:right
  it('align right renders text-align:right', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'X', align: 'right' }] }, 80)
    expect(html).toContain('text-align:right')
  })

  // New: HTML escaping in non-fiscal
  it('escapes HTML special characters in line text', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: '<b>hello</b>' }] }, 80)
    expect(html).not.toContain('<b>hello</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  // FIX 2: renderNonFiscalHtml with explicit heightMm uses it in @page
  it('renderNonFiscalHtml(doc, 80, 120) contains size: 80mm 120mm', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'x' }] }, 80, 120)
    expect(html).toContain('size: 80mm 120mm')
  })

  // FIX 2: renderNonFiscalHtml without third arg falls back to 297mm
  it('renderNonFiscalHtml(doc, 80) without third arg contains size: 80mm 297mm', () => {
    const html = renderNonFiscalHtml({ lines: [{ text: 'x' }] }, 80)
    expect(html).toContain('size: 80mm 297mm')
  })

  // FIX — numeric coercion: non-finite widthMm throws
  it('throws on non-finite widthMm (e.g. "x" as any)', () => {
    expect(() =>
      renderNonFiscalHtml({ lines: [{ text: 'x' }] }, 'x' as unknown as number)
    ).toThrow(/non valide/)
  })
})

// Layout con un solo elemento nome, per verificare l'adattamento del corpo.
const nameOnly = (autoFit: boolean, extra: Record<string, unknown> = {}): LabelLayout => ({
  paper: { widthMm: 50, heightMm: 30, marginsMm: { top: 1, right: 2, bottom: 1, left: 2 } },
  template: {
    version: 2,
    elements: [
      {
        id: 'n',
        type: 'name',
        xMm: 2,
        yMm: 2,
        wMm: 26,
        hMm: 4,
        fontMm: 3,
        maxLines: 1,
        autoFit,
        ...extra,
      },
    ],
  },
})

describe('renderLabelHtml — adattamento del corpo', () => {
  const long = { name: 'Rossetto liquido opaco', price: 9.9 }

  it('senza autoFit tiene il corpo dichiarato', () => {
    expect(renderLabelHtml(long, nameOnly(false))).toContain('font-size:3.00mm')
  })

  it('con autoFit riduce il corpo perché il nome entri nel riquadro', () => {
    const html = renderLabelHtml(long, nameOnly(true))
    expect(html).not.toContain('font-size:3.00mm')
    const m = html.match(/data-type="name"[^>]*/)
    const font = Number(/font-size:([\d.]+)mm/.exec(html)![1])
    expect(m).toBeTruthy()
    expect(font).toBeLessThan(3)
    expect(font).toBeGreaterThanOrEqual(1.8)
  })

  it('un nome corto non viene rimpicciolito', () => {
    expect(renderLabelHtml({ name: 'Matita', price: 2 }, nameOnly(true))).toContain('font-size:3.00mm')
  })
})
