// Protocollo SF20 (A.P.esse / Micrelec): comandi ASCII a campi separati da "/",
// una riga per comando, ogni riga terminata da "/".
//
// I comandi di INTERROGAZIONE sono documentati nel manuale axonFPiD_Pro_v7,
// sezione "Elenco Comandi SF20 gestiti con risposta nel file Response_...".
// I comandi di VENDITA non lo sono: vedi il blocco in fondo al file.
import type { ReceiptData, ReceiptItem } from '../drivers/interface'

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
// Comandi di vendita
//
// Sintassi ricavata dagli "Scontrini di test" del Pannello del Tecnico di
// axonFPiD_Pro_v7 6.1.2 su una RT30 con FW serie 2 G100, e validata sul campo
// il 29/07/2026 emettendo uno scontrino fiscale reale da 0,01 euro:
//
//   3/S/PROVA//1/0.01/1/22///0/
//   U/
//   5/1/0////PC//
//
// La RT ha risposto 00/00/02/75 all'ultimo comando (REPLY 00 = elaborato
// correttamente) e ha emesso il documento. Nessuna riga di apertura documento
// e' necessaria: gli scontrini di esempio mostrano un "I/12345678/0/" iniziale,
// ma 12345678 e' un segnaposto e la sequenza funziona senza.
// ---------------------------------------------------------------------------

/**
 * Riga di vendita. Campi, nell'ordine:
 *
 *   3/S/Prodotto "A"//1/160.65/4/22///0/
 *   │ │      │      │ │   │    │ │ ││ └ 0 = bene, 1 = servizio
 *   │ │      │      │ │   │    │ │ │└── campo non identificato, sempre vuoto
 *   │ │      │      │ │   │    │ │ └─── natura esenzione (N1..N6), solo se IVA = 0
 *   │ │      │      │ │   │    │ └───── aliquota IVA in percentuale
 *   │ │      │      │ │   │    └─────── reparto
 *   │ │      │      │ │   └──────────── prezzo unitario
 *   │ │      │      │ └──────────────── quantita'
 *   │ │      │      └────────────────── seconda riga di descrizione
 *   │ │      └───────────────────────── descrizione
 *   │ └──────────────────────────────── S = vendita, G = omaggio
 *   └────────────────────────────────── comando di vendita
 *
 * L'ultimo campo combacia con la colonna B/S della tabella reparti della RT.
 * Emettiamo sempre 0 (bene): il POS vende merce. Se un reparto e' programmato
 * come Servizio la RT lo segnala nel Response, e va corretta la programmazione
 * della stampante, non questo campo.
 */
const SALE_IS_GOOD = '0'

/** Subtotale. */
const SUBTOTAL = 'U/'

/**
 * Pagamento:
 *
 *   5/1/200////PC//
 *   │ │  │     └── macro-tipo: PC contante, PE elettronico, NR non riscosso,
 *   │ │  │         SP sconto a pagare
 *   │ │  └──────── importo; 0 = salda tutto il residuo
 *   │ └─────────── codice pagamento programmato sulla RT
 *   └───────────── comando di pagamento
 *
 * Codici di fabbrica SF20 (sf20.txt, "Elenco delle funzioni di pagamento"):
 * 1 Contante, 2 Crediti, 3 Ticket, 4 Bancomat, 5 Carta di credito.
 * paymentType del POS: 0 = contanti, 1 = carta/POS, altro = contanti.
 */
const PAYMENTS: Record<number, { code: number; kind: string }> = {
  0: { code: 1, kind: 'PC' },
  1: { code: 4, kind: 'PE' },
}
const CASH_PAYMENT = { code: 1, kind: 'PC' }

export class Sf20CommandUnavailableError extends Error {
  constructor(operation: string, detail?: string) {
    super(
      `Comando SF20 per "${operation}" non ancora determinato. ` +
        (detail ??
          'Ricavare la sintassi da axonFPiD_Pro_v7 → Pannello del Tecnico → ' +
            '"Stampa Scontrini di test", quindi completare src/main/printing/sf20.ts') +
        ' (vedi docs/axon-fpid-setup.md).'
    )
    this.name = 'Sf20CommandUnavailableError'
  }
}

/** Quantita': intera senza decimali come negli esempi, altrimenti a 3 decimali. */
export function quantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

export function saleLine(item: ReceiptItem): string {
  const description = sanitize(item.description)
  return [
    '3',
    'S',
    description,
    '',
    quantity(item.quantity),
    amount(item.unitPrice),
    String(item.department),
    String(item.vatRate),
    '',
    '',
    SALE_IS_GOOD,
    '',
  ].join('/')
}

export function paymentLine(paymentType: number, value: number | null): string {
  const { code, kind } = PAYMENTS[paymentType] ?? CASH_PAYMENT
  // value null => 0, che sulla RT significa "salda tutto il residuo": evita
  // che un arrotondamento lasci lo scontrino aperto per pochi centesimi.
  return ['5', String(code), value == null ? '0' : amount(value), '', '', '', kind, '', ''].join('/')
}

export function buildReceipt(data: ReceiptData, _operatorId: string): string[] {
  if (data.discount > 0) {
    throw new Sf20CommandUnavailableError(
      'sconto sul totale',
      'Gli scontrini di test mostrano il comando 4/ solo come sconto di RIGA, applicato ' +
        'subito dopo una riga di vendita; la forma per lo sconto sul subtotale non e\' stata ' +
        'verificata sulla stampante e non va indovinata su un documento fiscale'
    )
  }
  if (data.items.length === 0) {
    throw new Error('Scontrino senza righe di vendita')
  }

  const commands: string[] = []
  for (const item of data.items) {
    if (item.vatRate === 0) {
      // Con IVA 0 il protocollo vuole la natura di esenzione (N1..N6) nel campo
      // successivo — vedi 3/S/Prodotto "C"//1/100/8/0/N4//0/ negli esempi.
      // ReceiptItem non la trasporta: meglio fallire che emettere un documento
      // fiscale con una classificazione di esenzione mancante.
      throw new Error(
        `Riga "${item.description}" con IVA 0%: il protocollo SF20 richiede la natura di ` +
          'esenzione (N1..N6), che il POS non trasmette. Vendere questa riga con un\'aliquota ' +
          'ordinaria oppure estendere ReceiptItem con la natura.'
      )
    }
    commands.push(saleLine(item))
  }

  commands.push(SUBTOTAL)

  const payments = data.payments.length > 0 ? data.payments : [{ description: '', amount: 0, paymentType: 0 }]
  payments.forEach((payment, i) => {
    // Tutti tranne l'ultimo con l'importo esplicito; l'ultimo con 0 chiude il residuo.
    const isLast = i === payments.length - 1
    commands.push(paymentLine(payment.paymentType, isLast ? null : payment.amount))
  })

  return commands
}

export function buildDailyClose(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('chiusura giornaliera')
}

export function buildOpenDrawer(_operatorId: string): string[] {
  throw new Sf20CommandUnavailableError('apertura cassetto')
}
