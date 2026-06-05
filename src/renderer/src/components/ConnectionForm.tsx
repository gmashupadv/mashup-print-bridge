import React, { useState } from 'react'

interface Connection {
  ip: string
  port: number
  timeout: number
}

interface Props {
  value: Connection
  onChange: (v: Connection) => void
  onTest: () => Promise<void>
}

export function ConnectionForm({ value, onChange, onTest }: Props) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

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

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Connessione</label>
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="IP"
          value={value.ip}
          onChange={(e) => onChange({ ...value, ip: e.target.value })}
        />
        <input
          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Porta"
          type="number"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
        />
        <input
          className="w-28 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Timeout ms"
          type="number"
          value={value.timeout}
          onChange={(e) => onChange({ ...value, timeout: Number(e.target.value) })}
        />
      </div>
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
    </div>
  )
}
