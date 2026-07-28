import React, { useState } from 'react'
import { deptMappingFromProbe } from '../../../main/printing/axon-probe'
import type { AxonProbe } from '../../../main/printing/axon-probe'

interface Props {
  printerId: string
  onApplyDeptMapping: (mapping: Record<string, number>) => void
}

export function AxonProbePanel({ printerId, onApplyDeptMapping }: Props) {
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

  const configured = probe?.departments.filter((d) => d.description.trim() !== '') ?? []

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

          <p className="mt-2">Reparti programmati: {configured.length}</p>
          {configured.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
              {configured.map((d) => (
                <li key={d.number}>
                  {d.number} — {d.description} (IVA {d.vatCode})
                </li>
              ))}
            </ul>
          )}

          <button
            className="mt-2 text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => onApplyDeptMapping(deptMappingFromProbe(probe))}
          >
            Applica a mappatura reparti
          </button>
        </div>
      )}
    </div>
  )
}
