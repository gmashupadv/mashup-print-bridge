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
    expect(html).not.toContain('<svg')
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

  it('throws on invalid barcode', () => {
    expect(() => renderLabelHtml({ name: 'X', price: 1, barcode: 'NOT-EAN' }, layout)).toThrow(/EAN-13/i)
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
})
