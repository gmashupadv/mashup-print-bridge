// Protocollo SF20 (A.P.esse / Micrelec): comandi ASCII a campi separati da "/",
// una riga per comando, ogni riga terminata da "/".
//
// I comandi di INTERROGAZIONE sono documentati nel manuale axonFPiD_Pro_v7,
// sezione "Elenco Comandi SF20 gestiti con risposta nel file Response_...".
// I comandi di VENDITA non lo sono: vedi il blocco in fondo al file.
import type { ReceiptData } from '../drivers/interface'

/** Comandi di interrogazione documentati. Non scrivono nulla sulla RT. */
export const QUERY = {
  dateTime: 't/',
  status: ',/10/',
  firmware: 'v/',
  identity: 'a/',
  lastDocuments: 'X/',
  lastClosure: 'i/',
  vatTable: 'e/',
  department: (n: number): string => `d/${n}/`,
} as const

/** Importo in euro: due decimali, separatore punto. */
export function amount(value: number): string {
  return value.toFixed(2)
}

/**
 * Testo libero destinato a un campo comando. Il protocollo SF20 usa "/" come
 * separatore di campi. Inoltre il file di comandi viene scritto su disco con
 * encoding CP1252/latin1, quindi ogni carattere deve sopravvivere a questa
 * conversione inalterato. I caratteri Unicode oltre U+00FF (p.es. Cyrilico)
 * vengono troncati al loro byte basso durante la codifica, creando byte
 * 0x2F ("/") e 0x0A-0x0D (newline) che corrompono la struttura del comando
 * fiscale. Inoltre i caratteri di controllo C0/C1 (U+0000-U+001F, U+007F-U+009F)
 * sono esclusi per evitare effetti indesiderati sul protocollo.
 *
 * Questa funzione quindi:
 * 1. Rimuove tutti i caratteri non-Latin-1 (U+0100-U+FFFF) sostituendoli con spazi.
 * 2. Rimuove i caratteri di controllo C0/C1 sostituendoli con spazi.
 * 3. Sostituisce "/" con spazio (separatore SF20).
 * 4. Collassa i run di spazi bianchi in un singolo spazio.
 * 5. Tronca alla lunghezza massima.
 *
 * I caratteri accentati latini usati in italiano (à è é ì ò ù e maiuscoli),
 * che sono entro U+00FF, passano inalterati.
 */
export function sanitize(text: string, maxLength = 30): string {
  let cleaned = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    // Scarta: C0 (0x00-0x1F), "/" (0x2F), DEL+C1 (0x7F-0x9F), non-Latin-1 (0x0100-0xFFFF)
    if ((code >= 0x00 && code <= 0x1f) || code === 0x2f || (code >= 0x7f && code <= 0x9f) || code > 0xff) {
      cleaned += ' '
    } else {
      cleaned += char
    }
  }
  return cleaned
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** File di comandi per il Server di Stampa: CRLF, il consumatore è Windows. */
export function buildCommandFile(commands: string[]): string {
  return commands.join('\r\n') + '\r\n'
}

/**
 * Sonda di configurazione: versione FW, identità, stato, ultimi documenti,
 * tabella IVA e tutti i reparti. Sole interrogazioni, nessuna scrittura.
 */
export function buildProbe(departmentCount = 60): string[] {
  const commands: string[] = [
    QUERY.firmware,
    QUERY.identity,
    QUERY.status,
    QUERY.lastDocuments,
    QUERY.vatTable,
  ]
  for (let n = 1; n <= departmentCount; n++) commands.push(QUERY.department(n))
  return commands
}

// ---------------------------------------------------------------------------
// Comandi di vendita — DA DETERMINARE SUL CAMPO
//
// Nessuna delle fonti disponibili documenta la sintassi di vendita, subtotale,
// sconto, pagamento, chiusura giornaliera e apertura cassetto:
//   - axonfpid_pro_v7.txt elenca solo i comandi di interrogazione;
//   - sf20.txt e' il libretto dell'ECR e non contiene il protocollo.
// Unico indizio: il manuale axonFPiD mostra "3/S/xxxxxx..." come esempio di
// COMANDO_ECCEZIONE, quindi la forma e' quella dei campi separati da "/".
//
// Procedura per ricavarla: docs/axon-fpid-setup.md, sezione 5.
// ---------------------------------------------------------------------------

export class Sf20CommandUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `Comando SF20 per "${operation}" non ancora determinato. Ricavare la sintassi da ` +
        'axonFPiD_Pro_v7 → Pannello del Tecnico → "Stampa Scontrini di test", quindi ' +
        'completare src/main/printing/sf20.ts (vedi docs/axon-fpid-setup.md).'
    )
    this.name = 'Sf20CommandUnavailableError'
  }
}

export function buildReceipt(_data: ReceiptData, _operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('scontrino fiscale')
}

export function buildDailyClose(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('chiusura giornaliera')
}

export function buildOpenDrawer(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('apertura cassetto')
}
