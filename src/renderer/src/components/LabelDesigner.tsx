import React, { useCallback, useMemo, useRef, useState } from 'react'
import type {
  LabelAlign,
  LabelElement,
  LabelElementType,
  LabelRotation,
  PaperConfig,
} from '../../../main/drivers/interface'
import { resolvePaper } from '../../../main/printing/label-template'

const TYPE_LABELS: Record<LabelElementType, string> = {
  name: 'Nome prodotto',
  variant: 'Variante',
  price: 'Prezzo',
  compareAtPrice: 'Prezzo pieno (barrato)',
  sku: 'SKU / Codice',
  barcode: 'Barcode',
  static: 'Testo fisso',
  line: 'Linea',
}

// Tipi che hanno senso una volta sola: il valore viene da un campo del prodotto.
const SINGLE_USE: LabelElementType[] = ['name', 'variant', 'price', 'compareAtPrice', 'sku']

const ALIGNS: Array<{ value: LabelAlign; label: string }> = [
  { value: 'left', label: 'Sx' },
  { value: 'center', label: 'Cx' },
  { value: 'right', label: 'Dx' },
]

const ROTATIONS: LabelRotation[] = [0, 90, 180, 270]

// 203 dpi = 8 dot/mm, la risoluzione delle etichettatrici termiche in commercio.
const DOTS_PER_MM = 8

function round(n: number, decimals = 1): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Ingombro sull'etichetta: ruotando di 90°/270° larghezza e altezza si scambiano. */
function boxOf(el: LabelElement): { w: number; h: number } {
  const rot = el.rotate ?? 0
  const w = el.wMm
  const h = el.hMm ?? 4
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h }
}

interface Props {
  paper: PaperConfig
  elements: LabelElement[]
  onChange: (elements: LabelElement[]) => void
  /** Anteprima HTML reale (stesso renderer della stampa), mostrata sotto ai riquadri. */
  previewHtml: string
}

export function LabelDesigner({ paper, elements, onChange, previewHtml }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize'
    startX: number
    startY: number
    origin: LabelElement
  } | null>(null)

  const resolved = useMemo(() => {
    try {
      return resolvePaper(paper)
    } catch {
      return null
    }
  }, [paper])

  // Zoom automatico: l'etichetta deve entrare tutta nel riquadro, che sia una
  // 50×30 orizzontale o una 12×40 verticale da matita.
  const pxPerMm = resolved
    ? Math.max(2, Math.min(16, Math.min(420 / resolved.widthMm, 300 / resolved.heightMm)))
    : 8

  const selected = elements.find((e) => e.id === selectedId) ?? null

  const patch = useCallback(
    (id: string, partial: Partial<LabelElement>) => {
      onChange(elements.map((e) => (e.id === id ? { ...e, ...partial } : e)))
    },
    [elements, onChange]
  )

  const onPointerDown = (e: React.PointerEvent, el: LabelElement, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(el.id)
    dragRef.current = { id: el.id, mode, startX: e.clientX, startY: e.clientY, origin: { ...el } }
    const target = e.target as Element
    target.setPointerCapture(e.pointerId)

  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dxMm = (e.clientX - d.startX) / pxPerMm
    const dyMm = (e.clientY - d.startY) / pxPerMm
    const rot = d.origin.rotate ?? 0
    const swapped = rot === 90 || rot === 270
    if (d.mode === 'move') {
      patch(d.id, { xMm: round(d.origin.xMm + dxMm), yMm: round(d.origin.yMm + dyMm) })
    } else {
      // Sul ruotato la maniglia in basso a destra agisce sugli assi scambiati.
      const dw = swapped ? dyMm : dxMm
      const dh = swapped ? dxMm : dyMm
      patch(d.id, {
        wMm: Math.max(1, round(d.origin.wMm + dw)),
        hMm: Math.max(0.5, round((d.origin.hMm ?? 4) + dh)),
      })
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const target = e.target as Element
      try {
        target.releasePointerCapture(e.pointerId)
      } catch {
        /* il puntatore può essere già stato rilasciato dal browser */
      }
    }
    dragRef.current = null
  }

  // Frecce = spostamento fine senza dover azzeccare il pixel col mouse.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return
    const step = e.shiftKey ? 0.1 : 0.5
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = map[e.key]
    if (!delta) return
    e.preventDefault()
    patch(selected.id, { xMm: round(selected.xMm + delta[0]), yMm: round(selected.yMm + delta[1]) })
  }

  const addElement = (type: LabelElementType) => {
    const p = resolved
    const id = `${type}-${Date.now().toString(36)}`
    const el: LabelElement =
      type === 'barcode'
        ? { id, type, xMm: p?.margins.left ?? 2, yMm: 2, wMm: p?.innerW ?? 30, hMm: 10, fontMm: 2.2, align: 'center', showHri: true }
        : type === 'line'
          ? { id, type, xMm: p?.margins.left ?? 2, yMm: 2, wMm: p?.innerW ?? 30, hMm: 0.3 }
          : {
              id,
              type,
              xMm: p?.margins.left ?? 2,
              yMm: 2,
              wMm: p?.innerW ?? 30,
              hMm: 4,
              fontMm: 3,
              align: 'left',
              maxLines: 1,
              ...(type === 'static' ? { text: 'Testo' } : {}),
            }
    onChange([...elements, el])
    setSelectedId(id)
  }

  const removeElement = (id: string) => {
    onChange(elements.filter((e) => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const addable = (Object.keys(TYPE_LABELS) as LabelElementType[]).filter(
    (t) => !SINGLE_USE.includes(t) || !elements.some((e) => e.type === t)
  )

  if (!resolved) {
    return <p className="text-xs text-red-500">Dimensioni etichetta non valide.</p>
  }

  const canvasW = resolved.widthMm * pxPerMm
  const canvasH = resolved.heightMm * pxPerMm
  // L'iframe usa i millimetri veri (96dpi CSS = 3.7795 px/mm): lo scaliamo al
  // fattore di zoom così l'anteprima resta il render esatto della stampa.
  const iframeScale = pxPerMm / (96 / 25.4)

  return (
    <div>
      {/* --- Tela --- */}
      <div
        className="flex justify-center bg-gray-100 rounded p-3 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => setSelectedId(null)}
      >
        <div
          className="relative bg-white shadow-sm"
          style={{ width: canvasW, height: canvasH, border: '1px solid #cbd5e1' }}
        >
          {previewHtml && (
            <iframe
              title="Anteprima etichetta"
              sandbox=""
              srcDoc={previewHtml}
              scrolling="no"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${resolved.widthMm}mm`,
                height: `${resolved.heightMm}mm`,
                border: 0,
                transform: `scale(${iframeScale})`,
                transformOrigin: '0 0',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Margini configurati: guida tratteggiata, non stampata */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: resolved.margins.left * pxPerMm,
              top: resolved.margins.top * pxPerMm,
              width: resolved.innerW * pxPerMm,
              height: resolved.innerH * pxPerMm,
              border: '1px dashed #cbd5e1',
            }}
          />

          {elements.map((el) => {
            const box = boxOf(el)
            const isSel = el.id === selectedId
            const hidden = el.visible === false
            return (
              <div
                key={el.id}
                onPointerDown={(e) => onPointerDown(e, el, 'move')}
                onClick={(e) => e.stopPropagation()}
                title={TYPE_LABELS[el.type]}
                style={{
                  position: 'absolute',
                  left: el.xMm * pxPerMm,
                  top: el.yMm * pxPerMm,
                  width: Math.max(4, box.w * pxPerMm),
                  height: Math.max(4, box.h * pxPerMm),
                  border: isSel ? '1.5px solid #2563eb' : '1px dashed rgba(37,99,235,0.45)',
                  background: isSel ? 'rgba(37,99,235,0.10)' : 'transparent',
                  opacity: hidden ? 0.35 : 1,
                  cursor: 'move',
                  touchAction: 'none',
                }}
              >
                {isSel && (
                  <span
                    onPointerDown={(e) => onPointerDown(e, el, 'resize')}
                    style={{
                      position: 'absolute',
                      right: -4,
                      bottom: -4,
                      width: 9,
                      height: 9,
                      background: '#2563eb',
                      borderRadius: 2,
                      cursor: 'nwse-resize',
                      touchAction: 'none',
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-1 text-center">
        Trascina per spostare, angolo blu per ridimensionare, frecce per spostamenti fini
        (Shift = 0,1 mm).
      </p>

      {/* --- Elenco elementi --- */}
      <div className="mt-3 border border-gray-200 rounded divide-y divide-gray-100">
        {elements.length === 0 && (
          <p className="text-xs text-gray-400 p-2">Nessun elemento: aggiungine uno qui sotto.</p>
        )}
        {elements.map((el) => (
          <div
            key={el.id}
            className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${
              el.id === selectedId ? 'bg-blue-50' : ''
            }`}
            onClick={() => setSelectedId(el.id)}
          >
            <input
              type="checkbox"
              checked={el.visible !== false}
              title="Mostra sull'etichetta"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => patch(el.id, { visible: e.target.checked })}
            />
            <span className="flex-1 truncate">
              {TYPE_LABELS[el.type]}
              {el.type === 'static' && el.text ? ` — “${el.text}”` : ''}
            </span>
            <span className="text-gray-400 tabular-nums">
              {round(el.xMm)}×{round(el.yMm)} mm
            </span>
            <button
              className="text-red-500 hover:text-red-700 px-1"
              title="Elimina elemento"
              onClick={(e) => {
                e.stopPropagation()
                removeElement(el.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <select
          className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
          value=""
          onChange={(e) => {
            if (e.target.value) addElement(e.target.value as LabelElementType)
          }}
        >
          <option value="">+ Aggiungi elemento…</option>
          {addable.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {/* --- Proprietà dell'elemento selezionato --- */}
      {selected && (
        <div className="mt-3 border border-gray-200 rounded p-2">
          <div className="text-xs font-medium text-gray-700 mb-2">
            {TYPE_LABELS[selected.type]}
          </div>

          <div className="grid grid-cols-4 gap-2 mb-2">
            <NumField label="X (mm)" value={selected.xMm} onChange={(v) => patch(selected.id, { xMm: v })} />
            <NumField label="Y (mm)" value={selected.yMm} onChange={(v) => patch(selected.id, { yMm: v })} />
            <NumField label="Largh." value={selected.wMm} onChange={(v) => patch(selected.id, { wMm: v })} />
            <NumField
              label={selected.type === 'barcode' ? 'Altezza' : selected.type === 'line' ? 'Spessore' : 'Alt.'}
              value={selected.hMm ?? 4}
              onChange={(v) => patch(selected.id, { hMm: v })}
            />
          </div>

          {selected.type !== 'line' && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">
                  {selected.type === 'barcode' ? 'Corpo cifre (mm)' : 'Corpo (mm)'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                  value={selected.fontMm ?? 3}
                  onChange={(e) => patch(selected.id, { fontMm: Number(e.target.value) })}
                />
                <span className="text-[10px] text-gray-400">
                  ≈ {Math.round((selected.fontMm ?? 3) * DOTS_PER_MM)} punti a 203 dpi
                </span>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Allineamento</label>
                <div className="flex">
                  {ALIGNS.map((a) => (
                    <button
                      key={a.value}
                      className={`flex-1 border px-1 py-1 text-xs first:rounded-l last:rounded-r ${
                        (selected.align ?? 'left') === a.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white border-gray-300'
                      }`}
                      onClick={() => patch(selected.id, { align: a.value })}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Rotazione</label>
                <select
                  className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs bg-white"
                  value={selected.rotate ?? 0}
                  onChange={(e) => patch(selected.id, { rotate: Number(e.target.value) as LabelRotation })}
                >
                  {ROTATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}°
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {selected.type !== 'line' && selected.type !== 'barcode' && (
            <div className="flex items-center gap-4 mb-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selected.bold === true}
                  onChange={(e) => patch(selected.id, { bold: e.target.checked })}
                />
                Grassetto
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selected.strikethrough ?? selected.type === 'compareAtPrice'}
                  onChange={(e) => patch(selected.id, { strikethrough: e.target.checked })}
                />
                Barrato
              </label>
              <label className="flex items-center gap-1.5">
                Righe max
                <input
                  type="number"
                  min="1"
                  max="8"
                  className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs"
                  value={selected.maxLines ?? 1}
                  onChange={(e) => patch(selected.id, { maxLines: Number(e.target.value) || 1 })}
                />
              </label>
            </div>
          )}

          {selected.type === 'barcode' && (
            <div className="flex items-center gap-4 mb-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selected.showHri !== false}
                  onChange={(e) => patch(selected.id, { showHri: e.target.checked })}
                />
                Cifre sotto le barre
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selected.moduleMm !== undefined}
                  onChange={(e) =>
                    patch(selected.id, { moduleMm: e.target.checked ? 0.375 : undefined })
                  }
                />
                Larghezza barre manuale
              </label>
              {selected.moduleMm !== undefined && (
                <input
                  type="number"
                  step="0.025"
                  min="0.125"
                  className="w-20 border border-gray-300 rounded px-1 py-0.5 text-xs"
                  value={selected.moduleMm}
                  onChange={(e) => patch(selected.id, { moduleMm: Number(e.target.value) })}
                />
              )}
            </div>
          )}

          {selected.type !== 'line' && (
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">
                {selected.type === 'static'
                  ? 'Testo'
                  : selected.type === 'barcode'
                    ? 'Codice fisso (vuoto = barcode del prodotto)'
                    : 'Formato — usa {value} per il valore del prodotto'}
              </label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                placeholder={
                  selected.type === 'static'
                    ? 'Testo fisso'
                    : selected.type === 'barcode'
                      ? '(barcode del prodotto)'
                      : '{value}'
                }
                value={selected.text ?? ''}
                onChange={(e) => patch(selected.id, { text: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-0.5">{label}</label>
      <input
        type="number"
        step="0.1"
        className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
