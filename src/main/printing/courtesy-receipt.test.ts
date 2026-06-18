import { describe, it, expect } from 'vitest'
import { buildCourtesyDoc } from './courtesy-receipt'
import type { NonFiscalDoc } from '../drivers/interface'

const texts = (doc: NonFiscalDoc): string[] => doc.lines.map((l) => l.text)

describe('buildCourtesyDoc', () => {
  it('compone i blocchi in ordine con una riga vuota tra di essi', () => {
    const doc = buildCourtesyDoc({
      header: ['I.P.S. S.R.L.', 'P.Iva 02782600619'],
      number: '1329',
      date: '17/06/2026',
      items: ['ABITO DONNA'],
      returnPolicy: ['Hai 30 giorni'],
      footer: ['RT 2CITP017007'],
    })
    expect(texts(doc)).toEqual([
      'I.P.S. S.R.L.',
      'P.Iva 02782600619',
      '',
      'Scontrino di cortesia 1329',
      'del 17/06/2026',
      '',
      'ABITO DONNA',
      '',
      'Hai 30 giorni',
      '',
      'RT 2CITP017007',
    ])
  })

  it('header + items soli: nessuna riga vuota orfana', () => {
    const doc = buildCourtesyDoc({ header: ['NEGOZIO'], items: ['ART'] })
    expect(texts(doc)).toEqual(['NEGOZIO', '', 'ART'])
  })

  it('titolo composto solo dai campi presenti (niente "del undefined")', () => {
    const doc = buildCourtesyDoc({ header: ['N'], number: '5', items: ['A'] })
    expect(texts(doc)).toContain('Scontrino di cortesia 5')
    expect(texts(doc).join('\n')).not.toContain('undefined')
  })

  it('non produce mai due righe vuote consecutive', () => {
    const doc = buildCourtesyDoc({ header: ['N'], items: ['A'], footer: ['F'] })
    const t = texts(doc)
    for (let i = 1; i < t.length; i++) {
      expect(t[i] === '' && t[i - 1] === '').toBe(false)
    }
    expect(doc.cut).toBe(false)
  })
})
