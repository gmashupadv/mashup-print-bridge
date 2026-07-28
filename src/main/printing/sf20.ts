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
 * Testo libero destinato a un campo comando. La "/" separa i campi del
 * protocollo, quindi va rimossa insieme a newline e tabulazioni.
 */
export function sanitize(text: string, maxLength = 30): string {
  return text
    .replace(/[/\r\n\t]/g, ' ')
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
// Procedura per ricavarla: docs/axon-fpid-setup.md, passo 7.
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
