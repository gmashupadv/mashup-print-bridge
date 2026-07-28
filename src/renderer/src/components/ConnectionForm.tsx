import React, { useEffect, useState } from 'react'
import type { PaperConfig } from '../../../main/drivers/interface'

interface Connection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
  spoolDir?: string
  logDir?: string
}

interface Props {
  value: Connection
  onChange: (v: Connection) => void
  onTest: () => Promise<void>
  showTestButton?: boolean
  mode?: 'network' | 'system' | 'spool'
  onPaperDetected?: (paper: Partial<PaperConfig>) => void
}

export function ConnectionForm({
  value,
  onChange,
  onTest,
  showTestButton = true,
  mode = 'network',
  onPaperDetected,
}: Props) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [systemPrinters, setSystemPrinters] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mode === 'system') {
      setLoading(true)
      window.bridge
        .listSystemPrinters()
        .then(setSystemPrinters)
        .catch(() => setSystemPrinters([]))
        .finally(() => setLoading(false))
    }
  }, [mode])

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      await onTest()
      setResult({ ok: true, msg: 'Connessione OK' })
    } catch (err: unknown) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Errore' })
    } finally {
      setTesting(false)
    }
  }

  const handleDeviceSelect = async (deviceName: string) => {
    onChange({ ...value, deviceName })
    if (deviceName && onPaperDetected) {
      try {
        const info = await window.bridge.getPaperInfo(deviceName)
        if (info.defaultPaper && info.defaultPaper.widthMm && info.defaultPaper.heightMm) {
          onPaperDetected({
            widthMm: info.defaultPaper.widthMm,
            heightMm: info.defaultPaper.heightMm,
          })
        }
      } catch {
        // silenzioso
      }
    }
  }

  const pickInto = async (field: 'spoolDir' | 'logDir') => {
    const folder = await window.bridge.pickFolder()
    if (folder) onChange({ ...value, [field]: folder })
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Connessione</label>

      {mode === 'spool' ? (
        <div className="flex flex-col gap-2 mb-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Cartella di ascolto (Server di Stampa)
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="C:\axonFPiD_Pro_v7\Spool"
                value={value.spoolDir ?? ''}
                onChange={(e) => onChange({ ...value, spoolDir: e.target.value })}
              />
              <button
                className="text-sm px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                onClick={() => pickInto('spoolDir')}
              >
                Sfoglia
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Cartella LOG e file di risposta
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="C:\axonFPiD_Pro_v7\Log"
                value={value.logDir ?? ''}
                onChange={(e) => onChange({ ...value, logDir: e.target.value })}
              />
              <button
                className="text-sm px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                onClick={() => pickInto('logDir')}
              >
                Sfoglia
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Se vuota si usa la cartella di ascolto. Deve avere RESPONSE XML attivo in axonFPiD.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Timeout (ms)</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="30000"
              type="number"
              value={value.timeout}
              onChange={(e) => onChange({ ...value, timeout: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : mode === 'system' ? (
        <div className="flex flex-col gap-2 mb-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Stampante di sistema</label>
            {loading ? (
              <p className="text-xs text-gray-400 py-1">Ricerca stampanti…</p>
            ) : (
              <select
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                value={value.deviceName ?? ''}
                onChange={(e) => handleDeviceSelect(e.target.value)}
              >
                <option value="">— Seleziona —</option>
                {value.deviceName && !systemPrinters.includes(value.deviceName) && (
                  <option key="__orphan__" value={value.deviceName} disabled>
                    {value.deviceName} (non trovata)
                  </option>
                )}
                {systemPrinters.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!loading && systemPrinters.length === 0 && (
            <p className="text-xs text-amber-600">
              Nessuna stampante di sistema trovata. Installa il driver del produttore e riapri
              questa finestra.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-2">
          <input
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="Indirizzo IP"
            value={value.ip}
            onChange={(e) => onChange({ ...value, ip: e.target.value })}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Porta</label>
              <input
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="80"
                type="number"
                value={value.port}
                onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Timeout (ms)</label>
              <input
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="10000"
                type="number"
                value={value.timeout}
                onChange={(e) => onChange({ ...value, timeout: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}

      {showTestButton && (
        <div className="flex items-center gap-2">
          <button
            className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? 'Testing…' : 'Testa connessione'}
          </button>
          {result && (
            <span className={`text-xs ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
              {result.ok ? '✓' : '✗'} {result.msg}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
