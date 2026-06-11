# Design: stampa etichette e documenti non fiscali

**Data:** 2026-06-11
**Stato:** approvato (brainstorming con Giuseppe)

## Obiettivo

Estendere Mashup Print Bridge oltre lo scontrino fiscale:

1. **Documenti non fiscali** (preconto, cortesia, comande) — sia sulla stampante fiscale in modalità non fiscale, sia su stampantine termiche 58/80mm.
2. **Etichette prodotto** (nome, variante, prezzo, SKU, barcode con numero leggibile) — su stampantine scontrino ESC/POS e su etichettatrici dedicate (Zebra, Brother QL, Dymo, TSC...).

**Vincolo centrale — stampa silenziosa:** dopo la configurazione iniziale (fatta una volta dalla UI del bridge sul PC cassa), ogni richiesta dal gestionale stampa senza alcun dialogo o intervento umano. Tutte le impostazioni vivono in `config.json`.

**Vincolo piattaforma:** i PC cassa sono un mix Windows/macOS. Tutto il design è cross-platform; le uniche parti per-OS sono isolate in un modulo dedicato (probing formati carta).

## Approccio scelto: ibrido OS + ESC/POS raw

Scartati: "tutto via driver OS" (setup pesante per le ESC/POS di rete, niente taglio/cassetto, driver Windows scadenti per stampantine economiche) e "tutto raw per protocollo" (USB raw doloroso su Win e Mac, un protocollo da implementare per ogni marca di etichettatrice, auto-rilevamento nullo).

Scelto l'ibrido:

- **`os-printer`** (nuovo driver): stampa silenziosa via Electron su qualunque stampante installata nel sistema (USB o rete, Win o Mac). Copre tutte le etichettatrici dedicate tramite il loro driver vendor.
- **`escpos-network`** (completamento dello stub esistente): raw TCP per le 58/80mm in rete — testo stilizzato, taglio, raster per etichette. Niente driver da installare.
- **`printNonFiscal`** sui driver fiscali esistenti (Epson FP-Mate: blocco XML non fiscale nativo; Ditron: comandi WEC da verificare sui pcap in repo).

## Schema config esteso

Ogni voce di `printers[]` guadagna `role` e, dove serve, `paper` e `template`:

```json
{
  "printers": [
    {
      "id": "fiscale",
      "label": "Stampante fiscale",
      "role": "fiscal",
      "driver": "ditron-streamwec",
      "connection": { "ip": "192.168.1.22", "port": 443, "timeout": 10000 },
      "operatorId": "1",
      "deptMapping": { "22.00": 1 }
    },
    {
      "id": "etichette-banco",
      "label": "Etichettatrice banco",
      "role": "label",
      "driver": "os-printer",
      "connection": { "deviceName": "Brother QL-800" },
      "paper": {
        "widthMm": 62, "heightMm": 29,
        "orientation": "landscape",
        "marginsMm": { "top": 1, "right": 2, "bottom": 1, "left": 2 }
      },
      "template": { "preset": "product-price", "showBarcode": true, "fontScale": 1.0 }
    },
    {
      "id": "comande",
      "label": "Stampantina banco 80mm",
      "role": "receipt",
      "driver": "escpos-network",
      "connection": { "ip": "192.168.1.30", "port": 9100, "timeout": 5000 },
      "paper": { "widthMm": 80 }
    }
  ]
}
```

- **`role`**: `fiscal` | `label` | `receipt`. Guida la UI e la validazione server.
- **`connection` polimorfo**: `{ip, port, timeout}` per i driver di rete; `{deviceName}` per `os-printer`.
- **Migrazione**: `config.ts:migrate()` aggiunge `role: "fiscal"` alle voci esistenti. Nessuna rottura per le installazioni in campo. Il percorso legacy single-printer → `printers[]` resta intatto.
- `paper` e `template` si scrivono una volta dalla UI; a runtime non si interroga più nulla.

## Contratto API HTTP (localhost:8765)

Il POS manda **solo dati, mai layout**. Endpoint esistenti (`/print`, `/daily-close`, `/open-drawer`, `/ping`, `/status`) invariati — compatibilità con `PrintBridgeClient` garantita.

### `GET /printers` (esteso)

Aggiunge `role` e `capabilities` a ogni voce, così il gestionale scopre le destinazioni disponibili senza configurazione lato POS:

```json
[
  { "id": "fiscale", "label": "Stampante fiscale", "role": "fiscal",
    "capabilities": ["fiscal-receipt", "non-fiscal", "daily-close", "drawer"],
    "status": { "online": true } },
  { "id": "etichette-banco", "label": "Etichettatrice banco", "role": "label",
    "capabilities": ["label"], "status": { "online": true } }
]
```

### `POST /print-label` (nuovo)

```json
{
  "printerId": "etichette-banco",
  "copies": 1,
  "label": {
    "name": "T-shirt Logo",
    "variant": "Taglia M / Nero",
    "price": 19.90,
    "sku": "TSH-M-BLK",
    "barcode": "8001234567890"
  }
}
```

- `barcode`: stringa EAN-13/Code128; il rendering grafico (barre + **numero leggibile sotto**) lo fa il bridge.
- `variant` e `sku` opzionali; se assenti il template compatta il layout.
- `copies`: N etichette identiche.

### `POST /print-nonfiscal` (nuovo)

Stesso payload per fiscale e termiche; il bridge traduce nel protocollo del driver target:

```json
{
  "printerId": "comande",
  "lines": [
    { "text": "PRECONTO", "bold": true, "size": "double", "align": "center" },
    { "text": "" },
    { "text": "1x Margherita      6,00" },
    { "text": "TOTALE        13,00", "bold": true, "align": "right" }
  ],
  "cut": true
}
```

- Attributi riga: `bold?: boolean`, `size?: 'normal'|'double'`, `align?: 'left'|'center'|'right'`.
- `cut` ignorato con grazia dove non supportato.

### Risoluzione stampante

`printerId` è opzionale su tutti gli endpoint di stampa: se omesso, il bridge usa la **prima stampante che dichiara la capability richiesta** (non semplicemente la prima in lista — un'etichetta senza `printerId` non deve finire in 409 contro la fiscale). Per `/print` e `/status` il comportamento attuale (prima stampante) resta invariato per compatibilità.

### Errori

`404` printerId inesistente; `503` nessuna stampante configurata (o nessuna con la capability richiesta, se `printerId` omesso); **`409` operazione non nelle capabilities** della stampante target; `500` con `errorMessage` parlante per errori stampante.

## Layer driver

### Interfaccia con capabilities

```typescript
type Capability = 'fiscal-receipt' | 'non-fiscal' | 'label' | 'daily-close' | 'drawer' | 'cut'

interface PrinterDriver {
  readonly name: string
  readonly capabilities: Capability[]
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  // opzionali — presenti solo se la capability è dichiarata
  printReceipt?(data: ReceiptData): Promise<PrintResult>
  printNonFiscal?(doc: NonFiscalDoc): Promise<PrintResult>
  printLabel?(label: LabelData, layout: LabelLayout): Promise<PrintResult>
  dailyClose?(operatorId: string): Promise<PrintResult>
  openDrawer?(operatorId: string): Promise<void>
}
```

Il server fa **una sola verifica centrale** capability → 409, niente if sparsi per rotta. `DriverConfig` si estende con i campi `deviceName?` e `paper?`/`template?` flattenati da `PrinterConfig`.

### Lavoro per driver

| Driver | Stato | Da fare |
|---|---|---|
| `epson-fpmate` | esistente | `printNonFiscal` via blocco XML nativo (`beginNonFiscal`/`printNormal`/`endNonFiscal`) |
| `ditron-wec`, `ditron-streamwec` | esistenti | `printNonFiscal` via comandi WEC testo libero; verificare sui pcap in repo (`DITRON.pcapng`, `capture.pcapng`), poi test dal vivo |
| `escpos-network` | stub | implementazione completa: testo stilizzato (ESC ! / GS !), taglio (GS V), `printLabel` via raster (GS v 0); larghezza 58/80mm da `paper.widthMm` |
| `os-printer` | nuovo | `printLabel` e `printNonFiscal` via BrowserWindow nascosta + `webContents.print({ silent: true, deviceName, pageSize, margins, landscape })`; `getStatus` = presenza della stampante nell'elenco di sistema |

### Rendering: un template, due uscite

Modulo `src/main/printing/label-renderer.ts`: prende `LabelData` + `LabelLayout` e produce **HTML autocontenuto** (misure in mm, barcode come SVG generato internamente, nessuna dipendenza esterna a runtime).

- **`os-printer`**: HTML → BrowserWindow nascosta → stampa silenziosa.
- **`escpos-network`**: stesso HTML → capture offscreen a 203dpi → bitmap monocromatica (soglia) → comando raster ESC/POS.

Stessa resa visiva ovunque, un solo posto da modificare per cambiare il layout. Il preset iniziale è `product-price` (nome, variante, prezzo, SKU, barcode EAN/Code128 con testo); altri preset si aggiungono come funzioni pure nello stesso modulo.

Il documento non fiscale invece NON passa dal renderer HTML sui driver ESC/POS e fiscali: lì si traduce direttamente in comandi testo nativi (più nitido e veloce su carta termica a rotolo). Solo `os-printer` lo renderizza come HTML.

## Probing carta per-OS

Modulo `src/main/printing/paper-info.ts`, unica superficie per-piattaforma del progetto:

```typescript
getSystemPrinters(): Promise<SystemPrinter[]>            // Electron getPrintersAsync, cross-platform
getPaperInfo(deviceName: string): Promise<PaperInfo>     // formati disponibili + default
```

- **Windows**: PowerShell `Get-PrintConfiguration` / `Get-Printer`.
- **macOS / Linux**: CUPS `lpoptions -p <printer> -l` (lista completa formati dal PPD) e `lpstat`.
- Usato **solo in fase di configurazione** per precompilare il form; mai a runtime di stampa.
- Se il probing fallisce (driver opaco), il form parte vuoto e si compila a mano: il probing è un aiuto, mai un requisito.

## UI di configurazione (renderer)

- **Wizard "Aggiungi stampante"**: ruolo → driver → connessione. Per `os-printer`, menu a tendina con le stampanti di sistema (nuovo IPC `printers:system`); alla selezione, `paper-info` precompila formato/orientamento/margini, tutti modificabili.
- **Pannello template etichetta**: preset, toggle campi (variante, SKU, barcode), scala font, **anteprima dal vivo** renderizzata dallo stesso `label-renderer` usato in stampa (iframe sandbox).
- **Prova di stampa** per ogni stampante: etichetta/documento di test con dati finti, via IPC `driver:test` esteso.
- Componenti esistenti (`PrinterCard`, `DriverPicker`, `ConnectionForm`, `EventLog`) si estendono, non si riscrivono.

### Nuovi IPC

| Canale | Direzione | Scopo |
|---|---|---|
| `printers:system` | invoke | elenco stampanti di sistema |
| `printers:paper-info` | invoke | formati carta per una stampante di sistema |
| `driver:test` | esteso | accetta tipo di test (status / etichetta / non fiscale) |

## Gestione errori

- Capability mancante → 409 con messaggio esplicito (`"La stampante 'fiscale' non supporta la stampa etichette"`).
- Stampante di sistema scomparsa (`deviceName` non più nell'elenco) → `getStatus` offline + errore chiaro in stampa, mai dialogo.
- Probing carta fallito → form manuale, log a livello `warn`.
- Timeout TCP ESC/POS → riusa il pattern timeout già presente nello stub.

## Testing

Unit (vitest, pattern esistente `*.test.ts` accanto al sorgente):

- `label-renderer`: snapshot HTML per preset/varianti di campi mancanti; correttezza checksum EAN-13.
- Encoder ESC/POS: byte esatti per stili, taglio, header raster.
- `config.ts`: migrazione `role` su config esistenti + percorso legacy.
- `server.ts`: nuovi endpoint con driver mock, validazione capabilities (409), `copies`, 404/503.

Hardware (manuale): non fiscale su Ditron (confronto con pcap), prova etichetta su etichettatrice via driver OS su Win e Mac, raster su ESC/POS 80mm.

## Fuori scope (esplicitamente)

- Editor visuale drag-and-drop del template (i preset bastano; si valuta dopo l'uso reale).
- Driver protocollo nativo ZPL/TSPL (coperti da `os-printer`; si aggiungono solo se emergono limiti).
- USB raw (coperto dai driver di sistema).
- Stampa etichette dalla fiscale (nessun caso d'uso).
