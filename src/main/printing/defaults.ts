// src/main/printing/defaults.ts
import type { PaperConfig, LabelTemplate, LabelData } from '../drivers/interface'

export const DEFAULT_LABEL_PAPER: PaperConfig = {
  widthMm: 50,
  heightMm: 30,
  orientation: 'portrait',
  marginsMm: { top: 1, right: 2, bottom: 1, left: 2 },
}

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  preset: 'product-price',
  showBarcode: true,
  fontScale: 1,
}

export const SAMPLE_LABEL: LabelData = {
  name: 'Prodotto di prova',
  variant: 'Variante M',
  price: 19.9,
  comparePrice: 29.9,
  sku: 'SKU-TEST-01',
  barcode: '8001234567897',
}
