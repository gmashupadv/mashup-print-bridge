import React, { useEffect, useState, useCallback } from 'react'
import { DriverPicker } from './components/DriverPicker'
import { ConnectionForm } from './components/ConnectionForm'
import { DeptMapping } from './components/DeptMapping'
import { EventLog } from './components/EventLog'
import type { AppConfig } from '../../main/config'

const DEFAULT: AppConfig = {
  driver: 'epson-fpmate',
  autostart: true,
  port: 8765,
  logLevel: 'info',
  connection: { ip: '', port: 80, timeout: 10000 },
  operatorId: '1',
  deptMapping: {},
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT)
  const [drivers, setDrivers] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    window.bridge.getConfig().then(setConfig)
    window.bridge.listDrivers().then(setDrivers)
    const unsub = window.bridge.onLogEvent((msg) =>
      setEvents((prev) => [...prev.slice(-49), msg])
    )
    return unsub
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.bridge.saveConfig(config as unknown as Record<string, unknown>)
      setSaveMsg('Salvato ✓')
    } catch {
      setSaveMsg('Errore nel salvataggio')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(''), 2500)
    }
  }

  const handleTest = useCallback(async () => {
    const status = await window.bridge.testDriver()
    if (!status.online) throw new Error(status.errorMessage || 'Stampante offline')
  }, [])

  return (
    <div className="p-4 bg-white min-h-screen text-gray-800 text-sm">
      <h1 className="font-semibold mb-4">Mashup Print Bridge — Configurazione</h1>

      <DriverPicker
        drivers={drivers}
        value={config.driver}
        onChange={(d) => setConfig({ ...config, driver: d })}
      />

      <ConnectionForm
        value={config.connection}
        onChange={(c) => setConfig({ ...config, connection: c })}
        onTest={handleTest}
      />

      <DeptMapping
        value={config.deptMapping}
        onChange={(m) => setConfig({ ...config, deptMapping: m })}
      />

      <div className="flex items-center gap-3 mb-4">
        <button
          className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Salvataggio…' : 'Salva configurazione'}
        </button>
        {saveMsg && <span className="text-green-600">{saveMsg}</span>}
      </div>

      <EventLog events={events} onClear={() => setEvents([])} />
    </div>
  )
}
