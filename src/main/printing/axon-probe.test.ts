import { describe, it, expect } from 'vitest'
import { deptMappingFromProbe, mergeDeptMapping, usableDepartments } from './axon-probe'
import type { AxonProbe } from './axon-probe'

/** Tabella IVA e reparti letti davvero dalla RT30 della cliente il 29/07/2026. */
const RT30_G100: AxonProbe = {
  firmware: 'V2 R1 B7 G100.137',
  serial: '8AIGE013756',
  model: 'RT30',
  lastReceiptNumber: '',
  vatTable: {
    '1': '4',
    '2': '10',
    '3': '22',
    '4': '22',
    '5': '22',
    '6': '22',
    '7': '22',
    '8': '22',
    '9': '22',
    '10': '22',
    '11': '22',
    '12': '22',
  },
  departments: [
    { number: '1', description: 'REPAR-1', vatCode: '3' },
    { number: '9', description: 'REPAR-9', vatCode: '9' },
    { number: '10', description: 'REPAR-10', vatCode: '10' },
    { number: '11', description: 'REPAR-11', vatCode: '1' },
    { number: '12', description: 'REPAR-12', vatCode: '2' },
  ],
}

describe('aliquote oltre le cinque lettere (FW serie 2 G100)', () => {
  it('non scarta i reparti con slot IVA da 6 a 12', () => {
    // La RT30 espone 12 slot IVA numerati. Fermandosi alle lettere A..E i
    // reparti 9 e 10 sparivano in silenzio dalla mappatura.
    expect(usableDepartments(RT30_G100).map((d) => d.number)).toEqual([
      '1',
      '9',
      '10',
      '11',
      '12',
    ])
  })

  it('mappa le aliquote reali della cliente', () => {
    expect(deptMappingFromProbe(RT30_G100)).toEqual({ '22.00': 1, '4.00': 11, '10.00': 12 })
  })

  it('continua a risolvere le tabelle a lettere delle RT serie 1', () => {
    const serie1: AxonProbe = {
      ...RT30_G100,
      vatTable: { A: '4', B: '10', C: '22', D: '0', E: '0' },
      departments: [{ number: '7', description: 'X', vatCode: '2' }],
    }
    expect(deptMappingFromProbe(serie1)).toEqual({ '10.00': 7 })
  })

  it('scarta uno slot IVA oltre il dodicesimo', () => {
    const oltre: AxonProbe = {
      ...RT30_G100,
      departments: [{ number: '5', description: 'X', vatCode: '13' }],
    }
    expect(deptMappingFromProbe(oltre)).toEqual({})
  })
})

describe('deptMappingFromProbe', () => {
  it('mappa aliquota su primo reparto che la usa', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '10', C: '22', D: '0', E: '0' },
      departments: [
        { number: '1', description: 'ALIMENTARI', vatCode: '1' },
        { number: '2', description: 'BEVANDE', vatCode: '3' },
        { number: '3', description: 'ALTRO', vatCode: '3' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 1, '22.00': 2 })
  })

  it('ignora reparti con codice IVA fuori range', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '', C: '', D: '', E: '' },
      departments: [
        { number: '1', description: 'X', vatCode: '9' },
        { number: '2', description: 'Y', vatCode: '1' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 2 })
  })

  it('non genera una chiave "NaN" per un\'aliquota non numerica (virgola italiana o testo)', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '22,00', B: 'ESENTE', C: '10', D: '', E: '' },
      departments: [
        { number: '1', description: 'X', vatCode: '1' },
        { number: '2', description: 'Y', vatCode: '2' },
        { number: '3', description: 'Z', vatCode: '3' },
      ],
    }
    const mapping = deptMappingFromProbe(probe)
    expect(mapping).not.toHaveProperty('NaN')
    expect(mapping).toEqual({ '10.00': 3 })
  })
})

describe('usableDepartments', () => {
  it('esclude i reparti con codice IVA fuori range o aliquota non numerica, anche se descritti', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: 'ESENTE', C: '', D: '', E: '' },
      departments: [
        { number: '1', description: 'ALIMENTARI', vatCode: '1' }, // aliquota A=4 → utilizzabile
        { number: '2', description: 'NON PROGRAMMATO', vatCode: '2' }, // B=ESENTE, non numerico
        { number: '3', description: 'FUORI RANGE', vatCode: '9' }, // nessuna lettera 9
      ],
    }
    const usable = usableDepartments(probe)
    expect(usable).toEqual([{ number: '1', description: 'ALIMENTARI', vatCode: '1' }])
  })
})

describe('mergeDeptMapping', () => {
  it('sovrascrive le aliquote prodotte dalla sonda e mantiene quelle già configurate che la sonda non produce', () => {
    const existing = { '4.00': 9, '22.00': 9 }
    const fromProbe = { '22.00': 2 }
    expect(mergeDeptMapping(existing, fromProbe)).toEqual({ '4.00': 9, '22.00': 2 })
  })

  it('non cancella la mappatura esistente quando la sonda non produce nulla', () => {
    const existing = { '4.00': 1, '22.00': 2 }
    expect(mergeDeptMapping(existing, {})).toEqual(existing)
  })
})
