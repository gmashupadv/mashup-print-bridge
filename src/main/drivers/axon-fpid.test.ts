import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, unlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { AxonFpidDriver } from './axon-fpid'

// chmod 000 non impedisce la lettura al processo root: i test che simulano un
// file "non ancora leggibile" (EACCES/EBUSY) non sono significativi in quel
// caso e vanno saltati, non falliti.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

let root = ''
let spoolDir = ''
let logDir = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axon-'))
  spoolDir = path.join(root, 'spool')
  logDir = path.join(root, 'log')
  await mkdir(spoolDir, { recursive: true })
  await mkdir(logDir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function connect(timeout = 2000): Promise<AxonFpidDriver> {
  const driver = new AxonFpidDriver()
  await driver.connect({
    ip: '',
    port: 0,
    timeout,
    operatorId: '1',
    deptMapping: {},
    spoolDir,
    logDir,
  })
  return driver
}

/**
 * Finto axonFPiD: attende un .txt nello spool, lo consuma e scrive la Response
 * nella cartella LOG. Restituisce il contenuto del file consumato.
 */
async function serveOnce(xmlFor: (commands: string) => string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const entries = await readdir(spoolDir)
    const job = entries.find((e) => e.endsWith('.txt'))
    if (job) {
      const jobPath = path.join(spoolDir, job)
      const commands = await readFile(jobPath, 'latin1')
      await unlink(jobPath)
      const base = job.replace(/\.txt$/, '')
      await writeFile(path.join(logDir, `Response_${base}.xml`), xmlFor(commands), 'latin1')
      return commands
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('nessun file comparso nello spool')
}

const OK_RESPONSE = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_virgola_ECR_STATO>1</CMD_virgola_ECR_STATO></RESPONSE>`

describe('trasporto su cartella di ascolto', () => {
  it('deposita un .txt e legge la Response corrispondente', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
  })

  it('scrive i comandi in CRLF e non lascia file temporanei', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    await driver.submit(['v/', 'a/'])
    expect(await served).toBe('v/\r\na/\r\n')
    expect(await readdir(spoolDir)).toEqual([])
  })

  it('cancella la Response dopo averla letta', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    await driver.submit(['v/'])
    await served
    expect(await readdir(logDir)).toEqual([])
  })

  it('diagnostica il Server di Stampa non attivo quando il file resta nello spool', async () => {
    const driver = await connect(400)
    await expect(driver.submit(['v/'])).rejects.toThrow(/Server di Stampa/)
  })

  it('avverte che il documento potrebbe essere stampato se manca solo la Response', async () => {
    const driver = await connect(600)
    const consume = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) return unlink(path.join(spoolDir, job))
        await new Promise((r) => setTimeout(r, 10))
      }
    })()
    await expect(driver.submit(['v/'])).rejects.toThrow(/NON ristampare/)
    await consume
  })

  it('serializza i job: mai più di un .txt nello spool nello stesso istante', async () => {
    const driver = await connect()
    const seen: string[] = []
    let maxTxtSeen = 0
    let watching = true
    const watcher = (async () => {
      while (watching) {
        const entries = await readdir(spoolDir)
        const count = entries.filter((e) => e.endsWith('.txt')).length
        if (count > maxTxtSeen) maxTxtSeen = count
        await new Promise((r) => setTimeout(r, 5))
      }
    })()
    const server = (async () => {
      for (let n = 0; n < 2; n++) seen.push(await serveOnce(() => OK_RESPONSE))
    })()
    await Promise.all([driver.submit(['v/']), driver.submit(['a/'])])
    await server
    watching = false
    await watcher
    // L'ordine conferma che i comandi non si sono mescolati; il conteggio
    // massimo è l'invariante che conta davvero: senza serializzazione due job
    // potrebbero coesistere nello spool anche se serveOnce (che legge una
    // directory non ordinata) li consumasse comunque nell'ordine giusto.
    expect(seen).toEqual(['v/\r\n', 'a/\r\n'])
    expect(maxTxtSeen).toBeLessThanOrEqual(1)
  })

  it('accetta la Response anche scritta in più passi (file incompleto poi completato)', async () => {
    const driver = await connect()
    const served = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) {
          const jobPath = path.join(spoolDir, job)
          await unlink(jobPath)
          const base = job.replace(/\.txt$/, '')
          const responsePath = path.join(logDir, `Response_${base}.xml`)
          // axonFPiD non scrive la Response con una singola write atomica:
          // simuliamo un file creato ma non ancora completo. Il file resta
          // incompleto oltre un ciclo di polling del driver (250ms), cosicché
          // un controllo di completezza mancante lo leggerebbe a metà.
          await writeFile(responsePath, '<RESPONSE><ESITO>O', 'latin1')
          await new Promise((r) => setTimeout(r, 300))
          await writeFile(responsePath, OK_RESPONSE, 'latin1')
          return
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('nessun file comparso nello spool')
    })()
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
  })

  it('legge una Response scritta nell\'ultimo intervallo di polling, prima del timeout', async () => {
    const driver = await connect(600)
    const served = (async () => {
      // Il job è già nello spool dall'inizio: attendiamo a ridosso della
      // scadenza prima di consumarlo, per verificare che il driver non scarti
      // una Response arrivata dopo l'ultimo controllo del loop ma prima della
      // deadline complessiva.
      await new Promise((r) => setTimeout(r, 560))
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) {
          const jobPath = path.join(spoolDir, job)
          await unlink(jobPath)
          const base = job.replace(/\.txt$/, '')
          await writeFile(path.join(logDir, `Response_${base}.xml`), OK_RESPONSE, 'latin1')
          return
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('nessun file comparso nello spool')
    })()
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
  })

  it('accetta anche la forma Response_<job>.txt.xml', async () => {
    const driver = await connect()
    const served = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) {
          const jobPath = path.join(spoolDir, job)
          await unlink(jobPath)
          // Nome comprensivo dell'estensione originale: Response_<job>.txt.xml
          await writeFile(path.join(logDir, `Response_${job}.xml`), OK_RESPONSE, 'latin1')
          return
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('nessun file comparso nello spool')
    })()
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
  })

  it.skipIf(isRoot)(
    'attende se la Response esiste ma non è ancora leggibile (EACCES/EBUSY), poi la restituisce (finding 1)',
    async () => {
      const driver = await connect()
      let responsePath = ''
      const served = (async () => {
        for (let i = 0; i < 200; i++) {
          const entries = await readdir(spoolDir)
          const job = entries.find((e) => e.endsWith('.txt'))
          if (job) {
            const jobPath = path.join(spoolDir, job)
            await unlink(jobPath)
            const base = job.replace(/\.txt$/, '')
            responsePath = path.join(logDir, `Response_${base}.xml`)
            await writeFile(responsePath, OK_RESPONSE, 'latin1')
            // Simula axonFPiD che tiene il file aperto in scrittura su Windows:
            // qui, permessi che rendono il file temporaneamente illeggibile.
            // Senza il fix, readFile qui dentro rigetterebbe con un errno
            // grezzo (EACCES) che risalirebbe fino a driver.submit(), invece
            // di essere trattato come "non ancora pronto".
            await chmod(responsePath, 0o000)
            await new Promise((r) => setTimeout(r, 300))
            await chmod(responsePath, 0o644)
            return
          }
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new Error('nessun file comparso nello spool')
      })()
      const res = await driver.submit(['v/'])
      await served
      expect(res.ok).toBe(true)
      expect(res.reply).toBe('00')
    }
  )

  it('una Response_<job>.xml parziale non maschera una Response_<job>.txt.xml già completa (finding 6)', async () => {
    const driver = await connect()
    const served = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolDir)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) {
          const jobPath = path.join(spoolDir, job)
          await unlink(jobPath)
          const base = job.replace(/\.txt$/, '')
          // Candidato #1 (Response_<job>.xml): presente ma troncato.
          await writeFile(path.join(logDir, `Response_${base}.xml`), '<RESPONSE><ESITO>O', 'latin1')
          // Candidato #2 (Response_<job>.txt.xml): completo. Senza il fix,
          // il candidato troncato farebbe uscire tryReadResponse con `null`
          // prima di arrivare a controllare questo.
          await writeFile(path.join(logDir, `Response_${job}.xml`), OK_RESPONSE, 'latin1')
          return
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('nessun file comparso nello spool')
    })()
    const res = await driver.submit(['v/'])
    await served
    expect(res.ok).toBe(true)
    expect(res.reply).toBe('00')
  })
})

describe('unicità del nome di job fra istanze diverse (finding 4)', () => {
  it('due driver sullo stesso spool, nello stesso millisecondo, producono job distinti', async () => {
    const driverA = await connect()
    const driverB = await connect()

    // Forza la collisione temporale che ha causato il bug: due istanze,
    // ciascuna al proprio primo invio (seq=1), nello stesso Date.now().
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const submitA = driverA.submit(['v/'])
      const submitB = driverB.submit(['a/'])

      // Prima di servire nulla, verifichiamo che compaiano DUE file .txt
      // distinti: col bug (nome = mashup-<Date.now()>-<seq>), il secondo
      // rename avrebbe sovrascritto il primo e ne sarebbe comparso uno solo.
      let jobs: string[] = []
      for (let i = 0; i < 200; i++) {
        jobs = (await readdir(spoolDir)).filter((e) => e.endsWith('.txt'))
        if (jobs.length >= 2) break
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(jobs).toHaveLength(2)
      expect(jobs[0]).not.toBe(jobs[1])

      for (const job of jobs) {
        const jobPath = path.join(spoolDir, job)
        await unlink(jobPath)
        const base = job.replace(/\.txt$/, '')
        await writeFile(path.join(logDir, `Response_${base}.xml`), OK_RESPONSE, 'latin1')
      }

      const [resA, resB] = await Promise.all([submitA, submitB])
      expect(resA.ok).toBe(true)
      expect(resB.ok).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('getStatus', () => {
  it('segnala carta assente in presenza del file flag', async () => {
    const driver = await connect()
    await writeFile(path.join(logDir, 'Fine_Carta.log'), 'fine carta', 'latin1')
    const served = serveOnce(() => OK_RESPONSE)
    const status = await driver.getStatus()
    await served
    expect(status.online).toBe(true)
    expect(status.paperPresent).toBe(false)
    expect(status.coverClosed).toBe(true)
  })

  it('è offline se axonFPiD non risponde', async () => {
    const driver = await connect(300)
    const status = await driver.getStatus()
    expect(status.online).toBe(false)
    expect(status.errorMessage).not.toBe('')
  })

  it('due chiamate concorrenti condividono la stessa sonda: un solo job nello spool', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    const [s1, s2] = await Promise.all([driver.getStatus(), driver.getStatus()])
    await served
    expect(s1).toEqual(s2)
    expect(await readdir(spoolDir)).toEqual([])
  })

  it('una seconda chiamata entro il TTL non genera un secondo job', async () => {
    const driver = await connect()
    const served = serveOnce(() => OK_RESPONSE)
    const first = await driver.getStatus()
    await served
    const second = await driver.getStatus()
    expect(second).toEqual(first)
    expect(await readdir(spoolDir)).toEqual([])
  })

  it('connect() invalida la cache di stato', async () => {
    const driver = await connect()
    const served1 = serveOnce(() => OK_RESPONSE)
    await driver.getStatus()
    await served1

    await driver.connect({
      ip: '',
      port: 0,
      timeout: 2000,
      operatorId: '1',
      deptMapping: {},
      spoolDir,
      logDir,
    })

    // Se la cache non fosse stata invalidata, questa getStatus() risponderebbe
    // dalla cache senza inviare un secondo job: serveOnce (che si arrende dopo
    // ~2s) fallirebbe il test invece di restare bloccato indefinitamente.
    const served2 = serveOnce(() => OK_RESPONSE)
    await driver.getStatus()
    await served2
  })
})

describe('timeout indipendente per la sonda di liveness (finding 2)', () => {
  it(
    'getStatus() su uno spool morto risponde in una frazione del timeout di stampa configurato',
    async () => {
      // Timeout di stampa volutamente grande: senza il fix, getStatus()
      // aspetterebbe l'intero timeout (20s) prima di rispondere.
      const driver = await connect(20_000)
      const start = Date.now()
      const status = await driver.getStatus()
      const elapsed = Date.now() - start
      expect(status.online).toBe(false)
      expect(elapsed).toBeLessThan(10_000)
    },
    15_000
  )

  it('submit() (percorso di stampa) continua a usare il timeout pieno configurato', async () => {
    const driver = await connect(1200)
    const start = Date.now()
    await expect(driver.submit(['v/'])).rejects.toThrow(/Server di Stampa/)
    const elapsed = Date.now() - start
    // Deve aver atteso vicino al timeout di STAMPA (1200ms), non essere
    // stato tagliato alla sola deadline breve della sonda di liveness.
    expect(elapsed).toBeGreaterThanOrEqual(1000)
  })
})

describe('sonda in volo attraverso una connect() a cartelle diverse (finding 3)', () => {
  it('il risultato riflette le cartelle nuove; il messaggio della sonda obsoleta nomina quella vecchia', async () => {
    const spoolA = path.join(root, 'spoolA')
    const logA = path.join(root, 'logA')
    const spoolB = path.join(root, 'spoolB')
    const logB = path.join(root, 'logB')
    await mkdir(spoolA, { recursive: true })
    await mkdir(logA, { recursive: true })
    await mkdir(spoolB, { recursive: true })
    await mkdir(logB, { recursive: true })

    const driver = new AxonFpidDriver()
    await driver.connect({
      ip: '',
      port: 0,
      timeout: 600,
      operatorId: '1',
      deptMapping: {},
      spoolDir: spoolA,
      logDir: logA,
    })

    // Sonda su A: nessuno la servirà mai, andrà in timeout.
    const p1 = driver.getStatus()

    // Aspetta che la sonda su A abbia davvero scritto il job (sia cioè
    // entrata nel proprio ciclo di polling) prima di cambiare le cartelle:
    // il bug riguarda una connect() che muta le cartelle A METÀ di un
    // submitNow già in corso, non solo l'ordine di una coda interna.
    for (let i = 0; i < 200; i++) {
      const entries = await readdir(spoolA)
      if (entries.some((e) => e.endsWith('.txt'))) break
      await new Promise((r) => setTimeout(r, 5))
    }

    // Ora, a sonda in volo, l'installatore corregge le cartelle.
    await driver.connect({
      ip: '',
      port: 0,
      timeout: 2000,
      operatorId: '1',
      deptMapping: {},
      spoolDir: spoolB,
      logDir: logB,
    })
    // Flag "carta finita" SOLO in B, per distinguere osservabilmente una
    // risposta relativa a B da una (mai arrivata) relativa ad A.
    await writeFile(path.join(logB, 'Fine_Carta.log'), 'fine carta', 'latin1')

    const serveB = (async () => {
      for (let i = 0; i < 200; i++) {
        const entries = await readdir(spoolB)
        const job = entries.find((e) => e.endsWith('.txt'))
        if (job) {
          const jobPath = path.join(spoolB, job)
          await unlink(jobPath)
          const base = job.replace(/\.txt$/, '')
          await writeFile(path.join(logB, `Response_${base}.xml`), OK_RESPONSE, 'latin1')
          return
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('nessun file comparso in spoolB')
    })()

    // Nuova sonda, dopo la connect(): deve riflettere le cartelle B.
    const p2 = driver.getStatus()
    await serveB
    const status2 = await p2
    expect(status2.online).toBe(true)
    expect(status2.paperPresent).toBe(false)

    // La sonda su A, ormai obsoleta, si conclude in errore nominando la
    // cartella che ha DAVVERO sondato (A) — non quella corrente dopo la
    // connect() (B), che non è mai stata toccata da questa sonda.
    const status1 = await p1
    expect(status1.online).toBe(false)
    expect(status1.errorMessage).toContain(spoolA)
    expect(status1.errorMessage).not.toContain(spoolB)

    // La sonda obsoleta non deve aver invalidato la cache scritta dalla
    // sonda corrente: una getStatus() successiva entro il TTL non deve
    // accodare un nuovo job in spoolB.
    const status3 = await driver.getStatus()
    expect(status3).toEqual(status2)
    expect(await readdir(spoolB)).toEqual([])
  })
})

describe('probeConfig', () => {
  // Risposta modellata sul Response XML reale della RT30 della cliente: axonFPiD
  // scrive ogni TAG CMD_* UNA SOLA VOLTA, quindi un job puo` trasportare al piu`
  // un reparto. MASSIMOREPARTI dice al driver quanti job di reparto fare.
  const IDENTITY = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_a_ECR_MATRICOLA>8A013756</CMD_a_ECR_MATRICOLA>
<CMD_a_ECR_CODICEMODELLO>GE</CMD_a_ECR_CODICEMODELLO>
<CMD_v_ECR_VERSIONEFW>V2 R1 B7 G100.137</CMD_v_ECR_VERSIONEFW>
<CMD_v_ECR_MASSIMOREPARTI>2</CMD_v_ECR_MASSIMOREPARTI>
<CMD_e_VAT_A>4.00</CMD_e_VAT_A><CMD_e_VAT_B>10.00</CMD_e_VAT_B>
<CMD_e_VAT_C>22.00</CMD_e_VAT_C><CMD_e_VAT_D>22.00</CMD_e_VAT_D>
<CMD_e_VAT_E>22.00</CMD_e_VAT_E></RESPONSE>`

  const department = (n: string, desc: string, vat: string): string =>
    `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_d_DPT_NUMERO>${n}</CMD_d_DPT_NUMERO>
<CMD_d_DPT_DESCRIZIONE>${desc}</CMD_d_DPT_DESCRIZIONE>
<CMD_d_DPT_ALIQUOTAIVA>${vat}</CMD_d_DPT_ALIQUOTAIVA></RESPONSE>`

  /** Serve una risposta diversa per ogni job, nell'ordine in cui arrivano. */
  async function serveSequence(responses: string[]): Promise<string[]> {
    const seen: string[] = []
    for (const response of responses) seen.push(await serveOnce(() => response))
    return seen
  }

  it('interroga un reparto per job e ricostruisce identita`, IVA e reparti', async () => {
    const driver = await connect()
    const served = serveSequence([
      IDENTITY,
      department('1', 'REPAR-1', '3'),
      department('2', 'REPAR-2', '1'),
    ])
    const probe = await driver.probeConfig()
    const files = await served

    // Un solo d/x/ per file: e` il vincolo imposto da axonFPiD.
    expect(files[1]).toBe('d/1/\r\n')
    expect(files[2]).toBe('d/2/\r\n')

    expect(probe.serial).toBe('8A013756')
    expect(probe.model).toBe('GE')
    expect(probe.vatTable).toEqual({ A: '4.00', B: '10.00', C: '22.00', D: '22.00', E: '22.00' })
    expect(probe.departments).toEqual([
      { number: '1', description: 'REPAR-1', vatCode: '3' },
      { number: '2', description: 'REPAR-2', vatCode: '1' },
    ])
  })

  it('salta i reparti che non restituiscono TAG invece di inventarli', async () => {
    const driver = await connect()
    const empty = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS></RESPONSE>`
    const served = serveSequence([IDENTITY, department('1', 'REPAR-1', '3'), empty])
    const probe = await driver.probeConfig()
    await served
    expect(probe.departments).toEqual([{ number: '1', description: 'REPAR-1', vatCode: '3' }])
  })

  it('segnala l`avanzamento a ogni reparto letto', async () => {
    const driver = await connect()
    const served = serveSequence([
      IDENTITY,
      department('1', 'REPAR-1', '3'),
      department('2', 'REPAR-2', '1'),
    ])
    const progress: Array<[number, number]> = []
    await driver.probeConfig((done, total) => progress.push([done, total]))
    await served
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('printReceipt', () => {
  const RECEIPT_RESPONSE = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_X_ULTIMO_NUMERO_SCONTRINO>124</CMD_X_ULTIMO_NUMERO_SCONTRINO>
<CMD_a_ECR_MATRICOLA>8AIGE013756</CMD_a_ECR_MATRICOLA></RESPONSE>`

  it('deposita la sequenza di vendita e restituisce numero scontrino e matricola', async () => {
    const driver = await connect()
    const served = serveOnce(() => RECEIPT_RESPONSE)
    const result = await driver.printReceipt({
      items: [{ description: 'PROVA', quantity: 1, unitPrice: 0.01, department: 1, vatRate: 22 }],
      discount: 0,
      payments: [{ description: 'Contanti', amount: 0.01, paymentType: 0 }],
    })
    const commands = (await served).split('\r\n').filter(Boolean)

    // Le prime tre righe sono la sequenza validata sulla RT della cliente;
    // X/ e a/ sono accodate per farsi restituire numero e matricola.
    expect(commands).toEqual(['3/S/PROVA//1/0.01/1/22///0/', 'U/', '5/1/0////PC//', 'X/', 'a/'])
    expect(result.success).toBe(true)
    expect(result.receiptNumber).toBe('124')
    expect(result.printerSerial).toBe('8AIGE013756')
  })
})

describe('operazioni non ancora implementabili', () => {
  it('dailyClose fallisce con un messaggio che indirizza alla procedura', async () => {
    const driver = await connect()
    await expect(driver.dailyClose('1')).rejects.toThrow(/Scontrini di test/)
  })

  it('openDrawer fallisce con un messaggio che indirizza alla procedura', async () => {
    const driver = await connect()
    await expect(driver.openDrawer('1')).rejects.toThrow(/Scontrini di test/)
  })
})
