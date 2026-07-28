// Tipi e trasformazione pura del risultato della sonda di configurazione
// axon-fpid. Isolati da axon-fpid.ts (che importa node:fs/promises e
// node:path) perché il pannello React nel renderer deve poter importare
// deptMappingFromProbe come valore: un modulo che tira dentro i moduli
// nativi di Node non è bundlabile lato browser.

const VAT_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

export interface AxonDepartment {
  number: string
  description: string
  vatCode: string
}

export interface AxonProbe {
  firmware: string
  serial: string
  model: string
  lastReceiptNumber: string
  /** Lettera aliquota → percentuale, come programmata sulla stampante. */
  vatTable: Record<string, string>
  departments: AxonDepartment[]
}

/**
 * deptMapping = aliquota IVA (due decimali) → primo reparto che la usa.
 * Il codice IVA del reparto è 1..5 e punta alle lettere A..E della tabella.
 */
export function deptMappingFromProbe(probe: AxonProbe): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (const dept of probe.departments) {
    const letter = VAT_LETTERS[Number(dept.vatCode) - 1]
    if (!letter) continue
    const rate = probe.vatTable[letter]
    if (rate == null || rate === '') continue
    // L'aliquota programmata in stampante è testo libero (es. "22,00" con la
    // virgola italiana, o "ESENTE"): senza questo controllo un'aliquota non
    // numerica produrrebbe una chiave "NaN" in deptMapping.
    const parsedRate = Number(rate)
    if (!Number.isFinite(parsedRate)) continue
    const number = Number(dept.number)
    if (!Number.isFinite(number) || number <= 0) continue
    const key = parsedRate.toFixed(2)
    if (!(key in mapping)) mapping[key] = number
  }
  return mapping
}
