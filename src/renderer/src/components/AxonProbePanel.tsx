import React, { useState } from 'react'
import { deptMappingFromProbe, mergeDeptMapping, usableDepartments } from '../../../main/printing/axon-probe'
import type { AxonProbe } from '../../../main/printing/axon-probe'

interface Props {
  printerId: string
  existingDeptMapping: Record<string, number>
  onApplyDeptMapping: (mapping: Record<string, number>) => void
}

export function AxonProbePanel({ printerId, existingDeptMapping, onApplyDeptMapping }: Props) {
  const [running, setRunning] = useState(false)
  const [probe, setProbe] = useState<AxonProbe | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      setProbe(await window.bridge.probePrinter(printerId))
    } catch (err) {
      setProbe(null)
      setError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setRunning(false)
    }
  }

  // Reparti che concorrono davvero alla mappatura, non il conteggio basato
  // sulla sola descrizione: un reparto con descrizione ma aliquota IVA non
  // risolvibile è comunque escluso da deptMappingFromProbe.
  const usable = probe ? usableDepartments(probe) : []
  const probeMapping = probe ? deptMappingFromProbe(probe) : {}
  const canApply = Object.keys(probeMapping).length > 0

  const apply = () => {
    if (!probe) return
    const setRates = Object.keys(probeMapping).sort()
    const preservedRates = Object.keys(existingDeptMapping)
      .filter((rate) => !(rate in probeMapping))
      .sort()

    const setLines = setRates.map((rate) => `  • IVA ${rate}% → reparto ${probeMapping[rate]}`).join('\n')
    const preservedText =
      preservedRates.length > 0
        ? `\n\nAliquote già configurate ma non lette dalla sonda (mantenute invariate): ${preservedRates.join(', ')}%.`
        : ''
    const message =
      `La sonda imposterà ${setRates.length} aliquot${setRates.length === 1 ? 'a' : 'e'} IVA nella mappatura reparti:\n` +
      `${setLines}${preservedText}\n\nProcedere?`

    if (window.confirm(message)) {
      onApplyDeptMapping(mergeDeptMapping(existingDeptMapping, probeMapping))
    }
  }

  return (
    <div className="mb-4 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-2">
        <button
          className="text-sm px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
          onClick={run}
          disabled={running}
        >
          {running ? 'Lettura…' : 'Sonda configurazione'}
        </button>
        <span className="text-xs text-gray-500">
          Legge dalla stampante aliquote IVA e reparti programmati
        </span>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {probe && (
        <div className="mt-3 text-xs text-gray-700">
          <p>
            <strong>{probe.model || 'RT'}</strong> · matricola {probe.serial || '—'} · FW{' '}
            {probe.firmware || '—'} · ultimo scontrino {probe.lastReceiptNumber || '—'}
          </p>

          <p className="mt-2">
            Aliquote IVA:{' '}
            {Object.entries(probe.vatTable)
              .map(([letter, rate]) => `${letter}=${rate || '—'}%`)
              .join('  ')}
          </p>

          <p className="mt-2">Reparti con aliquota IVA utilizzabile: {usable.length}</p>
          {usable.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
              {usable.map((d) => (
                <li key={d.number}>
                  {d.number} — {d.description || '(senza descrizione)'} (IVA {d.vatCode})
                </li>
              ))}
            </ul>
          )}

          <button
            className="mt-2 text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={apply}
            disabled={!canApply}
          >
            Applica a mappatura reparti
          </button>
          {!canApply && (
            <p className="mt-1 text-xs text-gray-500">
              Nessun reparto ha un'aliquota IVA utilizzabile programmata: non c'è nulla da applicare.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
