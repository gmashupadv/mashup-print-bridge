import React, { useEffect, useState } from 'react'
import { PrinterCard } from './components/PrinterCard'
import { EventLog } from './components/EventLog'
import type { AppConfig, PrinterConfig } from '../../main/config'
import type { LabelPreset, PaperConfig } from '../../main/drivers/interface'

function newPrinter(): PrinterConfig {
  return {
    id: `printer-${Date.now()}`,
    label: 'Nuova stampante',
    role: 'receipt',
    driver: 'escpos-network',
    connection: { ip: '', port: 9100, timeout: 5000 },
    operatorId: '1',
    deptMapping: {},
  }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>({
    printers: [],
    autostart: true,
    port: 8765,
    logLevel: 'info',
    labelPresets: [],
  })
  const [drivers, setDrivers] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)

  useEffect(() => {
    window.bridge.getConfig().then(setConfig)
    window.bridge.listDrivers().then(setDrivers)
    const unsubLog = window.bridge.onLogEvent((msg) =>
      setEvents((prev) => [...prev.slice(-49), msg])
    )
    const unsubUpdate = window.bridge.onUpdateAvailable(setUpdateAvailable)
    return () => {
      unsubLog()
      unsubUpdate()
    }
  }, [])

  const updatePrinter = (updated: PrinterConfig) =>
    setConfig((c) => ({ ...c, printers: c.printers.map((p) => (p.id === updated.id ? updated : p)) }))

  const patchPrinterPaper = (id: string, paper: Partial<PaperConfig>) =>
    setConfig((c) => ({
      ...c,
      printers: c.printers.map((p) => (p.id === id ? { ...p, paper: { ...p.paper, ...paper } as PaperConfig } : p)),
    }))

  const setLabelPresets = (labelPresets: LabelPreset[]) =>
    setConfig((c) => ({ ...c, labelPresets }))

  const addPrinter = () =>
    setConfig((c) => ({ ...c, printers: [...c.printers, newPrinter()] }))

  const removePrinter = (id: string) =>
    setConfig((c) => ({ ...c, printers: c.printers.filter((p) => p.id !== id) }))

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

  return (
    <div className="p-4 bg-white h-screen overflow-y-auto text-gray-800 text-sm">
      <h1 className="font-semibold mb-4">Mashup Print Bridge — Configurazione</h1>

      {updateAvailable && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-blue-800">
            Disponibile aggiornamento <strong>{updateAvailable}</strong>
          </span>
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap"
            onClick={() => window.bridge.openReleasesPage()}
          >
            Scarica
          </button>
        </div>
      )}

      {config.printers.map((printer) => (
        <PrinterCard
          key={printer.id}
          printer={printer}
          drivers={drivers}
          onChange={updatePrinter}
          onRemove={config.printers.length > 1 ? () => removePrinter(printer.id) : undefined}
          onPatchPaper={(paper) => patchPrinterPaper(printer.id, paper)}
          labelPresets={config.labelPresets ?? []}
          onLabelPresetsChange={setLabelPresets}
        />
      ))}

      <button
        className="w-full mb-4 py-1.5 border-2 border-dashed border-gray-300 text-gray-500 rounded hover:border-blue-400 hover:text-blue-500 text-sm"
        onClick={addPrinter}
      >
        + Aggiungi stampante
      </button>

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
