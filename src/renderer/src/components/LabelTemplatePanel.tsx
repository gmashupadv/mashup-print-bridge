import React, { useEffect, useState } from 'react'
import type { PaperConfig, LabelTemplate } from '../../../main/drivers/interface'

const DEFAULT_PAPER: PaperConfig = {
  widthMm: 50,
  heightMm: 30,
  orientation: 'portrait',
  marginsMm: { top: 1, right: 2, bottom: 1, left: 2 },
}
const DEFAULT_TEMPLATE: LabelTemplate = { preset: 'product-price', showBarcode: true, fontScale: 1 }

interface Props {
  paper?: PaperConfig
  template?: LabelTemplate
  onChange: (paper: PaperConfig, template: LabelTemplate) => void
}

export function LabelTemplatePanel({
  paper = DEFAULT_PAPER,
  template = DEFAULT_TEMPLATE,
  onChange,
}: Props) {
  const [previewHtml, setPreviewHtml] = useState('')

  const paperKey = JSON.stringify(paper)
  const templateKey = JSON.stringify(template)

  useEffect(() => {
    window.bridge.previewLabel(paper, template).then(setPreviewHtml).catch(() => setPreviewHtml(''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperKey, templateKey])

  const setPaper = (patch: Partial<PaperConfig>) => onChange({ ...paper, ...patch }, template)
  const setTemplate = (patch: Partial<LabelTemplate>) => onChange(paper, { ...template, ...patch })

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">Etichetta</label>
      <div className="grid grid-cols-3 gap-2 mb-2">
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
            value={paper.heightMm ?? 30}
            onChange={(e) => setPaper({ heightMm: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Orientamento</label>
          <select
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            value={paper.orientation ?? 'portrait'}
            onChange={(e) => setPaper({ orientation: e.target.value as PaperConfig['orientation'] })}
          >
            <option value="portrait">Verticale</option>
            <option value="landscape">Orizzontale</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4 mb-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={template.showBarcode}
            onChange={(e) => setTemplate({ showBarcode: e.target.checked })}
          />
          Barcode
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          Scala testo
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="2"
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
            value={template.fontScale}
            onChange={(e) => setTemplate({ fontScale: Number(e.target.value) || 1 })}
          />
        </label>
      </div>
      <div className="border border-gray-200 rounded bg-gray-50 p-2 flex justify-center overflow-auto">
        {previewHtml ? (
          <iframe
            title="Anteprima etichetta"
            sandbox=""
            srcDoc={previewHtml}
            style={{
              width: `${paper.widthMm}mm`,
              height: `${paper.heightMm ?? 30}mm`,
              border: '1px solid #ddd',
              background: '#fff',
            }}
          />
        ) : (
          <span className="text-xs text-gray-400">Anteprima non disponibile</span>
        )}
      </div>
    </div>
  )
}
