import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { AxonFpidDriver, deptMappingFromProbe } from './axon-fpid'
import type { AxonProbe } from './axon-fpid'

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

describe('probeConfig', () => {
  const PROBE_RESPONSE = `<RESPONSE><ESITO>OK</ESITO><REPLY>00</REPLY>
<DEVICE_STATUS>00</DEVICE_STATUS><FISCAL_STATUS>02</FISCAL_STATUS>
<CMD_v_ECR_VERSIONEFW>V2 R1 B7 F064</CMD_v_ECR_VERSIONEFW>
<CMD_a_ECR_MATRICOLA>8A014141</CMD_a_ECR_MATRICOLA>
<CMD_a_ECR_CODICEMODELLO>TN</CMD_a_ECR_CODICEMODELLO>
<CMD_e_VAT_A>4</CMD_e_VAT_A><CMD_e_VAT_B>10</CMD_e_VAT_B>
<CMD_e_VAT_C>22</CMD_e_VAT_C><CMD_e_VAT_D>0</CMD_e_VAT_D><CMD_e_VAT_E>0</CMD_e_VAT_E>
<CMD_d_DPT_NUMERO>1</CMD_d_DPT_NUMERO><CMD_d_DPT_DESCRIZIONE>ALIMENTARI</CMD_d_DPT_DESCRIZIONE>
<CMD_d_DPT_ALIQUOTAIVA>1</CMD_d_DPT_ALIQUOTAIVA>
<CMD_d_DPT_NUMERO>2</CMD_d_DPT_NUMERO><CMD_d_DPT_DESCRIZIONE>BEVANDE</CMD_d_DPT_DESCRIZIONE>
<CMD_d_DPT_ALIQUOTAIVA>3</CMD_d_DPT_ALIQUOTAIVA></RESPONSE>`

  it('ricostruisce identità, tabella IVA e reparti', async () => {
    const driver = await connect()
    const served = serveOnce(() => PROBE_RESPONSE)
    const probe = await driver.probeConfig()
    await served
    expect(probe.firmware).toBe('V2 R1 B7 F064')
    expect(probe.serial).toBe('8A014141')
    expect(probe.vatTable).toEqual({ A: '4', B: '10', C: '22', D: '0', E: '0' })
    expect(probe.departments).toEqual([
      { number: '1', description: 'ALIMENTARI', vatCode: '1' },
      { number: '2', description: 'BEVANDE', vatCode: '3' },
    ])
  })
})

describe('deptMappingFromProbe', () => {
  it('mappa aliquota su primo reparto che la usa', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '10', C: '22', D: '0', E: '0' },
      departments: [
        { number: '1', description: 'ALIMENTARI', vatCode: '1' },
        { number: '2', description: 'BEVANDE', vatCode: '3' },
        { number: '3', description: 'ALTRO', vatCode: '3' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 1, '22.00': 2 })
  })

  it('ignora reparti con codice IVA fuori range', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '4', B: '', C: '', D: '', E: '' },
      departments: [
        { number: '1', description: 'X', vatCode: '9' },
        { number: '2', description: 'Y', vatCode: '1' },
      ],
    }
    expect(deptMappingFromProbe(probe)).toEqual({ '4.00': 2 })
  })

  it('non genera una chiave "NaN" per un\'aliquota non numerica (virgola italiana o testo)', () => {
    const probe: AxonProbe = {
      firmware: '',
      serial: '',
      model: '',
      lastReceiptNumber: '',
      vatTable: { A: '22,00', B: 'ESENTE', C: '10', D: '', E: '' },
      departments: [
        { number: '1', description: 'X', vatCode: '1' },
        { number: '2', description: 'Y', vatCode: '2' },
        { number: '3', description: 'Z', vatCode: '3' },
      ],
    }
    const mapping = deptMappingFromProbe(probe)
    expect(mapping).not.toHaveProperty('NaN')
    expect(mapping).toEqual({ '10.00': 3 })
  })
})

describe('operazioni non ancora implementabili', () => {
  it('printReceipt fallisce con un messaggio che indirizza alla procedura', async () => {
    const driver = await connect()
    await expect(
      driver.printReceipt({
        items: [{ description: 'X', quantity: 1, unitPrice: 1, department: 1, vatRate: 22 }],
        discount: 0,
        payments: [{ description: 'Contanti', amount: 1, paymentType: 0 }],
      })
    ).rejects.toThrow(/Scontrini di test/)
  })
})
