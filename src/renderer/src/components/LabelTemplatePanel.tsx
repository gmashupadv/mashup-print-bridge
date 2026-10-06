import React, { useEffect, useRef, useState } from 'react'
import type {
  LabelElement,
  LabelPreset,
  LabelTemplate,
  PaperConfig,
} from '../../../main/drivers/interface'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from '../../../main/printing/defaults'
import { materializeTemplate } from '../../../main/printing/label-template'
import { LabelDesigner } from './LabelDesigner'

interface Props {
  paper?: PaperConfig
  template?: LabelTemplate
  /** Layout salvati dall'utente (config.labelPresets), condivisi fra le stampanti. */
  presets: LabelPreset[]
  onChange: (paper: PaperConfig, template: LabelTemplate) => void
  onPresetsChange: (presets: LabelPreset[]) => void
}

const MARGIN_SIDES: Array<{ key: 'top' | 'right' | 'bottom' | 'left'; label: string }> = [
  { key: 'top', label: 'Sopra' },
  { key: 'right', label: 'Destra' },
  { key: 'bottom', label: 'Sotto' },
  { key: 'left', label: 'Sinistra' },
]

export function LabelTemplatePanel({
  paper = DEFAULT_LABEL_PAPER,
  template = DEFAULT_LABEL_TEMPLATE,
  presets,
  onChange,
  onPresetsChange,
}: Props) {
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [builtins, setBuiltins] = useState<LabelPreset[]>([])
  const [savingName, setSavingName] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paperKey = JSON.stringify(paper)
  const templateKey = JSON.stringify(template)

  useEffect(() => {
    window.bridge.listBuiltinLabelPresets().then(setBuiltins).catch(() => setBuiltins([]))
  }, [])

  // Il trascinamento genera decine di modifiche al secondo: l'anteprima passa dal
  // main process, quindi va accodata e non richiesta a ogni pixel.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      window.bridge
        .previewLabel(paper, template)
        .then((html) => {
          setPreviewHtml(html)
          setPreviewError('')
        })
        .catch((err) => {
          setPreviewHtml('')
          setPreviewError(err instanceof Error ? err.message : 'Anteprima non disponibile')
        })
    }, 120)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperKey, templateKey])

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2500)
  }

  const margins = paper.marginsMm ?? DEFAULT_LABEL_PAPER.marginsMm!
  const isCustom = Array.isArray(template.elements) && template.elements.length > 0

  const setPaper = (patch: Partial<PaperConfig>) => onChange({ ...paper, ...patch }, template)
  const setTemplate = (patch: Partial<LabelTemplate>) => onChange(paper, { ...template, ...patch })
  const setElements = (elements: LabelElement[]) => setTemplate({ version: 2, elements })

  const applyPreset = (id: string) => {
    const preset = [...builtins, ...presets].find((p) => p.id === id)
    if (!preset) return
    onChange({ ...preset.paper }, JSON.parse(JSON.stringify(preset.template)) as LabelTemplate)
  }

  const saveAsPreset = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    const preset: LabelPreset = {
      id: existing?.id ?? `preset-${Date.now().toString(36)}`,
      name: trimmed,
      paper: JSON.parse(JSON.stringify(paper)) as PaperConfig,
      template: JSON.parse(JSON.stringify(template)) as LabelTemplate,
    }
    onPresetsChange(
      existing ? presets.map((p) => (p.id === existing.id ? preset : p)) : [...presets, preset]
    )
    setSavingName(null)
    flash(existing ? `Preset "${trimmed}" aggiornato` : `Preset "${trimmed}" salvato`)
  }

  const exportCurrent = async () => {
    const name = presets.find((p) => JSON.stringify(p.template) === templateKey)?.name ?? 'Etichetta'
    const path = await window.bridge.exportLabelPreset({
      id: `preset-${Date.now().toString(36)}`,
      name,
      paper,
      template,
    })
    if (path) flash('Layout esportato')
  }

  const importPresets = async () => {
    try {
      const imported = await window.bridge.importLabelPresets()
      if (imported.length === 0) return
      const byId = new Map(presets.map((p) => [p.id, p]))
      for (const p of imported) byId.set(p.id, p)
      onPresetsChange([...byId.values()])
      onChange({ ...imported[0].paper }, imported[0].template)
      flash(`Importato: ${imported[0].name}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Importazione fallita')
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">Etichetta</label>

      {/* --- Libreria layout --- */}
      <div className="flex items-center gap-2 mb-2">
        <select
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs bg-white"
          value=""
          onChange={(e) => e.target.value && applyPreset(e.target.value)}
        >
          <option value="">Applica un layout salvato…</option>
          {builtins.length > 0 && (
            <optgroup label="Inclusi">
              {builtins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {presets.length > 0 && (
            <optgroup label="Personali">
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 whitespace-nowrap"
          onClick={() => setSavingName('')}
        >
          Salva come…
        </button>
        <button
          className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          onClick={exportCurrent}
          title="Esporta il layout corrente in un file JSON"
        >
          Esporta
        </button>
        <button
          className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          onClick={importPresets}
          title="Importa un layout da file JSON"
        >
          Importa
        </button>
      </div>

      {savingName !== null && (
        <div className="flex items-center gap-2 mb-2">
          <input
            autoFocus
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
            placeholder="Nome del layout (es. Etichetta matite)"
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveAsPreset(savingName)
              if (e.key === 'Escape') setSavingName(null)
            }}
          />
          <button
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => saveAsPreset(savingName)}
          >
            Salva
          </button>
          <button className="text-xs px-2 py-1 text-gray-500" onClick={() => setSavingName(null)}>
            Annulla
          </button>
        </div>
      )}

      {notice && <p className="text-xs text-green-600 mb-2">{notice}</p>}

      {/* --- Carta --- */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Largh. (mm)</label>
          <input
            type="number"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            value={paper.widthMm}
            onChange={(e) => setPaper({ widthMm: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Alt. (mm)</label>
          <input
            type="number"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            value={paper.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!}
            onChange={(e) => setPaper({ heightMm: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-2">
        {MARGIN_SIDES.map((s) => (
          <div key={s.key}>
            <label className="block text-[11px] text-gray-500 mb-0.5">{s.label}</label>
            <input
              type="number"
              step="0.5"
              className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
              value={margins[s.key]}
              onChange={(e) =>
                setPaper({ marginsMm: { ...margins, [s.key]: Number(e.target.value) } })
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-2">
        <label className="flex items-center gap-1.5 text-sm">
          Scala testo
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="3"
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
            value={template.fontScale ?? 1}
            onChange={(e) => setTemplate({ fontScale: Number(e.target.value) || 1 })}
          />
        </label>
        {!isCustom && (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={template.showBarcode !== false}
              onChange={(e) => setTemplate({ showBarcode: e.target.checked })}
            />
            Barcode
          </label>
        )}
      </div>

      {/* --- Layout --- */}
      {!isCustom ? (
        <div className="border border-gray-200 rounded bg-gray-50 p-2">
          <div className="flex justify-center overflow-auto">
            {previewHtml ? (
              <iframe
                title="Anteprima etichetta"
                sandbox=""
                srcDoc={previewHtml}
                scrolling="no"
                style={{
                  width: `${paper.widthMm}mm`,
                  height: `${paper.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!}mm`,
                  border: '1px solid #ddd',
                  background: '#fff',
                }}
              />
            ) : (
              <span className="text-xs text-gray-400">
                {previewError || 'Anteprima non disponibile'}
              </span>
            )}
          </div>
          <button
            className="mt-2 w-full text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => onChange(paper, materializeTemplate(template, paper))}
          >
            Personalizza layout (sposta, ridimensiona, togli voci)
          </button>
          <p className="text-[11px] text-gray-400 mt-1">
            Layout automatico: nome, variante, prezzo, SKU e barcode disposti in base al formato.
          </p>
        </div>
      ) : (
        <div>
          {previewError && <p className="text-xs text-red-500 mb-1">{previewError}</p>}
          <LabelDesigner
            paper={paper}
            elements={template.elements ?? []}
            onChange={setElements}
            previewHtml={previewHtml}
          />
          <button
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline"
            onClick={() => {
              const rest: LabelTemplate = { ...template }
              delete rest.elements
              onChange(paper, { ...rest, version: 2 })
            }}
          >
            Torna al layout automatico
          </button>
        </div>
      )}
    </div>
  )
}
