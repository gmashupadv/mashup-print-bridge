import { describe, it, expect } from 'vitest'
import { renderLabelHtml, renderNonFiscalHtml } from './label-renderer'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './defaults'

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
    expect(html).not.toContain('class="variant"')
    expect(html).not.toContain('class="sku"')
    expect(html).not.toContain('class="compare"')
    expect(html).not.toContain('<svg')
  })

  it('renders compareAtPrice struck-through when greater than price', () => {
    const html = renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 29.9 }, layout)
    expect(html).toContain('class="compare"')
    expect(html).toContain('29,90')
    expect(html).toContain('line-through')
  })

  it('hides compareAtPrice when not greater than price', () => {
    expect(renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 19.9 }, layout)).not.toContain(
      'class="compare"'
    )
    expect(renderLabelHtml({ name: 'X', price: 19.9, compareAtPrice: 9.9 }, layout)).not.toContain(
      'class="compare"'
    )
    expect(renderLabelHtml({ name: 'X', price: 19.9 }, layout)).not.toContain('class="compare"')
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

  // Fix #1: barcode never sacrificed — .name clamps to 3 lines (più spazio ai titoli lunghi)
  it('.name style contains -webkit-line-clamp: 3', () => {
    const html = renderLabelHtml({ name: 'A', price: 1 }, layout)
    expect(html).toContain('-webkit-line-clamp: 3')
  })

  // Fix #1: barcode never sacrificed — .barcode has flex-shrink: 0
  it('.barcode style contains flex-shrink: 0', () => {
    const html = renderLabelHtml({ name: 'A', price: 1, barcode: '8001234567897' }, layout)
    expect(html).toContain('flex-shrink: 0')
  })

  // Fix #5: .price is not breakable
  it('.price style contains white-space: nowrap', () => {
    const html = renderLabelHtml({ name: 'A', price: 1 }, layout)
    expect(html).toContain('white-space: nowrap')
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
    // default marginsMm = { top:1, right:2, bottom:1, left:2 }; top overridden to 2
    expect(html).toContain('padding: 2mm 2mm 1mm 2mm')
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
