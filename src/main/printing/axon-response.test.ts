import { describe, it, expect } from 'vitest'
import {
  parseAxonResponse,
  firstTag,
  describeFailure,
  PAPER_OUT_REPLIES,
} from './axon-response'

const OK_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>OK</ESITO>
  <REPLY>00</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>02</FISCAL_STATUS>
  <CMD_X_ULTIMO_NUMERO_SCONTRINO>123</CMD_X_ULTIMO_NUMERO_SCONTRINO>
  <CMD_a_ECR_MATRICOLA>8A014141</CMD_a_ECR_MATRICOLA>
</RESPONSE>`

const ERROR_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>NON OK</ESITO>
  <REPLY>2D</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>06</FISCAL_STATUS>
  <ECCEZIONE>
    <NUMERO_RIGA_ECCEZIONE>001</NUMERO_RIGA_ECCEZIONE>
    <COMANDO_ECCEZIONE>3/S/PROVA</COMANDO_ECCEZIONE>
    <REPLY_ECCEZIONE>44</REPLY_ECCEZIONE>
    <DEVICE_STATUS_ECCEZIONE>00</DEVICE_STATUS_ECCEZIONE>
    <FISCAL_STATUS_ECCEZIONE>06</FISCAL_STATUS_ECCEZIONE>
    <DESC_ERRORE_ECCEZIONE>Carta Finita</DESC_ERRORE_ECCEZIONE>
    <AZIONE_ECCEZIONE>4</AZIONE_ECCEZIONE>
  </ECCEZIONE>
</RESPONSE>`

const PROBE_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<RESPONSE>
  <ESITO>OK</ESITO>
  <REPLY>00</REPLY>
  <DEVICE_STATUS>00</DEVICE_STATUS>
  <FISCAL_STATUS>02</FISCAL_STATUS>
  <CMD_e_VAT_A>4</CMD_e_VAT_A>
  <CMD_e_VAT_B>10</CMD_e_VAT_B>
  <CMD_d_DPT_NUMERO>1</CMD_d_DPT_NUMERO>
  <CMD_d_DPT_DESCRIZIONE>ALIMENTARI</CMD_d_DPT_DESCRIZIONE>
  <CMD_d_DPT_ALIQUOTAIVA>1</CMD_d_DPT_ALIQUOTAIVA>
  <CMD_d_DPT_NUMERO>2</CMD_d_DPT_NUMERO>
  <CMD_d_DPT_DESCRIZIONE>BEVANDE</CMD_d_DPT_DESCRIZIONE>
  <CMD_d_DPT_ALIQUOTAIVA>2</CMD_d_DPT_ALIQUOTAIVA>
</RESPONSE>`

describe('parseAxonResponse', () => {
  it('legge esito e stati da una risposta OK', () => {
    const res = parseAxonResponse(OK_XML)
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
    expect(res.deviceStatus).toBe('00')
    expect(res.fiscalStatus).toBe('02')
    expect(res.exception).toBeNull()
  })

  it('espone i TAG di interrogazione', () => {
    const res = parseAxonResponse(OK_XML)
    expect(firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO')).toBe('123')
    expect(firstTag(res, 'CMD_a_ECR_MATRICOLA')).toBe('8A014141')
  })

  it('restituisce stringa vuota per un TAG assente', () => {
    expect(firstTag(parseAxonResponse(OK_XML), 'CMD_INESISTENTE')).toBe('')
  })

  it('legge il blocco ECCEZIONE di una risposta NON OK', () => {
    const res = parseAxonResponse(ERROR_XML)
    expect(res.ok).toBe(false)
    expect(res.exception?.reply).toBe('44')
    expect(res.exception?.description).toBe('Carta Finita')
    expect(res.exception?.command).toBe('3/S/PROVA')
    expect(res.exception?.action).toBe('4')
  })

  it('conserva le occorrenze ripetute dello stesso TAG in ordine', () => {
    const res = parseAxonResponse(PROBE_XML)
    expect(res.tags['CMD_d_DPT_NUMERO']).toEqual(['1', '2'])
    expect(res.tags['CMD_d_DPT_DESCRIZIONE']).toEqual(['ALIMENTARI', 'BEVANDE'])
    expect(res.tags['CMD_d_DPT_ALIQUOTAIVA']).toEqual(['1', '2'])
  })

  it('rifiuta un XML senza tag RESPONSE', () => {
    expect(() => parseAxonResponse('<ALTRO></ALTRO>')).toThrow(/RESPONSE/)
  })
})

describe('describeFailure', () => {
  it('compone descrizione, comando e post action', () => {
    const msg = describeFailure(parseAxonResponse(ERROR_XML))
    expect(msg).toContain('Carta Finita')
    expect(msg).toContain('3/S/PROVA')
    expect(msg).toContain('comando ripetuto')
  })

  it('ripiega sul reply code se manca il blocco ECCEZIONE', () => {
    const res = parseAxonResponse(OK_XML)
    const failed = { ...res, ok: false, reply: '2D' }
    expect(describeFailure(failed)).toContain('2D')
  })
})

describe('classificazione delle condizioni fisiche', () => {
  it('riconosce il reply code di carta finita', () => {
    expect(PAPER_OUT_REPLIES.has('44')).toBe(true)
  })
})
