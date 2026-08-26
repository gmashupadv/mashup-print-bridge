import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LABEL_PAPER,
  barcodeValue,
  defaultElementsFor,
  elementText,
  materializeTemplate,
  resolveElements,
  resolvePaper,
  scaleLayout,
} from './label-template'
import type { LabelData } from '../drivers/interface'

const label: LabelData = {
  name: 'Matita occhi',
  variant: 'Nero',
  price: 4.5,
  compareAtPrice: 6,
  sku: 'MAT-01',
  barcode: '8001234567897',
}

describe('resolvePaper', () => {
  it('completa altezza e margini mancanti con i valori di default', () => {
    const p = resolvePaper({ widthMm: 40 })
    expect(p.heightMm).toBe(DEFAULT_LABEL_PAPER.heightMm)
    expect(p.margins).toEqual(DEFAULT_LABEL_PAPER.marginsMm)
    expect(p.innerW).toBe(40 - 2 - 2)
  })

  it('fonde i margini campo per campo senza produrre NaN', () => {
    const p = resolvePaper({
      widthMm: 50,
      marginsMm: { top: 3 } as unknown as { top: number; right: number; bottom: number; left: number },
    })
    expect(p.margins).toEqual({ top: 3, right: 2, bottom: 1, left: 2 })
    expect(Number.isNaN(p.innerH)).toBe(false)
  })

  it('lancia su dimensioni non numeriche (guardia contro iniezione CSS/ZPL)', () => {
    expect(() => resolvePaper({ widthMm: '40mm; }</style>' as unknown as number })).toThrow(
      /non valide/
    )
  })
})

describe('defaultElementsFor', () => {
  it('produce il layout storico: nome, variante, prezzo, confronto, SKU, barcode', () => {
    const els = defaultElementsFor(resolvePaper(DEFAULT_LABEL_PAPER))
    expect(els.map((e) => e.type)).toEqual([
      'name',
      'variant',
      'price',
      'compareAtPrice',
      'sku',
      'barcode',
    ])
  })

  it('ancora il barcode sotto al prezzo e il prezzo sotto al nome', () => {
    const els = defaultElementsFor(resolvePaper(DEFAULT_LABEL_PAPER))
    const y = (t: string) => els.find((e) => e.type === t)!.yMm
    expect(y('name')).toBeLessThan(y('price'))
    expect(y('price')).toBeLessThan(y('barcode'))
  })

  it('senza barcode il layout resta dentro la carta', () => {
    const paper = resolvePaper(DEFAULT_LABEL_PAPER)
    const els = defaultElementsFor(paper, false)
    const bc = els.find((e) => e.type === 'barcode')!
    expect(bc.visible).toBe(false)
    for (const el of els.filter((e) => e.visible !== false)) {
      expect(el.yMm + (el.hMm ?? 0)).toBeLessThanOrEqual(paper.heightMm + 0.01)
    }
  })

  // Etichette minuscole (matite, cosmetici): il layout non deve collassare in negativo
  it('su una 25×12 non genera altezze o coordinate negative', () => {
    const els = defaultElementsFor(resolvePaper({ widthMm: 25, heightMm: 12 }))
    for (const el of els) {
      expect(el.xMm).toBeGreaterThanOrEqual(0)
      expect(el.yMm).toBeGreaterThanOrEqual(0)
      expect(el.wMm).toBeGreaterThan(0)
      expect(el.hMm ?? 1).toBeGreaterThan(0)
    }
  })
})

describe('resolveElements', () => {
  const paper = resolvePaper(DEFAULT_LABEL_PAPER)

  it('senza elements cade sul layout automatico', () => {
    expect(resolveElements({}, paper).map((e) => e.type)).toContain('barcode')
  })

  it('con elements usa esattamente quelli', () => {
    const out = resolveElements(
      { version: 2, elements: [{ id: 'p', type: 'price', xMm: 1, yMm: 1, wMm: 10 }] },
      paper
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('price')
  })

  it('scarta gli elementi nascosti', () => {
    const out = resolveElements(
      {
        version: 2,
        elements: [
          { id: 'a', type: 'price', xMm: 1, yMm: 1, wMm: 10, visible: false },
          { id: 'b', type: 'sku', xMm: 1, yMm: 6, wMm: 10 },
        ],
      },
      paper
    )
    expect(out.map((e) => e.type)).toEqual(['sku'])
  })

  it('showBarcode: false resta un interruttore globale anche sui layout v2', () => {
    const out = resolveElements(
      {
        version: 2,
        showBarcode: false,
        elements: [
          { id: 'b', type: 'barcode', xMm: 1, yMm: 1, wMm: 40, hMm: 10 },
          { id: 'p', type: 'price', xMm: 1, yMm: 14, wMm: 40 },
        ],
      },
      paper
    )
    expect(out.map((e) => e.type)).toEqual(['price'])
  })

  it('coercizza i valori non numerici invece di propagare NaN', () => {
    const out = resolveElements(
      {
        version: 2,
        elements: [
          {
            id: 'p',
            type: 'price',
            xMm: 'x' as unknown as number,
            yMm: 2,
            wMm: 10,
            fontMm: 'y' as unknown as number,
          },
        ],
      },
      paper
    )
    expect(out[0].xMm).toBe(0)
    expect(Number.isFinite(out[0].fontMm)).toBe(true)
  })

  it('ignora un fontScale non valido invece di azzerare i corpi', () => {
    const els = [{ id: 'p', type: 'price' as const, xMm: 1, yMm: 1, wMm: 10, fontMm: 3 }]
    expect(resolveElements({ version: 2, fontScale: 0, elements: els }, paper)[0].fontMm).toBe(3)
    expect(
      resolveElements({ version: 2, fontScale: NaN, elements: els }, paper)[0].fontMm
    ).toBe(3)
  })
})

describe('elementText', () => {
  const paper = resolvePaper(DEFAULT_LABEL_PAPER)
  const resolve = (el: Parameters<typeof resolveElements>[0]) => resolveElements(el, paper)[0]

  it('formatta il prezzo in euro con la virgola', () => {
    const el = resolve({ version: 2, elements: [{ id: 'p', type: 'price', xMm: 0, yMm: 0, wMm: 10 }] })
    expect(elementText(el, label)).toBe('€ 4,50')
  })

  it('mostra il prezzo pieno solo se maggiore del prezzo di vendita', () => {
    const el = resolve({
      version: 2,
      elements: [{ id: 'c', type: 'compareAtPrice', xMm: 0, yMm: 0, wMm: 10 }],
    })
    expect(elementText(el, label)).toBe('€ 6,00')
    expect(elementText(el, { ...label, compareAtPrice: 4.5 })).toBeNull()
    expect(elementText(el, { ...label, compareAtPrice: undefined })).toBeNull()
  })

  it('restituisce null sui campi assenti, così l\'elemento sparisce', () => {
    const el = resolve({ version: 2, elements: [{ id: 's', type: 'sku', xMm: 0, yMm: 0, wMm: 10 }] })
    expect(elementText(el, { name: 'X', price: 1 })).toBeNull()
  })

  it('applica il formato {value}', () => {
    const el = resolve({
      version: 2,
      elements: [{ id: 's', type: 'sku', xMm: 0, yMm: 0, wMm: 10, text: 'Cod. {value}' }],
    })
    expect(elementText(el, label)).toBe('Cod. MAT-01')
  })
})

describe('barcodeValue', () => {
  const paper = resolvePaper(DEFAULT_LABEL_PAPER)
  const resolve = (el: Parameters<typeof resolveElements>[0]) => resolveElements(el, paper)[0]

  it('usa il barcode del prodotto quando non c\'è un codice fisso', () => {
    const el = resolve({
      version: 2,
      elements: [{ id: 'b', type: 'barcode', xMm: 0, yMm: 0, wMm: 40, hMm: 10 }],
    })
    expect(barcodeValue(el, label)).toBe('8001234567897')
    expect(barcodeValue(el, { name: 'X', price: 1 })).toBeNull()
  })

  it('un codice fisso ha la precedenza sul dato del prodotto', () => {
    const el = resolve({
      version: 2,
      elements: [{ id: 'b', type: 'barcode', xMm: 0, yMm: 0, wMm: 40, hMm: 10, text: '12345678' }],
    })
    expect(barcodeValue(el, label)).toBe('12345678')
  })
})

describe('materializeTemplate', () => {
  it('trasforma il layout automatico in elementi modificabili', () => {
    const t = materializeTemplate({ showBarcode: true, fontScale: 1 }, DEFAULT_LABEL_PAPER)
    expect(t.version).toBe(2)
    expect(t.elements!.length).toBeGreaterThan(0)
  })

  it('lascia intatto un layout già personalizzato', () => {
    const elements = [{ id: 'p', type: 'price' as const, xMm: 1, yMm: 1, wMm: 10 }]
    expect(materializeTemplate({ version: 2, elements }, DEFAULT_LABEL_PAPER).elements).toEqual(
      elements
    )
  })

  it('materializza sulla carta corrente, non su quella di default', () => {
    const t = materializeTemplate({}, { widthMm: 100, heightMm: 60 })
    const name = t.elements!.find((e) => e.type === 'name')!
    expect(name.wMm).toBe(100 - 2 - 2)
  })
})

describe('scaleLayout', () => {
  const layout = {
    paper: { widthMm: 80, heightMm: 40, marginsMm: { top: 2, right: 4, bottom: 2, left: 4 } },
    template: {
      version: 2 as const,
      elements: [
        { id: 'p', type: 'price' as const, xMm: 40, yMm: 10, wMm: 36, hMm: 8, fontMm: 5 },
      ],
    },
  }

  it('riscala carta, margini, coordinate e corpi con lo stesso fattore', () => {
    const out = scaleLayout(layout, 0.9)
    expect(out.paper.widthMm).toBe(72)
    expect(out.paper.heightMm).toBe(36)
    expect(out.paper.marginsMm).toEqual({ top: 1.8, right: 3.6, bottom: 1.8, left: 3.6 })
    const el = out.template.elements![0]
    expect(el.xMm).toBe(36)
    expect(el.wMm).toBeCloseTo(32.4, 5)
    expect(el.fontMm).toBeCloseTo(4.5, 5)
  })

  it('tiene gli elementi dentro la larghezza stampabile', () => {
    const out = scaleLayout(layout, 72 / 80)
    const el = out.template.elements![0]
    expect(el.xMm + el.wMm!).toBeLessThanOrEqual(out.paper.widthMm + 0.001)
  })

  it('un fattore neutro o non valido restituisce il layout invariato', () => {
    expect(scaleLayout(layout, 1)).toBe(layout)
    expect(scaleLayout(layout, 0)).toBe(layout)
    expect(scaleLayout(layout, NaN)).toBe(layout)
  })
})
