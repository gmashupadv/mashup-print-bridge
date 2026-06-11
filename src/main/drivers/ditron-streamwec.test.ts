import { describe, it, expect } from 'vitest'
import { buildNonFiscal } from './ditron-streamwec'

describe('buildNonFiscal', () => {
  it('opens, prints escaped lines, closes', () => {
    const cmd = buildNonFiscal({ lines: [{ text: "Po' di testo" }, { text: 'riga2' }] })
    const lines = cmd.trim().split('\n')
    expect(lines[0]).toBe('NFIS APRI')
    expect(lines[1]).toContain('Po  di testo') // apostrofo neutralizzato come nel fiscale
    expect(lines[2]).toContain('riga2')
    expect(lines[lines.length - 1]).toBe('NFIS CHIUDI')
  })

  it('truncates lines to 40 chars', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'x'.repeat(60) }] })
    expect(cmd).toContain(`'${'x'.repeat(40)}'`)
  })
})

describe('capabilities', () => {
  it('declares non-fiscal', async () => {
    const { DitronStreamWecDriver } = await import('./ditron-streamwec')
    expect(new DitronStreamWecDriver().capabilities).toContain('non-fiscal')
  })
})
