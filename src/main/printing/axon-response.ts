// Parsing del file Response_<job>.xml scritto da axonFPiD_Pro_v7 al termine
// dell'elaborazione di un file di comandi SF20.
//
// Nota di design: non replichiamo la tabella dei Reply Code del manuale (0-176,
// con descrizioni che cambiano per modello). Il Response porta già dentro
// <ECCEZIONE> sia la descrizione dell'errore sia la Post Action intrapresa da
// axonFPiD: sarebbe una copia rumorosa di dati che il file ci consegna risolti.
import { XMLParser } from 'fast-xml-parser'

// parseTagValue: false → i valori restano stringhe. Serve per non perdere gli
// zeri iniziali di REPLY ("00") e delle matricole.
const parser = new XMLParser({ parseTagValue: false, trimValues: true })

/** Legenda "TABELLA DESCRIZIONE POST ACTION" del manuale axonFPiD_Pro_v7. */
export const POST_ACTIONS: Record<string, string> = {
  '1': 'comando ripetuto',
  '2': 'errore ignorato, stampa proseguita',
  '3': 'attesa ripristino stampante, comando saltato',
  '4': 'attesa ripristino stampante, comando ripetuto',
  '5': 'comando ripetuto subito',
  '9': 'errore grave, invio comandi interrotto',
}

/** Reply Code che segnalano una condizione fisica, non un errore di comando. */
export const PAPER_OUT_REPLIES = new Set(['44'])
export const COVER_OPEN_REPLIES = new Set(['51'])

export interface AxonException {
  lineNumber: string
  command: string
  reply: string
  deviceStatus: string
  fiscalStatus: string
  description: string
  action: string
}

export interface AxonResponse {
  ok: boolean
  reply: string
  deviceStatus: string
  fiscalStatus: string
  exception: AxonException | null
  /**
   * TAG CMD_* dei comandi di interrogazione contenuti nel file inviato.
   * Sempre array: un file di sonda contiene 60 comandi `d/x/` e produce 60
   * occorrenze dello stesso TAG, in ordine di documento.
   */
  tags: Record<string, string[]>
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function push(out: Record<string, string[]>, key: string, value: unknown): void {
  const list = out[key] ?? (out[key] = [])
  list.push(str(value))
}

function collectTags(node: unknown, out: Record<string, string[]>): void {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectTags(item, out)
    return
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null && typeof item === 'object') collectTags(item, out)
        else if (key.startsWith('CMD_')) push(out, key, item)
      }
    } else if (value != null && typeof value === 'object') {
      collectTags(value, out)
    } else if (key.startsWith('CMD_')) {
      push(out, key, value)
    }
  }
}

export function parseAxonResponse(xml: string): AxonResponse {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const root = parsed['RESPONSE'] as Record<string, unknown> | undefined
  if (!root) throw new Error('Response XML privo del tag <RESPONSE>')

  const tags: Record<string, string[]> = {}
  collectTags(root, tags)

  const raw = root['ECCEZIONE']
  const exc = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined

  return {
    ok: str(root['ESITO']).toUpperCase() === 'OK',
    reply: str(root['REPLY']),
    deviceStatus: str(root['DEVICE_STATUS']),
    fiscalStatus: str(root['FISCAL_STATUS']),
    exception: exc
      ? {
          lineNumber: str(exc['NUMERO_RIGA_ECCEZIONE']),
          command: str(exc['COMANDO_ECCEZIONE']),
          reply: str(exc['REPLY_ECCEZIONE']),
          deviceStatus: str(exc['DEVICE_STATUS_ECCEZIONE']),
          fiscalStatus: str(exc['FISCAL_STATUS_ECCEZIONE']),
          description: str(exc['DESC_ERRORE_ECCEZIONE']),
          action: str(exc['AZIONE_ECCEZIONE']),
        }
      : null,
    tags,
  }
}

export function firstTag(res: AxonResponse, name: string): string {
  return res.tags[name]?.[0] ?? ''
}

/** Messaggio leggibile dal POS a partire da una Response non riuscita. */
export function describeFailure(res: AxonResponse): string {
  const exc = res.exception
  if (!exc) return `Stampa non riuscita (REPLY ${res.reply || '?'})`
  const parts = [exc.description || `Reply Code ${exc.reply || '?'}`]
  if (exc.command) parts.push(`comando "${exc.command}"`)
  const action = POST_ACTIONS[exc.action]
  if (action) parts.push(action)
  return parts.join(' — ')
}
