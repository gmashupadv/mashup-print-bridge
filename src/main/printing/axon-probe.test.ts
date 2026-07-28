import { describe, it, expect } from 'vitest'
import { deptMappingFromProbe, mergeDeptMapping, usableDepartments } from './axon-probe'
import type { AxonProbe } from './axon-probe'

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
