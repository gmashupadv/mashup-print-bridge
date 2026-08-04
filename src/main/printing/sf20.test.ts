import { describe, it, expect } from 'vitest'
import {
  QUERY,
  amount,
  sanitize,
  buildCommandFile,
  PROBE_IDENTITY,
  buildDepartmentProbe,
  buildReceipt,
  buildNonFiscal,
  nonFiscalLine,
  NON_FISCAL_MAX_CHARS,
  buildDailyClose,
  buildOpenDrawer,
  quantity,
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

  it('esclude i caratteri Cyrillic per evitare iniezione di "/" in codifica latin1', () => {
    const cleaned = sanitize('Prodotto Я speciale')
    // Verifica che il risultato non contenga "/" letterale
    expect(cleaned).not.toContain('/')
    // Verifica che codificato in latin1, non generi il byte 0x2f
    const encoded = Buffer.from(cleaned, 'latin1')
    expect(encoded.indexOf(0x2f)).toBe(-1)
  })

  it('preserva i caratteri accentati latini usati in italiano', () => {
    const input = 'Caffè à metà'
    const cleaned = sanitize(input)
    expect(cleaned).toContain('è')
    expect(cleaned).toContain('à')
  })

  it('rimuove i caratteri di controllo C0/C1', () => {
    // Inserisce un carattere di controllo (BEL, 0x07)
    const withControl = 'Test\x07String'
    const cleaned = sanitize(withControl)
    expect(cleaned).not.toContain('\x07')
    // Il risultato dovrebbe essere "Test String" (lo 0x07 diventa spazio)
    expect(cleaned).toBe('Test String')
  })

  it('non crea spazi doppi quando rimuove caratteri consecutivi', () => {
    // Due caratteri di controllo consecutivi
    const input = 'Word\x07\x08Another'
    const cleaned = sanitize(input)
    // Non deve avere spazi doppi
    expect(cleaned).not.toContain('  ')
  })
})

describe('buildCommandFile', () => {
  it('usa CRLF e chiude con un terminatore di riga', () => {
    expect(buildCommandFile(['v/', 'a/'])).toBe('v/\r\na/\r\n')
  })
})

describe('sonda di configurazione', () => {
  it('il primo passo contiene solo comandi di interrogazione', () => {
    expect(PROBE_IDENTITY).toEqual(['v/', 'a/', ',/10/', 'X/', 'e/'])
  })

  it('interroga un solo reparto per job', () => {
    // axonFPiD scrive ogni TAG CMD_* una sola volta nel Response XML: un file
    // con piu` d/x/ restituirebbe soltanto l'ultimo reparto interrogato.
    expect(buildDepartmentProbe(7)).toEqual(['d/7/'])
  })
})

describe('buildReceipt', () => {
  const cash = { description: 'Contanti', amount: 0.01, paymentType: 0 }

  it('riproduce la sequenza validata sulla RT30 il 29/07/2026', () => {
    // Questo e' esattamente il file inviato alla stampante della cliente dal
    // Pannello del Tecnico: ha risposto REPLY 00 ed emesso lo scontrino.
    expect(
      buildReceipt(
        {
          items: [
            { description: 'PROVA', quantity: 1, unitPrice: 0.01, department: 1, vatRate: 22 },
          ],
          discount: 0,
          payments: [cash],
        },
        '1'
      )
    ).toEqual(['3/S/PROVA//1/0.01/1/22///0/', 'U/', '5/1/0////PC//'])
  })

  it('riporta quantita` e prezzo di ogni riga', () => {
    const [line] = buildReceipt(
      {
        items: [
          { description: 'Maglietta', quantity: 3, unitPrice: 19.9, department: 4, vatRate: 22 },
        ],
        discount: 0,
        payments: [cash],
      },
      '1'
    )
    expect(line).toBe('3/S/Maglietta//3/19.90/4/22///0/')
  })

  it('sanifica la descrizione: la barra separa i campi del protocollo', () => {
    const [line] = buildReceipt(
      {
        items: [
          { description: 'Pane 1/2 kg', quantity: 1, unitPrice: 2, department: 1, vatRate: 22 },
        ],
        discount: 0,
        payments: [cash],
      },
      '1'
    )
    expect(line).toBe('3/S/Pane 1 2 kg//1/2.00/1/22///0/')
    // La riga deve avere esattamente i campi previsti, non uno in piu`
    expect(line.split('/')).toHaveLength(12)
  })

  it('mette il subtotale dopo le righe e prima dei pagamenti', () => {
    const commands = buildReceipt(
      {
        items: [
          { description: 'A', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 },
          { description: 'B', quantity: 1, unitPrice: 2, department: 1, vatRate: 22 },
        ],
        discount: 0,
        payments: [cash],
      },
      '1'
    )
    expect(commands.indexOf('U/')).toBe(2)
    expect(commands).toHaveLength(4)
  })

  it('divide il pagamento: importo esplicito tranne l`ultimo, che salda il residuo', () => {
    const commands = buildReceipt(
      {
        items: [{ description: 'A', quantity: 1, unitPrice: 30, department: 1, vatRate: 22 }],
        discount: 0,
        payments: [
          { description: 'Bancomat', amount: 20, paymentType: 1 },
          { description: 'Contanti', amount: 10, paymentType: 0 },
        ],
      },
      '1'
    )
    expect(commands.slice(-2)).toEqual(['5/4/20.00////PE//', '5/1/0////PC//'])
  })

  it('senza pagamenti chiude in contanti', () => {
    const commands = buildReceipt(
      {
        items: [{ description: 'A', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 }],
        discount: 0,
        payments: [],
      },
      '1'
    )
    expect(commands.at(-1)).toBe('5/1/0////PC//')
  })

  it('riproduce la sequenza con sconto validata sulla RT30 il 29/07/2026', () => {
    // File inviato dal Pannello del Tecnico: 0,20 meno 0,10 ha stampato 0,10.
    expect(
      buildReceipt(
        {
          items: [
            { description: 'TEST SCONTO', quantity: 1, unitPrice: 0.2, department: 1, vatRate: 22 },
          ],
          discount: 0.1,
          payments: [cash],
        },
        '1'
      )
    ).toEqual([
      '3/S/TEST SCONTO//1/0.20/1/22///0/',
      'U/',
      '4/0.10/Sconto//0/0/1/',
      '5/1/0////PC//',
    ])
  })

  it('mette lo sconto DOPO il subtotale: prima sarebbe uno sconto di riga', () => {
    const commands = buildReceipt(
      {
        items: [{ description: 'A', quantity: 1, unitPrice: 10, department: 1, vatRate: 22 }],
        discount: 5,
        payments: [cash],
      },
      '1'
    )
    expect(commands.indexOf('U/')).toBeLessThan(commands.findIndex((c) => c.startsWith('4/')))
  })

  it('non emette la riga di sconto quando lo sconto e` zero', () => {
    const commands = buildReceipt(
      {
        items: [{ description: 'A', quantity: 1, unitPrice: 10, department: 1, vatRate: 22 }],
        discount: 0,
        payments: [cash],
      },
      '1'
    )
    expect(commands.some((c) => c.startsWith('4/'))).toBe(false)
  })

  it('rifiuta una riga con IVA 0% senza natura di esenzione', () => {
    expect(() =>
      buildReceipt(
        {
          items: [{ description: 'Esente', quantity: 1, unitPrice: 10, department: 8, vatRate: 0 }],
          discount: 0,
          payments: [cash],
        },
        '1'
      )
    ).toThrow(/natura di esenzione/)
  })

  it('rifiuta uno scontrino senza righe', () => {
    expect(() => buildReceipt({ items: [], discount: 0, payments: [cash] }, '1')).toThrow(
      /senza righe/
    )
  })
})

describe('buildNonFiscal', () => {
  it('riproduce la sequenza catturata dal LOG di Danea il 04/08/2026', () => {
    // Righe 1, 6, 7 e 17 del file SCONTRINO.txt che ha prodotto il documento
    // gestionale sulla RT30 della cliente: ogni comando ha risposto 00/00/02/75.
    expect(
      buildNonFiscal({
        lines: [
          { text: 'VanityRose di Rosa Paparo' },
          { text: '' },
          { text: 'Scontrino di cortesia 2428' },
        ],
      })
    ).toEqual([
      '7/1/1/VanityRose di Rosa Paparo/',
      '7/1/1//',
      '7/1/1/Scontrino di cortesia 2428/',
      'm/',
    ])
  })

  it('chiude sempre con m/, che e` il comando che stampa il documento', () => {
    const commands = buildNonFiscal({ lines: [{ text: 'A' }, { text: 'B' }] })
    expect(commands.at(-1)).toBe('m/')
    expect(commands.filter((c) => c === 'm/')).toHaveLength(1)
  })

  it('ignora bold/size/align: nel protocollo non sappiamo dove andrebbero', () => {
    expect(
      buildNonFiscal({ lines: [{ text: 'Titolo', bold: true, size: 'double', align: 'center' }] })
    ).toEqual(['7/1/1/Titolo/', 'm/'])
  })

  it('sanifica il testo: la barra separa i campi del protocollo', () => {
    const line = nonFiscalLine('Reso entro 7/10 giorni')
    expect(line).toBe('7/1/1/Reso entro 7 10 giorni/')
    expect(line.split('/')).toHaveLength(5)
  })

  it('tronca alla larghezza massima verificata sulla RT', () => {
    const line = nonFiscalLine('X'.repeat(60))
    expect(line).toBe(`7/1/1/${'X'.repeat(NON_FISCAL_MAX_CHARS)}/`)
  })

  it('accetta la riga piu` lunga della cattura senza troncarla', () => {
    // 32 caratteri, accettati dalla RT con REPLY 00.
    const longest = 'MASCARA DIEGO DELLA PALMA MY TOY'
    expect(longest).toHaveLength(NON_FISCAL_MAX_CHARS)
    expect(nonFiscalLine(longest)).toBe(`7/1/1/${longest}/`)
  })

  it('rifiuta un documento senza righe', () => {
    expect(() => buildNonFiscal({ lines: [] })).toThrow(/senza righe/)
  })
})

describe('quantity', () => {
  it('non mette decimali sulle quantita` intere, come negli esempi', () => {
    expect(quantity(1)).toBe('1')
    expect(quantity(5)).toBe('5')
  })

  it('usa tre decimali sulle quantita` frazionarie (vendita a peso)', () => {
    expect(quantity(0.35)).toBe('0.350')
  })
})

describe('comandi non ancora determinati', () => {
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
