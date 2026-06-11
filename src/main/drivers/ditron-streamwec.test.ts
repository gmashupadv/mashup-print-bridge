import { describe, it, expect } from 'vitest'
import { buildNonFiscal, NONFISCAL_OPEN, NONFISCAL_CLOSE } from './ditron-streamwec'

describe('buildNonFiscal', () => {
  it('opens, prints escaped lines, closes', () => {
    const cmd = buildNonFiscal({ lines: [{ text: "Po' di testo" }, { text: 'riga2' }] })
    const lines = cmd.trim().split('\n')
    // assert sulle costanti, non sui literal: la correzione on-site tocca un solo file
    expect(lines[0]).toBe(NONFISCAL_OPEN)
    expect(lines[1]).toContain('Po  di testo') // apostrofo neutralizzato come nel fiscale
    expect(lines[2]).toContain('riga2')
    expect(lines[lines.length - 1]).toBe(NONFISCAL_CLOSE)
  })

  it('truncates lines to 40 chars', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'x'.repeat(60) }] })
    expect(cmd).toContain(`'${'x'.repeat(40)}'`)
  })

  it('neutralizes embedded newlines: one logical line = one command', () => {
    const cmd = buildNonFiscal({ lines: [{ text: 'a\nb\rc' }] })
    const lines = cmd.trim().split('\n')
    expect(lines).toHaveLength(3) // open, una riga, close
    expect(lines[1]).toContain('a b c')
  })
})

describe('capabilities', () => {
  it('declares non-fiscal', async () => {
    const { DitronStreamWecDriver } = await import('./ditron-streamwec')
    expect(new DitronStreamWecDriver().capabilities).toContain('non-fiscal')
  })
})
