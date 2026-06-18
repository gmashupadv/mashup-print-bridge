// src/main/printing/courtesy-receipt.ts
// Formatter puro: dati strutturati dello scontrino di cortesia → NonFiscalDoc.
// Possiede il layout (ordine blocchi, righe vuote tra blocchi, titolo).
// Nessuna dipendenza da rete/driver/Electron → testabile in isolamento.
import type { NonFiscalDoc, NonFiscalLine } from '../drivers/interface'

export interface CourtesyData {
  header: string[]
  number?: string
  date?: string
  items: string[]
  returnPolicy?: string[]
  footer?: string[]
}

export function buildCourtesyDoc(data: CourtesyData): NonFiscalDoc {
  const blocks: string[][] = [data.header]

  const title: string[] = []
  if (data.number) title.push(`Scontrino di cortesia ${data.number}`)
  if (data.date) title.push(`del ${data.date}`)
  if (title.length > 0) blocks.push(title)

  blocks.push(data.items)
  if (data.returnPolicy && data.returnPolicy.length > 0) blocks.push(data.returnPolicy)
  if (data.footer && data.footer.length > 0) blocks.push(data.footer)

  const lines: NonFiscalLine[] = []
  blocks.forEach((block, i) => {
    if (i > 0) lines.push({ text: '' }) // separatore fra blocchi, mai orfano
    for (const text of block) lines.push({ text })
  })
  return { lines, cut: false }
}
