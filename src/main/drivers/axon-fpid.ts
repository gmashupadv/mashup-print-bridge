// Driver per stampanti fiscali RT pilotate da axonFPiD_Pro_v7 (A.P.esse).
//
// Non parla con la stampante: deposita file di comandi SF20 nella cartella di
// ascolto del Server di Stampa di axonFPiD e legge il file Response_<job>.xml
// che l'applicazione scrive nella cartella LOG.
//
// Il nome del file è l'unica chiave di correlazione fra richiesta e risposta,
// quindi deve essere univoco per job.
import { writeFile, rename, readFile, unlink, access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import * as path from 'node:path'
import type {
  Capability,
  DriverConfig,
  PrinterDriver,
  PrinterStatus,
  PrintResult,
  ReceiptData,
} from './interface'
import { parseAxonResponse, describeFailure, firstTag } from '../printing/axon-response'
import type { AxonResponse } from '../printing/axon-response'
import * as sf20 from '../printing/sf20'
// VAT_LETTERS e AxonProbe vivono in un modulo separato perché il pannello React
// del renderer li importa direttamente da printing/axon-probe (non da qui):
// questo file trascina node:fs/promises e node:path, non bundlabili lato browser.
import { VAT_LETTERS } from '../printing/axon-probe'
import type { AxonProbe } from '../printing/axon-probe'

const POLL_INTERVAL_MS = 250
const STATUS_CACHE_MS = 10_000
const DEFAULT_TIMEOUT_MS = 30_000
// Sonda di liveness (,/10/, usata da getStatus): deadline propria, molto più
// corta del timeout di stampa configurato. Un axonFPiD irraggiungibile non deve
// far bloccare GET /printers e GET /status per l'intero timeout di stampa
// (tipicamente 30s): la sonda usa il minore fra questo valore e il timeout.
const STATUS_PROBE_TIMEOUT_MS = 5_000

// File flag creati da axonFPiD nella cartella LOG finché la condizione è vera.
const FLAG_PAPER_OUT = ['Fine_Carta.log', 'Quasi_Fine_Carta.log']
const FLAG_COVER_OPEN = 'Sportello_Aperto.log'
const FLAG_FATAL = 'Errore_Grave.log'
const FLAG_DISPLAY = 'Display_Non_OK.log'

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toPrintResult(res: AxonResponse): PrintResult {
  return {
    success: res.ok,
    receiptNumber: firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO'),
    closureNumber: firstTag(res, 'CMD_i_Z_NUMERO'),
    printerSerial: firstTag(res, 'CMD_a_ECR_MATRICOLA'),
    errorMessage: res.ok ? '' : describeFailure(res),
  }
}

export class AxonFpidDriver implements PrinterDriver {
  readonly name = 'axon-fpid'
  readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']

  private spoolDir = ''
  private logDir = ''
  private timeout = DEFAULT_TIMEOUT_MS
  private operatorId = '1'
  private seq = 0
  private queue: Promise<unknown> = Promise.resolve()
  private statusCache: { at: number; status: PrinterStatus } | null = null
  private statusInFlight: Promise<PrinterStatus> | null = null
  // Incrementato a ogni connect(): permette a una sonda già in volo di
  // accorgersi che è diventata obsoleta (cartelle cambiate) e di astenersi
  // dallo scrivere la cache o dal ripulire il memo di una sonda più recente.
  private generation = 0

  async connect(config: DriverConfig): Promise<void> {
    if (!config.spoolDir) {
      throw new Error('axon-fpid: cartella di ascolto (spoolDir) non configurata')
    }
    this.spoolDir = config.spoolDir
    this.logDir = config.logDir || config.spoolDir
    this.timeout = config.timeout > 0 ? config.timeout : DEFAULT_TIMEOUT_MS
    this.operatorId = config.operatorId
    this.statusCache = null
    this.statusInFlight = null
    this.generation++
  }

  async disconnect(): Promise<void> {}

  /** La RT è una sola: i job non devono mai interlacciarsi. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /**
   * `timeoutOverride` sovrascrive il timeout configurato per questa sola
   * chiamata (usato dalla sonda di liveness in getStatus, che non deve
   * attendere l'intero timeout di stampa). Omesso, si usa this.timeout.
   */
  async submit(commands: string[], timeoutOverride?: number): Promise<AxonResponse> {
    return this.enqueue(() => this.submitNow(commands, timeoutOverride))
  }

  /**
   * Legge una Response candidata solo se completa. axonFPiD non la scrive con
   * una singola write atomica: un file già creato ma ancora privo del tag di
   * chiusura è un ESITO troncato che verrebbe interpretato come stampa
   * fallita — il falso negativo che questo controllo esiste per evitare, dato
   * che il documento fiscale può invece essere stato emesso correttamente.
   * Un candidato incompleto NON viene cancellato: si continua a pollare finché
   * non lo è.
   *
   * Su Windows axonFPiD può tenere il file aperto in scrittura mentre lo sta
   * ancora componendo: in quella finestra `readFile` rigetta con EBUSY/EACCES/
   * EPERM anche se `access()` l'ha già visto esistere. Non è un errore da far
   * risalire al chiamante (il documento fiscale può essere già stato emesso):
   * è solo "non ancora leggibile", trattato come "non ancora pronto" — si
   * continua con il prossimo candidato/prossimo giro di polling. Se il file
   * non diventa mai leggibile, la deadline finale in submitNow emette già il
   * messaggio corretto di sicurezza fiscale.
   */
  private async tryReadResponse(candidates: string[]): Promise<AxonResponse | null> {
    for (const candidate of candidates) {
      if (!(await exists(candidate))) continue
      let xml: string
      try {
        xml = await readFile(candidate, 'latin1')
      } catch {
        continue
      }
      // `continue`, non `return null`: un candidato incompleto non deve
      // mascherare permanentemente un altro candidato (l'altra forma del nome
      // Response) che invece è già completo.
      if (!xml.includes('</RESPONSE>')) continue
      await unlink(candidate).catch(() => undefined)
      return parseAxonResponse(xml)
    }
    return null
  }

  private async submitNow(commands: string[], timeoutOverride?: number): Promise<AxonResponse> {
    // Snapshot di cartelle e timeout all'ingresso: connect() può rimpiazzarli
    // mentre questa chiamata è in corso (Salva+Testa sulla stessa istanza di
    // driver). Messaggi ed errori devono riferirsi alle cartelle con cui
    // questo job è stato davvero inviato, non a quelle correnti al momento
    // dell'errore.
    const spoolDir = this.spoolDir
    const logDir = this.logDir
    const timeout = timeoutOverride ?? this.timeout

    const jobName = `mashup-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}-${++this.seq}`
    const tmpPath = path.join(spoolDir, `${jobName}.tmp`)
    const jobPath = path.join(spoolDir, `${jobName}.txt`)

    // Scrittura su .tmp + rename atomico: axonFPiD sorveglia la cartella e
    // leggerebbe un .txt ancora incompleto.
    // latin1 = CP1252, il consumatore è un'applicazione Windows ANSI.
    await writeFile(tmpPath, sf20.buildCommandFile(commands), 'latin1')
    await rename(tmpPath, jobPath)

    // Il manuale è ambiguo sull'inclusione dell'estensione originale nel nome
    // della Response: cerchiamo entrambe le forme.
    const candidates = [
      path.join(logDir, `Response_${jobName}.xml`),
      path.join(logDir, `Response_${jobName}.txt.xml`),
    ]

    const deadline = Date.now() + timeout
    let pickedUp = false

    while (Date.now() < deadline) {
      const res = await this.tryReadResponse(candidates)
      if (res) return res
      if (!pickedUp && !(await exists(jobPath))) pickedUp = true
      await delay(POLL_INTERVAL_MS)
    }

    // Un'ultima lettura dopo la scadenza: il loop verifica i candidati solo
    // all'inizio di ogni iterazione, quindi una Response scritta nell'ultimo
    // intervallo di polling (prima della deadline ma dopo l'ultimo controllo)
    // non deve essere scartata come se non fosse mai arrivata.
    const finalRes = await this.tryReadResponse(candidates)
    if (finalRes) return finalRes

    if (!pickedUp && (await exists(jobPath))) {
      await unlink(jobPath).catch(() => undefined)
      throw new Error(
        `axonFPiD non ha prelevato il file entro ${timeout} ms: Server di Stampa non ` +
          `attivo, o cartella di ascolto errata (${spoolDir}). Il documento NON è stato stampato.`
      )
    }

    throw new Error(
      `Nessun Response XML entro ${timeout} ms in ${logDir}. Il documento è stato ` +
        'consegnato alla stampante e potrebbe essere stato emesso: NON ristampare senza verifica. ' +
        'Controllare che RESPONSE XML sia attivo in axonFPiD (pannello "LOG e file di risposta") ' +
        'e che la cartella LOG configurata sia quella giusta.'
    )
  }

  private async readFlags(): Promise<Pick<PrinterStatus, 'paperPresent' | 'coverClosed' | 'errorMessage'>> {
    const [paperOut, coverOpen, fatal, display] = await Promise.all([
      Promise.all(FLAG_PAPER_OUT.map((f) => exists(path.join(this.logDir, f)))),
      exists(path.join(this.logDir, FLAG_COVER_OPEN)),
      exists(path.join(this.logDir, FLAG_FATAL)),
      exists(path.join(this.logDir, FLAG_DISPLAY)),
    ])

    let errorMessage = ''
    if (fatal) {
      const detail = await readFile(path.join(this.logDir, FLAG_FATAL), 'latin1').catch(() => '')
      errorMessage = `Errore grave stampante: ${detail.trim() || 'vedi Errore_Grave.log'}`
    } else if (display) {
      errorMessage = 'Display della stampante disconnesso'
    }

    return {
      paperPresent: !paperOut.some(Boolean),
      coverClosed: !coverOpen,
      errorMessage,
    }
  }

  /**
   * Liveness reale (sonda ,/10/) piu` granularità dai file flag, con cache:
   * senza cache ogni GET /status del POS accoderebbe un job nella coda della
   * fiscale, finendo dietro a un eventuale scontrino in corso.
   *
   * La cache da sola non basta: viene scritta solo a sonda conclusa, quindi
   * chiamate concorrenti la mancherebbero tutte e accoderebbero un job ciascuna
   * (specialmente grave sul percorso di errore, dove ognuna aspetterebbe
   * l'intero timeout in serie). Anche la sonda in corso va quindi memoizzata.
   *
   * Una sonda può restare in volo attraverso una connect() (Salva+Testa sulla
   * stessa istanza, con cartelle magari cambiate): la generation catturata
   * all'avvio impedisce a quella sonda ormai obsoleta di scrivere la cache o
   * di ripulire il memo di una sonda più recente al posto del proprio.
   */
  async getStatus(): Promise<PrinterStatus> {
    const cached = this.statusCache
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status
    if (this.statusInFlight) return this.statusInFlight

    const gen = this.generation
    const inFlight = this.readStatus().then(
      (status) => {
        if (gen === this.generation) {
          this.statusCache = { at: Date.now(), status }
          this.statusInFlight = null
        }
        return status
      },
      (err: unknown) => {
        if (gen === this.generation) {
          this.statusInFlight = null
        }
        throw err
      }
    )
    this.statusInFlight = inFlight
    return inFlight
  }

  private async readStatus(): Promise<PrinterStatus> {
    const flags = await this.readFlags()
    try {
      // Deadline propria e corta: uno spool irraggiungibile non deve far
      // attendere GET /status e GET /printers per l'intero timeout di stampa.
      const res = await this.submit([sf20.QUERY.status], Math.min(this.timeout, STATUS_PROBE_TIMEOUT_MS))
      return {
        online: res.ok,
        paperPresent: flags.paperPresent,
        coverClosed: flags.coverClosed,
        errorMessage: res.ok ? flags.errorMessage : describeFailure(res),
      }
    } catch (err: unknown) {
      return {
        online: false,
        paperPresent: flags.paperPresent,
        coverClosed: flags.coverClosed,
        errorMessage: err instanceof Error ? err.message : 'Errore sconosciuto',
      }
    }
  }

  /** Legge dalla stampante identità, tabella IVA e reparti programmati. */
  async probeConfig(): Promise<AxonProbe> {
    const res = await this.submit(sf20.buildProbe())
    const numbers = res.tags['CMD_d_DPT_NUMERO'] ?? []
    const descriptions = res.tags['CMD_d_DPT_DESCRIZIONE'] ?? []
    const vatCodes = res.tags['CMD_d_DPT_ALIQUOTAIVA'] ?? []

    const vatTable: Record<string, string> = {}
    for (const letter of VAT_LETTERS) vatTable[letter] = firstTag(res, `CMD_e_VAT_${letter}`)

    return {
      firmware: firstTag(res, 'CMD_v_ECR_VERSIONEFW'),
      serial: firstTag(res, 'CMD_a_ECR_MATRICOLA'),
      model: firstTag(res, 'CMD_a_ECR_CODICEMODELLO'),
      lastReceiptNumber: firstTag(res, 'CMD_X_ULTIMO_NUMERO_SCONTRINO'),
      vatTable,
      departments: numbers.map((number, i) => ({
        number,
        description: descriptions[i] ?? '',
        vatCode: vatCodes[i] ?? '',
      })),
    }
  }

  async printReceipt(data: ReceiptData): Promise<PrintResult> {
    // X/ e a/ accodati alla vendita: la stessa Response porta numero scontrino
    // e matricola, senza un secondo giro nella coda di stampa.
    const commands = [
      ...sf20.buildReceipt(data, this.operatorId),
      sf20.QUERY.lastDocuments,
      sf20.QUERY.identity,
    ]
    return toPrintResult(await this.submit(commands))
  }

  async dailyClose(operatorId: string): Promise<PrintResult> {
    const commands = [
      ...sf20.buildDailyClose(operatorId || this.operatorId),
      sf20.QUERY.lastClosure,
      sf20.QUERY.identity,
    ]
    return toPrintResult(await this.submit(commands))
  }

  async openDrawer(operatorId: string): Promise<void> {
    const res = await this.submit(sf20.buildOpenDrawer(operatorId || this.operatorId))
    if (!res.ok) throw new Error(describeFailure(res))
  }
}
