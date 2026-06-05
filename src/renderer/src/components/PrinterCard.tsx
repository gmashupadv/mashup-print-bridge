import React, { useState } from 'react'
import { DriverPicker } from './DriverPicker'
import { ConnectionForm } from './ConnectionForm'
import { DeptMapping } from './DeptMapping'
import type { PrinterConfig } from '../../../main/config'

const FISCAL_DRIVERS = new Set(['epson-fpmate', 'ditron-wec'])

interface Props {
  printer: PrinterConfig
  drivers: string[]
  onChange: (updated: PrinterConfig) => void
  onRemove?: () => void
}

export function PrinterCard({ printer, drivers, onChange, onRemove }: Props) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const status = await window.bridge.testDriver(printer.id)
      setTestResult({
        ok: status.online,
        msg: status.online ? 'Online ✓' : status.errorMessage || 'Offline',
      })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Errore' })
    } finally {
      setTesting(false)
    }
  }

  const isFiscal = FISCAL_DRIVERS.has(printer.driver)

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3">
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
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? '…' : 'Test'}
          </button>
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

      <DriverPicker
        drivers={drivers}
        value={printer.driver}
        onChange={(d) => onChange({ ...printer, driver: d })}
        className="mb-3"
      />

      <ConnectionForm
        value={printer.connection}
        onChange={(c) => onChange({ ...printer, connection: c })}
        onTest={handleTest}
        showTestButton={false}
      />

      {isFiscal && (
        <DeptMapping
          value={printer.deptMapping}
          onChange={(m) => onChange({ ...printer, deptMapping: m })}
        />
      )}
    </div>
  )
}
