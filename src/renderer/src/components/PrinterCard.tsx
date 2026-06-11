import React, { useState } from 'react'
import { DriverPicker } from './DriverPicker'
import { ConnectionForm } from './ConnectionForm'
import { DeptMapping } from './DeptMapping'
import { LabelTemplatePanel } from './LabelTemplatePanel'
import type { PrinterConfig, PrinterRole } from '../../../main/config'
import type { PaperConfig } from '../../../main/drivers/interface'

const ROLES: Array<{ value: PrinterRole; label: string }> = [
  { value: 'fiscal', label: 'Fiscale' },
  { value: 'label', label: 'Etichette' },
  { value: 'receipt', label: 'Ricevute/comande' },
]

// Driver sensati per ruolo: la UI filtra, il server resta la vera guardia (409)
const DRIVERS_BY_ROLE: Record<PrinterRole, string[]> = {
  fiscal: ['epson-fpmate', 'ditron-wec', 'ditron-streamwec'],
  label: ['os-printer', 'escpos-network'],
  receipt: ['escpos-network', 'os-printer'],
}

interface Props {
  printer: PrinterConfig
  drivers: string[]
  onChange: (updated: PrinterConfig) => void
  onRemove?: () => void
}

export function PrinterCard({ printer, drivers, onChange, onRemove }: Props) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const runTest = async (kind: 'status' | 'label' | 'nonfiscal') => {
    setTesting(true)
    setTestResult(null)
    try {
      const status = await window.bridge.testDriver(printer.id, kind)
      if (kind !== 'status') {
        setTestResult({ ok: true, msg: 'Inviato ✓' })
      } else {
        setTestResult({
          ok: status.online,
          msg: status.online ? 'Online ✓' : status.errorMessage || 'Offline',
        })
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Errore' })
    } finally {
      setTesting(false)
    }
  }

  const roleDrivers = DRIVERS_BY_ROLE[printer.role] ?? []
  const filteredDrivers =
    roleDrivers.length > 0 ? drivers.filter((d) => roleDrivers.includes(d)) : drivers
  const displayDrivers = filteredDrivers.length > 0 ? filteredDrivers : drivers

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <input
          className="font-medium text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 outline-none px-0.5"
          value={printer.label}
          onChange={(e) => onChange({ ...printer, label: e.target.value })}
        />
        <div className="flex items-center gap-2">
          {testResult && (
            <span className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.msg}
            </span>
          )}
          <button
            className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
            onClick={() => runTest('status')}
            disabled={testing}
          >
            {testing ? '…' : 'Test'}
          </button>
          {printer.role === 'label' && (
            <button
              className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              onClick={() => runTest('label')}
              disabled={testing}
            >
              Prova etichetta
            </button>
          )}
          {printer.role === 'receipt' && (
            <button
              className="text-xs px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              onClick={() => runTest('nonfiscal')}
              disabled={testing}
            >
              Prova stampa
            </button>
          )}
          {onRemove && (
            <button
              className="text-xs px-2 py-0.5 text-red-500 hover:text-red-700"
              onClick={onRemove}
            >
              Rimuovi
            </button>
          )}
        </div>
      </div>

      {/* Role selector */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">Ruolo</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          value={printer.role}
          onChange={(e) => {
            const role = e.target.value as PrinterRole
            onChange({ ...printer, role, driver: DRIVERS_BY_ROLE[role][0] })
          }}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <DriverPicker
        drivers={displayDrivers}
        value={printer.driver}
        onChange={(d) => onChange({ ...printer, driver: d })}
        className="mb-3"
      />

      <ConnectionForm
        value={printer.connection}
        onChange={(c) => onChange({ ...printer, connection: c })}
        onTest={() => runTest('status')}
        showTestButton={false}
        mode={printer.driver === 'os-printer' ? 'system' : 'network'}
        onPaperDetected={(paper) =>
          onChange({ ...printer, paper: { ...printer.paper, ...paper } as PaperConfig })
        }
      />

      {printer.role === 'fiscal' && (
        <DeptMapping
          value={printer.deptMapping}
          onChange={(m) => onChange({ ...printer, deptMapping: m })}
        />
      )}

      {printer.role === 'label' && (
        <LabelTemplatePanel
          paper={printer.paper}
          template={printer.template}
          onChange={(paper, template) => onChange({ ...printer, paper, template })}
        />
      )}
    </div>
  )
}
