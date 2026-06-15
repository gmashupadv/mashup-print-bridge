import { describe, it, expect } from 'vitest'
import { receiptKeySequence, KEY, DitronKeycodeDriver } from './ditron-keycode'

const item = (department: number, unitPrice: number, quantity = 1) => ({
  department,
  unitPrice,
  quantity,
  description: '',
  vatRate: 22,
})

describe('receiptKeySequence', () => {
  it('vendita semplice: CL, cifre prezzo in centesimi, reparto, importo, totale', () => {
    const keys = receiptKeySequence({
      items: [item(3, 1.5)],
      discount: 0,
      payments: [{ description: 'contanti', amount: 1.5, paymentType: 0 }],
    })
    expect(keys).toEqual([
      KEY.clear,
      KEY.digits[1], KEY.digits[5], KEY.digits[0], // 150 centesimi
      KEY.departments[2], // reparto 3
      KEY.digits[1], KEY.digits[5], KEY.digits[0],
      KEY.total,
    ])
  })

  it('quantità ≠ 1 passa dal moltiplicatore', () => {
    const keys = receiptKeySequence({
      items: [item(1, 0.5, 3)],
      discount: 0,
      payments: [{ description: 'contanti', amount: 1.5, paymentType: 0 }],
    })
    expect(keys.slice(1, 3)).toEqual([KEY.digits[3], KEY.multiplier])
  })

  it('pagamento carta usa il tasto carta di credito', () => {
    const keys = receiptKeySequence({
      items: [item(1, 1)],
      discount: 0,
      payments: [{ description: 'carta', amount: 1, paymentType: 1 }],
    })
    expect(keys[keys.length - 1]).toBe(KEY.creditCard)
  })

  it('sconto a valore: subtotale, importo, decremento assoluto', () => {
    const keys = receiptKeySequence({
      items: [item(1, 10)],
      discount: 1,
      payments: [{ description: 'contanti', amount: 9, paymentType: 0 }],
    })
    const i = keys.indexOf(KEY.subtotal)
    expect(i).toBeGreaterThan(0)
    expect(keys.slice(i, i + 5)).toEqual([
      KEY.subtotal,
      KEY.digits[1], KEY.digits[0], KEY.digits[0], // 100 centesimi
      KEY.absoluteDecrease,
    ])
  })

  it('rifiuta reparto fuori range e importi non validi', () => {
    expect(() =>
      receiptKeySequence({ items: [item(21, 1)], discount: 0, payments: [] }),
    ).toThrow(/Reparto/)
    expect(() =>
      receiptKeySequence({ items: [item(1, 0)], discount: 0, payments: [] }),
    ).toThrow(/Importo/)
    expect(() =>
      receiptKeySequence({ items: [item(1, 1, 1.5)], discount: 0, payments: [] }),
    ).toThrow(/Quantità/)
  })
})

describe('capabilities', () => {
  it('dichiara fiscal-receipt, daily-close e drawer', () => {
    const caps = new DitronKeycodeDriver().capabilities
    expect(caps).toContain('fiscal-receipt')
    expect(caps).toContain('daily-close')
    expect(caps).toContain('drawer')
  })
})
