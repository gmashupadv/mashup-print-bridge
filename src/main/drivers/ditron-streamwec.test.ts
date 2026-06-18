import { describe, it, expect } from 'vitest'
import { buildNonFiscal, buildReceipt, parseResult, NONFISCAL_OPEN, NONFISCAL_CLOSE } from './ditron-streamwec'

describe('parseResult (risposte WEC da cattura)', () => {
  it('una o più righe "OK." = successo', () => {
    const r = parseResult('OK.\nOK.\nOK.\nOK.\nOK.\nOK.\nOK.\n')
    expect(r.success).toBe(true)
    expect(r.errorMessage).toBe('')
  })

  it('riconosce ERRORE anche dopo alcuni OK.', () => {
    const r = parseResult('OK.\nOK.\nERRORE 1/4 : ERRORE DI SINTASSI 4 : OPERANDO NON TROVATO\n')
    expect(r.success).toBe(false)
    expect(r.errorMessage).toMatch(/OPERANDO NON TROVATO/)
  })

  it('risposta vuota/inattesa NON è successo (niente falso positivo)', () => {
    expect(parseResult('').success).toBe(false)
    expect(parseResult('').errorMessage).toMatch(/inattesa|vuota/i)
  })
})

describe('buildReceipt (sintassi WEC da cattura Danea)', () => {
  const receipt = (over = {}) => ({
    items: [{ description: 'Prodotto di prova', quantity: 1, unitPrice: 0.01, department: 3, vatRate: 22 }],
    discount: 0,
    payments: [{ description: 'Contanti', amount: 0.01, paymentType: 0 }],
    ...over,
  })

  it('apre con CLEAR/CHIAVE REG e chiude con SUBT/CHIUS/wecfine', () => {
    const out = buildReceipt(receipt()).trim().split('\n')
    expect(out[0]).toBe('CLEAR')
    expect(out[1]).toBe('CHIAVE REG')
    expect(out).toContain('SUBT')
    expect(out[out.length - 1]).toBe('wecfine')
  })

  it('VEND usa PREZZO= e DES= (scontrino parlante), senza spazi dopo le virgole', () => {
    const out = buildReceipt(receipt())
    expect(out).toContain("VEND REP=3,PREZZO=0.01,DES='Prodotto di prova'")
  })

  it('CHIUS T=1 per contanti, T=5 per carta', () => {
    expect(buildReceipt(receipt())).toContain('CHIUS T=1')
    const carta = receipt({ payments: [{ description: 'POS', amount: 0.01, paymentType: 1 }] })
    expect(buildReceipt(carta)).toContain('CHIUS T=5')
  })

  it('neutralizza gli apici nella descrizione', () => {
    const out = buildReceipt(receipt({ items: [{ description: "Po' prova", quantity: 1, unitPrice: 1, department: 3, vatRate: 22 }] }))
    expect(out).toContain("DES='Po  prova'")
  })

  it('quantità ≠1: QTY prima di PREZZO (da cattura)', () => {
    const out = buildReceipt(receipt({ items: [{ description: 'ARTICOLI VARI', quantity: 2, unitPrice: 5, department: 3, vatRate: 22 }] }))
    expect(out).toContain("VEND REP=3,QTY=2,PREZZO=5.00,DES='ARTICOLI VARI'")
  })

  it('sconto a valore sul subtotale: "SCONTO VAL=…, SUBTOT"', () => {
    const out = buildReceipt(receipt({ discount: 9.99 }))
    expect(out).toContain('SCONTO VAL=9.99, SUBTOT')
  })

  it("include la riga di cortesia CORT R1='Grazie e arrivederci' dopo i VEND", () => {
    const out = buildReceipt(receipt()).trim().split('\n')
    const iVend = out.findIndex((l) => l.startsWith('VEND'))
    const iCort = out.findIndex((l) => l.startsWith('CORT'))
    const iSubt = out.indexOf('SUBT')
    expect(out[iCort]).toBe("CORT R1='Grazie e arrivederci'")
    expect(iVend).toBeLessThan(iCort)
    expect(iCort).toBeLessThan(iSubt)
  })

  it('divisione pagamento: tutti tranne l’ultimo con IMP=, l’ultimo senza (da cattura)', () => {
    const out = buildReceipt(
      receipt({
        payments: [
          { description: 'POS', amount: 10, paymentType: 1 },
          { description: 'Contanti', amount: 15, paymentType: 0 },
        ],
      })
    )
      .trim()
      .split('\n')
    expect(out).toContain('CHIUS T=5,IMP=10.00')
    expect(out).toContain('CHIUS T=1')
    // l'ultimo CHIUS non ha IMP
    expect(out[out.length - 2]).toBe('CHIUS T=1')
  })
})

describe('buildNonFiscal (scontrino di cortesia, NOFIS da cattura)', () => {
  it('avvolge NOFIS in CLEAR/CHIAVE REG … wecfine', () => {
    const cmd = buildNonFiscal({ lines: [{ text: "Po' di testo" }, { text: 'riga2' }] })
    const lines = cmd.trim().split('\n')
    expect(lines[0]).toBe('CLEAR')
    expect(lines[1]).toBe('CHIAVE REG')
    expect(lines[2]).toBe(NONFISCAL_OPEN) // 'NOFIS APRI'
    expect(cmd).toContain("NOFIS RIGA='Po  di testo'") // apostrofo neutralizzato
    expect(cmd).toContain("NOFIS RIGA='riga2'")
    expect(lines).toContain(NONFISCAL_CLOSE) // 'NOFIS CHIUDI'
    expect(lines[lines.length - 1]).toBe('wecfine')
  })

  it('truncates lines to 40 chars', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'x'.repeat(60) }] })
    expect(cmd).toContain(`'${'x'.repeat(40)}'`)
  })

  it('neutralizes embedded newlines: one logical line = one NOFIS RIGA', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'a\nb\rc' }] })
    expect(cmd).toContain("NOFIS RIGA='a b c'")
    // una sola riga di contenuto fra NOFIS APRI e NOFIS CHIUDI
    expect(cmd.match(/NOFIS RIGA=/g)).toHaveLength(1)
  })
})

describe('capabilities', () => {
  it('declares non-fiscal', async () => {
    const { DitronStreamWecDriver } = await import('./ditron-streamwec')
    expect(new DitronStreamWecDriver().capabilities).toContain('non-fiscal')
  })
})
