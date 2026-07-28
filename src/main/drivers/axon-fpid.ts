// Driver per stampanti fiscali RT pilotate da axonFPiD_Pro_v7 (A.P.esse).
//
// Non parla con la stampante: deposita file di comandi SF20 nella cartella di
// ascolto del Server di Stampa di axonFPiD e legge il file Response_<job>.xml
// che l'applicazione scrive nella cartella LOG.
//
// Il nome del file è l'unica chiave di correlazione fra richiesta e risposta,
// quindi deve essere univoco per job.
import { writeFile, rename, readFile, unlink, access } from 'node:fs/promises'
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

const POLL_INTERVAL_MS = 250
const STATUS_CACHE_MS = 10_000
const DEFAULT_TIMEOUT_MS = 30_000

// File flag creati da axonFPiD nella cartella LOG finché la condizione è vera.
const FLAG_PAPER_OUT = ['Fine_Carta.log', 'Quasi_Fine_Carta.log']
const FLAG_COVER_OPEN = 'Sportello_Aperto.log'
const FLAG_FATAL = 'Errore_Grave.log'
const FLAG_DISPLAY = 'Display_Non_OK.log'

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
    const number = Number(dept.number)
    if (!Number.isFinite(number) || number <= 0) continue
    const key = Number(rate).toFixed(2)
    if (!(key in mapping)) mapping[key] = number
  }
  return mapping
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

  async connect(config: DriverConfig): Promise<void> {
    if (!config.spoolDir) {
      throw new Error('axon-fpid: cartella di ascolto (spoolDir) non configurata')
    }
    this.spoolDir = config.spoolDir
    this.logDir = config.logDir || config.spoolDir
    this.timeout = config.timeout > 0 ? config.timeout : DEFAULT_TIMEOUT_MS
    this.operatorId = config.operatorId
    this.statusCache = null
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

  async submit(commands: string[]): Promise<AxonResponse> {
    return this.enqueue(() => this.submitNow(commands))
  }

  private async submitNow(commands: string[]): Promise<AxonResponse> {
    const jobName = `mashup-${Date.now()}-${++this.seq}`
    const tmpPath = path.join(this.spoolDir, `${jobName}.tmp`)
    const jobPath = path.join(this.spoolDir, `${jobName}.txt`)

    // Scrittura su .tmp + rename atomico: axonFPiD sorveglia la cartella e
    // leggerebbe un .txt ancora incompleto.
    // latin1 = CP1252, il consumatore è un'applicazione Windows ANSI.
    await writeFile(tmpPath, sf20.buildCommandFile(commands), 'latin1')
    await rename(tmpPath, jobPath)

    // Il manuale è ambiguo sull'inclusione dell'estensione originale nel nome
    // della Response: cerchiamo entrambe le forme.
    const candidates = [
      path.join(this.logDir, `Response_${jobName}.xml`),
      path.join(this.logDir, `Response_${jobName}.txt.xml`),
    ]

    const deadline = Date.now() + this.timeout
    let pickedUp = false

    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        if (await exists(candidate)) {
          const xml = await readFile(candidate, 'latin1')
          await unlink(candidate).catch(() => undefined)
          return parseAxonResponse(xml)
        }
      }
      if (!pickedUp && !(await exists(jobPath))) pickedUp = true
      await delay(POLL_INTERVAL_MS)
    }

    if (!pickedUp && (await exists(jobPath))) {
      await unlink(jobPath).catch(() => undefined)
      throw new Error(
        `axonFPiD non ha prelevato il file entro ${this.timeout} ms: Server di Stampa non ` +
          `attivo, o cartella di ascolto errata (${this.spoolDir}). Il documento NON è stato stampato.`
      )
    }

    throw new Error(
      `Nessun Response XML entro ${this.timeout} ms in ${this.logDir}. Il documento è stato ` +
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
   */
  async getStatus(): Promise<PrinterStatus> {
    const cached = this.statusCache
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status
    const status = await this.readStatus()
    this.statusCache = { at: Date.now(), status }
    return status
  }

  private async readStatus(): Promise<PrinterStatus> {
    const flags = await this.readFlags()
    try {
      const res = await this.submit([sf20.QUERY.status])
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
