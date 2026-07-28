import { describe, it, expect } from 'vitest'
import {
  QUERY,
  amount,
  sanitize,
  buildCommandFile,
  buildProbe,
  buildReceipt,
  buildDailyClose,
  buildOpenDrawer,
  Sf20CommandUnavailableError,
} from './sf20'

describe('amount', () => {
  it('formatta con due decimali e punto', () => {
    expect(amount(1)).toBe('1.00')
    expect(amount(12.5)).toBe('12.50')
    expect(amount(0.019)).toBe('0.02')
  })
})

describe('sanitize', () => {
  it('rimuove le barre, che nel protocollo separano i campi', () => {
    expect(sanitize('Pane 1/2 kg')).toBe('Pane 1 2 kg')
  })

  it('collassa spazi, newline e tabulazioni', () => {
    expect(sanitize('Riga\r\nunica\tsola')).toBe('Riga unica sola')
  })

  it('tronca alla lunghezza massima', () => {
    expect(sanitize('A'.repeat(50), 30)).toHaveLength(30)
  })
})

describe('buildCommandFile', () => {
  it('usa CRLF e chiude con un terminatore di riga', () => {
    expect(buildCommandFile(['v/', 'a/'])).toBe('v/\r\na/\r\n')
  })
})

describe('buildProbe', () => {
  it('contiene solo comandi di interrogazione', () => {
    const commands = buildProbe(3)
    expect(commands).toEqual(['v/', 'a/', ',/10/', 'X/', 'e/', 'd/1/', 'd/2/', 'd/3/'])
  })

  it('interroga 60 reparti per default', () => {
    expect(buildProbe()).toHaveLength(65)
  })
})

describe('comandi di vendita non ancora determinati', () => {
  const data = {
    items: [{ description: 'PROVA', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 }],
    discount: 0,
    payments: [{ description: 'Contanti', amount: 1, paymentType: 0 }],
  }

  it('buildReceipt lancia un errore che indirizza alla procedura', () => {
    expect(() => buildReceipt(data, '1')).toThrow(Sf20CommandUnavailableError)
    expect(() => buildReceipt(data, '1')).toThrow(/Scontrini di test/)
  })

  it('buildDailyClose lancia', () => {
    expect(() => buildDailyClose('1')).toThrow(Sf20CommandUnavailableError)
  })

  it('buildOpenDrawer lancia', () => {
    expect(() => buildOpenDrawer('1')).toThrow(Sf20CommandUnavailableError)
  })
})

describe('QUERY', () => {
  it('numera i reparti', () => {
    expect(QUERY.department(7)).toBe('d/7/')
  })
})
