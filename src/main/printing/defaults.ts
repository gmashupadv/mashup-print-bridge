// src/main/printing/defaults.ts
import type { LabelData, LabelElement, LabelPreset, LabelTemplate } from '../drivers/interface'
import { DEFAULT_LABEL_PAPER } from './label-template'

export { DEFAULT_LABEL_PAPER }

/**
 * Template di partenza: nessun `elements` = layout automatico, ricalcolato
 * sulla carta configurata (vedi defaultElementsFor in label-template.ts).
 * Chi personalizza dall'editor riceve invece un template con elementi espliciti.
 */
export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  version: 2,
  showBarcode: true,
  fontScale: 1,
}

export const SAMPLE_LABEL: LabelData = {
  name: 'Prodotto di prova',
  variant: 'Variante M',
  price: 19.9,
  compareAtPrice: 29.9,
  sku: 'SKU-TEST-01',
  barcode: '8001234567897',
}

function el(e: LabelElement): LabelElement {
  return e
}

/**
 * Layout pronti all'uso, punto di partenza per la configurazione di un cliente.
 * Sono solo dati: l'utente li applica, li ritocca nell'editor e li risalva come
 * preset personale (config.labelPresets) o li esporta in JSON.
 */
export const BUILTIN_LABEL_PRESETS: LabelPreset[] = [
  {
    id: 'builtin:standard-50x30',
    name: 'Standard 50×30 (automatico)',
    paper: { ...DEFAULT_LABEL_PAPER },
    template: { version: 2, showBarcode: true, fontScale: 1 },
  },
  {
    id: 'builtin:solo-prezzo-30x12',
    name: 'Solo prezzo 30×12 (matite, trucchi)',
    paper: {
      widthMm: 30,
      heightMm: 12,
      orientation: 'portrait',
      marginsMm: { top: 1, right: 1.5, bottom: 1, left: 1.5 },
    },
    template: {
      version: 2,
      fontScale: 1,
      elements: [
        el({
          id: 'price',
          type: 'price',
          xMm: 1.5,
          yMm: 2.4,
          wMm: 27,
          hMm: 7,
          fontMm: 5.4,
          bold: true,
          align: 'center',
          maxLines: 1,
        }),
      ],
    },
  },
  {
    id: 'builtin:prezzo-confronto-40x20',
    name: 'Prezzo + prezzo pieno 40×20',
    paper: {
      widthMm: 40,
      heightMm: 20,
      orientation: 'portrait',
      marginsMm: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
    },
    template: {
      version: 2,
      fontScale: 1,
      elements: [
        el({ id: 'name', type: 'name', xMm: 2, yMm: 1.5, wMm: 36, hMm: 5.4, fontMm: 2.4, bold: true, align: 'center', maxLines: 2 }),
        el({ id: 'price', type: 'price', xMm: 2, yMm: 7.6, wMm: 24, hMm: 6.5, fontMm: 5, bold: true, align: 'left', maxLines: 1 }),
        el({ id: 'compareAtPrice', type: 'compareAtPrice', xMm: 26, yMm: 9.6, wMm: 12, hMm: 4, fontMm: 3, align: 'right', maxLines: 1, strikethrough: true }),
      ],
    },
  },
  {
    id: 'builtin:verticale-12x40',
    name: 'Verticale stretta 12×40 (prezzo ruotato)',
    paper: {
      widthMm: 12,
      heightMm: 40,
      orientation: 'portrait',
      marginsMm: { top: 2, right: 1, bottom: 2, left: 1 },
    },
    template: {
      version: 2,
      fontScale: 1,
      elements: [
        el({ id: 'price', type: 'price', xMm: 2.5, yMm: 2, wMm: 36, hMm: 6, fontMm: 4.6, bold: true, align: 'center', maxLines: 1, rotate: 90 }),
      ],
    },
  },
]
