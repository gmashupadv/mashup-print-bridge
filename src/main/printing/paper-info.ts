// src/main/printing/paper-info.ts
// Probing dei formati carta del driver di sistema. Usato SOLO in fase di
// configurazione (precompila il form della UI); mai sul percorso di stampa.
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface PaperInfo {
  papers: Array<{ name: string; widthMm?: number; heightMm?: number }>
  defaultPaper?: { name: string; widthMm?: number; heightMm?: number }
}

const KNOWN_MM: Record<string, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  Letter: { widthMm: 216, heightMm: 279 },
  Legal: { widthMm: 216, heightMm: 356 },
}

export function paperNameToMm(name: string): { widthMm: number; heightMm: number } | null {
  if (KNOWN_MM[name]) return KNOWN_MM[name]
  const m = name.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/i)
  if (m) return { widthMm: Number(m[1]), heightMm: Number(m[2]) }
  return null
}

export function parseLpoptionsPageSizes(output: string): { papers: string[]; defaultPaper?: string } {
  const line = output.split('\n').find((l) => /^PageSize\//.test(l))
  if (!line) return { papers: [] }
  const tokens = line.slice(line.indexOf(':') + 1).trim().split(/\s+/).filter(Boolean)
  let defaultPaper: string | undefined
  const papers = tokens.map((t) => {
    if (t.startsWith('*')) {
      defaultPaper = t.slice(1)
      return defaultPaper
    }
    return t
  })
  return { papers, defaultPaper }
}

function withMm(name: string): { name: string; widthMm?: number; heightMm?: number } {
  const mm = paperNameToMm(name)
  return mm ? { name, ...mm } : { name }
}

async function cupsPaperInfo(deviceName: string): Promise<PaperInfo> {
  // Whitelist sanitisation: CUPS queue names are [A-Za-z0-9._-] plus spaces.
  // Strip everything else to prevent shell injection via a crafted printer name.
  const safe = deviceName.replace(/[^A-Za-z0-9._\- ]/g, '')
  // timeout: a hung CUPS daemon must not leave the IPC handler pending forever
  const { stdout } = await execAsync(`lpoptions -p "${safe}" -l`, { timeout: 5000 })
  const parsed = parseLpoptionsPageSizes(stdout)
  return {
    papers: parsed.papers.map(withMm),
    defaultPaper: parsed.defaultPaper ? withMm(parsed.defaultPaper) : undefined,
  }
}

async function windowsPaperInfo(deviceName: string): Promise<PaperInfo> {
  // Whitelist sanitisation: Windows printer names can include spaces and some
  // punctuation, but we strip shell-dangerous chars to prevent injection.
  const safe = deviceName.replace(/[^A-Za-z0-9._\- ]/g, '')
  const cmd = `powershell -NoProfile -Command "(Get-PrintConfiguration -PrinterName '${safe}').PaperSize"`
  const { stdout } = await execAsync(cmd, { timeout: 5000 })
  const name = stdout.trim()
  if (!name) return { papers: [] }
  return { papers: [withMm(name)], defaultPaper: withMm(name) }
}

export async function getPaperInfo(deviceName: string): Promise<PaperInfo> {
  try {
    if (process.platform === 'win32') return await windowsPaperInfo(deviceName)
    return await cupsPaperInfo(deviceName)
  } catch {
    // probing is best-effort: the UI falls back to manual entry on failure
    return { papers: [] }
  }
}
