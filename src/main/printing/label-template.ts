// src/main/printing/label-template.ts
// Modello di layout etichetta condiviso da TUTTI i motori di stampa:
//   - label-renderer.ts  → HTML (os-printer, escpos-network via raster)
//   - zpl.ts             → ZPL nativo (zpl-network)
// Un template è una lista di elementi posizionati in millimetri assoluti sulla
// carta: le coordinate mm si mappano 1:1 sia su CSS (position:absolute) sia su
// ZPL (^FO x,y in dot), quindi un solo modello descrive entrambi gli output.
//
// Template SENZA `elements` = layout automatico (comportamento storico v1):
// defaultElementsFor() lo ricalcola in funzione della carta, così un template
// non personalizzato resta sensato su qualunque formato.
import type {
  LabelAlign,
  LabelData,
  LabelElement,
  LabelElementType,
  LabelLayout,
  LabelRotation,
  LabelTemplate,
  PaperConfig,
} from '../drivers/interface'

export const DEFAULT_LABEL_PAPER: PaperConfig = {
  widthMm: 50,
  heightMm: 30,
  orientation: 'portrait',
  marginsMm: { top: 1, right: 2, bottom: 1, left: 2 },
}

export interface ResolvedPaper {
  widthMm: number
  heightMm: number
  margins: { top: number; right: number; bottom: number; left: number }
  innerW: number
  innerH: number
}

/** Elemento con ogni campo risolto: nessun optional, nessun NaN, pronto da disegnare. */
export interface ResolvedElement {
  id: string
  type: LabelElementType
  xMm: number
  yMm: number
  wMm: number
  hMm: number
  fontMm: number
  bold: boolean
  align: LabelAlign
  maxLines: number
  autoFit: boolean
  minFontMm: number
  rotate: LabelRotation
  text: string
  showHri: boolean
  moduleMm: number | null
  strikethrough: boolean
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Carta normalizzata. La coercizione numerica è anche la guardia contro
 * l'iniezione di CSS/ZPL da input IPC non validati: un "50mm; }</style>" non
 * è finito e fa lanciare invece di finire dentro il foglio di stile.
 */
export function resolvePaper(paper: PaperConfig | undefined): ResolvedPaper {
  const p = paper ?? DEFAULT_LABEL_PAPER
  const widthMm = Number(p.widthMm)
  const heightMm = Number(p.heightMm ?? DEFAULT_LABEL_PAPER.heightMm!)
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    throw new Error(`Dimensioni etichetta non valide: ${p.widthMm}x${p.heightMm}`)
  }
  // Merge per-campo: un marginsMm parziale non deve mai produrre NaN o undefined.
  const dm = DEFAULT_LABEL_PAPER.marginsMm!
  const pm = p.marginsMm ?? dm
  const margins = {
    top: num(pm.top, dm.top),
    right: num(pm.right, dm.right),
    bottom: num(pm.bottom, dm.bottom),
    left: num(pm.left, dm.left),
  }
  return {
    widthMm,
    heightMm,
    margins,
    innerW: widthMm - margins.left - margins.right,
    innerH: heightMm - margins.top - margins.bottom,
  }
}

// --- Formattazione dei valori --------------------------------------------

export function eurIt(n: number): string {
  return `€ ${n.toFixed(2).replace('.', ',')}`
}

/**
 * Testo da stampare per un elemento, o null se non c'è nulla da mostrare
 * (campo assente nei dati → l'elemento sparisce, non lascia un buco).
 * `el.text` funge da formato quando contiene il segnaposto {value}
 * (es. "Cod. {value}"); per gli elementi 'static' è il testo stesso.
 */
export function elementText(el: ResolvedElement, label: LabelData): string | null {
  let value: string | null
  switch (el.type) {
    case 'static':
      value = el.text
      break
    case 'name':
      value = label.name ?? ''
      break
    case 'variant':
      value = label.variant ?? ''
      break
    case 'sku':
      value = label.sku ?? ''
      break
    case 'price': {
      const n = Number(label.price)
      value = Number.isFinite(n) ? eurIt(n) : ''
      break
    }
    case 'compareAtPrice': {
      const cmp = Number(label.compareAtPrice)
      // Reso solo se è un numero valido e maggiore del prezzo di vendita.
      value = Number.isFinite(cmp) && cmp > Number(label.price) ? eurIt(cmp) : ''
      break
    }
    default:
      value = ''
  }
  if (!value) return null
  if (el.type !== 'static' && el.text && el.text.includes('{value}')) {
    return el.text.replace('{value}', value)
  }
  return value
}

/** Valore grezzo del barcode per un elemento di tipo 'barcode', o null. */
export function barcodeValue(el: ResolvedElement, label: LabelData): string | null {
  if (el.type !== 'barcode') return null
  const v = el.text && !el.text.includes('{value}') ? el.text : label.barcode
  const s = v === undefined || v === null ? '' : String(v).trim()
  return s.length > 0 ? s : null
}

// --- Adattamento del corpo al riquadro ------------------------------------
// Il corpo va deciso QUI, nel modello condiviso, non nel browser: la Zebra non
// sa misurare il testo, quindi un fit calcolato lato HTML farebbe divergere
// anteprima e stampa ZPL. La misura è stimata da una tabella di avanzamenti in
// em — approssimativa ma identica per i due motori, che è ciò che conta.

/** Corpo minimo di default: sotto ~1.8mm le teste a 203 dpi non sono leggibili. */
export const DEFAULT_MIN_FONT_MM = 1.8

// Interlinea di `.txt` in label-renderer.ts; ZPL ^FB usa lo stesso passo del corpo.
const LINE_HEIGHT = 1.1
// La stima a caratteri non coincide al millimetro con le metriche reali del font.
const FIT_SAFETY = 0.97
const FIT_STEP_MM = 0.05

const NARROW = "iljI.,:;'`!|()[]{} "
const SEMI_NARROW = 'ftr/\\-'
const WIDE = 'mwMW@%'

/** Avanzamento di un carattere in em. Tarato sui sans di sistema e su ^A0 (~0.6 em medio). */
function charEm(ch: string): number {
  if (NARROW.includes(ch)) return 0.28
  if (SEMI_NARROW.includes(ch)) return 0.35
  if (WIDE.includes(ch)) return 0.85
  if (ch >= 'A' && ch <= 'Z') return 0.67
  if (ch >= '0' && ch <= '9') return 0.56
  return 0.55
}

function widthEm(text: string, bold: boolean): number {
  let w = 0
  for (const ch of text) w += charEm(ch)
  return bold ? w * 1.04 : w
}

/**
 * Righe occupate dal testo mandato a capo in `availEm` em di larghezza.
 * A capo greedy sugli spazi; una parola più lunga della riga viene spezzata,
 * come fa `overflow-wrap: break-word` nell'anteprima.
 */
export function linesNeeded(text: string, availEm: number, bold: boolean): number {
  if (availEm <= 0) return Number.POSITIVE_INFINITY
  const spaceEm = charEm(' ')
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = widthEm(word, bold)
    const gap = used > 0 ? spaceEm : 0
    if (used > 0 && used + gap + w > availEm) {
      lines++
      used = 0
    } else {
      used += gap
    }
    // Parola più larga dell'intera riga: si spezza, occupando righe piene.
    while (w > availEm) {
      w -= availEm
      lines++
    }
    used += w
  }
  return lines
}

/**
 * Corpo effettivo dell'elemento per questo testo. Senza `autoFit` è `fontMm`
 * invariato; con `autoFit` scende a passi finché il testo entra nel riquadro
 * (larghezza x righe x altezza), fermandosi a `minFontMm` — sotto quella soglia
 * il testo resta tagliato, come senza adattamento.
 */
export function fitFontMm(el: ResolvedElement, text: string): number {
  if (!el.autoFit || !text) return el.fontMm
  const availMm = el.wMm * FIT_SAFETY
  if (availMm <= 0) return el.fontMm
  const min = Math.min(el.minFontMm, el.fontMm)
  const fits = (font: number): boolean => {
    const lines = linesNeeded(text, availMm / font, el.bold)
    if (lines > el.maxLines) return false
    // L'altezza conta quanto la larghezza: le righe oltre `hMm` le taglia
    // l'overflow del riquadro (HTML) o il bordo dell'etichetta (ZPL).
    return el.hMm <= 0 || lines * font * LINE_HEIGHT <= el.hMm
  }
  let font = el.fontMm
  while (font > min) {
    if (fits(font)) return font
    font = Math.round((font - FIT_STEP_MM) * 100) / 100
  }
  return min
}

// --- Layout automatico ----------------------------------------------------

const ALIGNS: LabelAlign[] = ['left', 'center', 'right']
const ROTATIONS: LabelRotation[] = [0, 90, 180, 270]

/**
 * Layout storico "product-price" ricalcolato sulla carta corrente:
 * nome (fino a 3 righe) → variante → riga prezzo + SKU → barcode ancorato in basso.
 * È ciò che vede chi non ha mai toccato l'editor.
 */
export function defaultElementsFor(paper: ResolvedPaper, showBarcode = true): LabelElement[] {
  const { margins: m, innerW, innerH } = paper
  const els: LabelElement[] = []

  const barcodeH = showBarcode ? Math.max(3, Math.min(8, innerH * 0.25)) : 0
  // +2.6mm per la riga di cifre HRI sotto le barre
  const barcodeBlock = barcodeH > 0 ? barcodeH + 2.6 : 0
  const barcodeY = m.top + innerH - barcodeBlock

  const priceFont = 3.4
  const priceH = priceFont * 1.25
  const priceY = Math.max(m.top, barcodeY - (barcodeBlock > 0 ? 0.8 : 0) - priceH)

  const nameFont = 2.9
  const variantFont = 2.4
  const variantH = variantFont * 1.25
  const nameH = Math.max(nameFont * 1.1, priceY - m.top - variantH - 0.4)
  const nameLines = Math.max(1, Math.min(3, Math.floor(nameH / (nameFont * 1.1))))

  els.push({
    id: 'name',
    type: 'name',
    xMm: m.left,
    yMm: m.top,
    wMm: innerW,
    hMm: nameH,
    fontMm: nameFont,
    bold: true,
    align: 'left',
    maxLines: nameLines,
  })
  els.push({
    id: 'variant',
    type: 'variant',
    xMm: m.left,
    yMm: m.top + nameH,
    wMm: innerW,
    hMm: variantH,
    fontMm: variantFont,
    align: 'left',
    maxLines: 1,
  })

  // Prezzo a sinistra, confronto barrato subito a destra, SKU in fondo a destra.
  const priceW = Math.min(innerW * 0.55, innerW)
  els.push({
    id: 'price',
    type: 'price',
    xMm: m.left,
    yMm: priceY,
    wMm: priceW,
    hMm: priceH,
    fontMm: priceFont,
    bold: true,
    align: 'left',
    maxLines: 1,
  })
  const cmpFont = 2.8
  els.push({
    id: 'compareAtPrice',
    type: 'compareAtPrice',
    xMm: m.left + priceW,
    yMm: priceY + (priceH - cmpFont * 1.25),
    wMm: Math.max(0, innerW - priceW),
    hMm: cmpFont * 1.25,
    fontMm: cmpFont,
    align: 'left',
    maxLines: 1,
    strikethrough: true,
  })
  const skuFont = 2.2
  els.push({
    id: 'sku',
    type: 'sku',
    xMm: m.left,
    yMm: priceY + (priceH - skuFont * 1.25),
    wMm: innerW,
    hMm: skuFont * 1.25,
    fontMm: skuFont,
    align: 'right',
    maxLines: 1,
  })

  els.push({
    id: 'barcode',
    type: 'barcode',
    xMm: m.left,
    yMm: barcodeY,
    wMm: innerW,
    hMm: barcodeH || 8,
    fontMm: 2.2,
    align: 'center',
    showHri: true,
    visible: showBarcode,
  })

  return els
}

// --- Risoluzione ----------------------------------------------------------

function coerce(el: LabelElement, i: number, paper: ResolvedPaper, fontScale: number): ResolvedElement {
  const type = (el.type ?? 'static') as LabelElementType
  const isBarcode = type === 'barcode'
  const defFont = isBarcode ? 2.2 : 2.8
  return {
    id: String(el.id || `${type}-${i}`),
    type,
    xMm: num(el.xMm, 0),
    yMm: num(el.yMm, 0),
    wMm: Math.max(0, num(el.wMm, paper.innerW)),
    hMm: Math.max(0, num(el.hMm, isBarcode ? 8 : num(el.fontMm, defFont) * 1.25)),
    fontMm: Math.max(0.5, num(el.fontMm, defFont) * fontScale),
    bold: el.bold === true,
    align: ALIGNS.includes(el.align as LabelAlign) ? (el.align as LabelAlign) : 'left',
    maxLines: Math.max(1, Math.round(num(el.maxLines, 1))),
    autoFit: el.autoFit === true,
    minFontMm: Math.max(0.5, num(el.minFontMm, DEFAULT_MIN_FONT_MM) * fontScale),
    rotate: ROTATIONS.includes(el.rotate as LabelRotation) ? (el.rotate as LabelRotation) : 0,
    text: typeof el.text === 'string' ? el.text : '',
    showHri: el.showHri !== false,
    moduleMm: el.moduleMm === undefined || el.moduleMm === null ? null : Math.max(0.05, num(el.moduleMm, 0.375)),
    strikethrough: el.strikethrough === true || (el.strikethrough === undefined && type === 'compareAtPrice'),
  }
}

/**
 * Elementi effettivamente da disegnare: layout esplicito se il template ne ha
 * uno, altrimenti quello automatico; nascosti scartati, valori coercizzati.
 * `showBarcode: false` (campo legacy v1) resta un interruttore globale.
 */
export function resolveElements(
  template: LabelTemplate | undefined,
  paper: ResolvedPaper
): ResolvedElement[] {
  const t = template ?? {}
  const fontScale = (() => {
    const n = Number(t.fontScale)
    return Number.isFinite(n) && n > 0 ? n : 1
  })()
  const source =
    Array.isArray(t.elements) && t.elements.length > 0
      ? t.elements
      : defaultElementsFor(paper, t.showBarcode !== false)

  return source
    .filter((el) => el && el.visible !== false)
    .filter((el) => !(t.showBarcode === false && el.type === 'barcode'))
    .map((el, i) => coerce(el, i, paper, fontScale))
}

/**
 * Layout riscalato di un fattore uniforme: carta, margini, coordinate, corpi.
 * Serve ai driver che non stampano sull'intera larghezza della carta (le teste
 * ESC/POS da 80mm ne coprono 72): con un layout automatico basta restringere la
 * carta, ma un layout disegnato a mano va rimpicciolito tutto insieme, altrimenti
 * gli elementi a destra escono dall'area stampabile.
 */
export function scaleLayout(layout: LabelLayout, k: number): LabelLayout {
  const factor = Number(k)
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return layout
  const scale = (v: number | undefined): number | undefined =>
    v === undefined || v === null || !Number.isFinite(Number(v)) ? v : Number(v) * factor
  const paper = layout.paper ?? DEFAULT_LABEL_PAPER
  const m = paper.marginsMm
  return {
    paper: {
      ...paper,
      widthMm: Number(paper.widthMm) * factor,
      heightMm: scale(paper.heightMm),
      marginsMm: m
        ? {
            top: Number(m.top) * factor,
            right: Number(m.right) * factor,
            bottom: Number(m.bottom) * factor,
            left: Number(m.left) * factor,
          }
        : m,
    },
    template: {
      ...layout.template,
      elements: layout.template?.elements?.map((el) => ({
        ...el,
        xMm: Number(el.xMm) * factor,
        yMm: Number(el.yMm) * factor,
        wMm: Number(el.wMm) * factor,
        hMm: scale(el.hMm),
        fontMm: scale(el.fontMm),
        moduleMm: scale(el.moduleMm),
      })),
    },
  }
}

/**
 * Template in forma v2 esplicita: materializza il layout automatico in elementi
 * modificabili. Usato dall'editor quando l'utente passa a "personalizzato".
 */
export function materializeTemplate(
  template: LabelTemplate | undefined,
  paper: PaperConfig | undefined
): LabelTemplate {
  const t = template ?? {}
  if (Array.isArray(t.elements) && t.elements.length > 0) {
    return { ...t, version: 2 }
  }
  return {
    version: 2,
    fontScale: t.fontScale ?? 1,
    elements: defaultElementsFor(resolvePaper(paper), t.showBarcode !== false),
  }
}
