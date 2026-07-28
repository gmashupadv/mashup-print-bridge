// Tipi e trasformazione pura del risultato della sonda di configurazione
// axon-fpid. Isolati da axon-fpid.ts (che importa node:fs/promises e
// node:path) perché il pannello React nel renderer deve poter importare
// deptMappingFromProbe come valore: un modulo che tira dentro i moduli
// nativi di Node non è bundlabile lato browser.
//
// La dipendenza è a senso unico (axon-fpid.ts importa da qui, non viceversa),
// quindi VAT_LETTERS vive solo qui ed è ri-esportata anziché duplicata.
export const VAT_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

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
 * Aliquota IVA numerica di un reparto, risolta tramite la tabella IVA della
 * stampante, o null se il reparto non è utilizzabile (codice IVA fuori range,
 * aliquota non programmata o non numerica — es. "22,00" con virgola italiana,
 * o "ESENTE").
 */
function resolveVatRate(probe: AxonProbe, dept: AxonDepartment): number | null {
  const letter = VAT_LETTERS[Number(dept.vatCode) - 1]
  if (!letter) return null
  const rate = probe.vatTable[letter]
  if (rate == null || rate === '') return null
  const parsedRate = Number(rate)
  return Number.isFinite(parsedRate) ? parsedRate : null
}

/**
 * Reparti che concorrono davvero a deptMappingFromProbe: codice IVA valido,
 * aliquota risolvibile numericamente e numero di reparto valido. Non basarsi
 * sulla sola descrizione non vuota per contare i "reparti programmati": un
 * reparto può avere una descrizione ma un'aliquota non risolvibile, ed è
 * comunque escluso dalla mappatura.
 */
export function usableDepartments(probe: AxonProbe): AxonDepartment[] {
  return probe.departments.filter((dept) => {
    if (resolveVatRate(probe, dept) == null) return false
    const number = Number(dept.number)
    return Number.isFinite(number) && number > 0
  })
}

/**
 * deptMapping = aliquota IVA (due decimali) → primo reparto che la usa.
 * Il codice IVA del reparto è 1..5 e punta alle lettere A..E della tabella.
 */
export function deptMappingFromProbe(probe: AxonProbe): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (const dept of probe.departments) {
    const parsedRate = resolveVatRate(probe, dept)
    if (parsedRate == null) continue
    const number = Number(dept.number)
    if (!Number.isFinite(number) || number <= 0) continue
    const key = parsedRate.toFixed(2)
    if (!(key in mapping)) mapping[key] = number
  }
  return mapping
}

/**
 * Applica il deptMapping ricavato dalla sonda SOPRA quello già configurato,
 * senza sostituirlo: le aliquote che la sonda produce vengono sovrascritte
 * col reparto letto dalla stampante, quelle che non produce (perché nessun
 * reparto programmato le usa) mantengono il valore già impostato a mano.
 *
 * Una sostituzione integrale sarebbe un bug di fatturazione silenzioso: un
 * rivenditore lascia tipicamente alcune aliquote IVA non programmate sulla
 * RT (usate raramente), ma con deptMapping già configurato per quelle
 * aliquote a mano. `/print` in server.ts ricade su item.department ?? 1
 * quando la chiave manca in deptMapping: un reparto perso qui si traduce in
 * uno scontrino fiscale con l'IVA sbagliata, non in un errore visibile.
 */
export function mergeDeptMapping(
  existing: Record<string, number>,
  fromProbe: Record<string, number>
): Record<string, number> {
  return { ...existing, ...fromProbe }
}
