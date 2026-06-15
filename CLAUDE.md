# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Mashup Print Bridge** is a lightweight Electron desktop app that runs as a background tray process on a POS machine. It exposes a local HTTP server on `localhost:8765` (bound to `127.0.0.1` only) that receives print requests from the Mashup POS browser frontend and translates them into the native protocol of one or more connected fiscal printers.

Docs and UI strings are in Italian; code identifiers are in English.

## Commands

```bash
npm install            # install dependencies
npm run dev            # electron-vite dev (hot reload main + renderer)
npm run build          # electron-vite build → out/
npm run lint           # eslint, --max-warnings 0 (must be clean)
npm test               # vitest run (one-shot)
npm run test:watch     # vitest watch mode
npm run dist:win       # build + electron-builder --win (NSIS .exe)
npm run dist:mac       # build + electron-builder --mac (.dmg)
npm run dist:linux     # build + electron-builder --linux (.AppImage/.deb)
```

Run a single test file or pattern:
```bash
npx vitest run src/main/config.test.ts
npx vitest run -t "migrates old config"
```

Build is **electron-vite** (config in `electron.vite.config.ts`), not raw `tsc`. There are three tsconfigs: `tsconfig.node.json` (main/preload), `tsconfig.web.json` (renderer), and the root `tsconfig.json` referencing them.

Config file at runtime: `app.getPath('userData')/config.json`.

## Architecture

Three Electron layers, each compiled by electron-vite into `out/`:

- **`src/main/`** — Node.js main process. Entry `index.ts` owns app lifecycle: tray menu, the config window, the Fastify server, the updater, and a `Map<printerId, PrinterDriver>` of live driver instances. It wires config → drivers → server.
  - **`printing/`** — shared rendering/encoding helpers used by drivers:
    - `defaults.ts` — default label paper (50×30 mm), default template, sample label for previews
    - `barcode.ts` — pure-SVG barcode rendering with auto-detection (`barcodeSvg`): 12/13 numeric digits → EAN-13, anything else → Code128 (subset B, alphanumeric SKUs); `assertPrintableBarcode` is the permissive server-side validator
    - `label-renderer.ts` — `LabelData + LabelLayout` → self-contained HTML (also non-fiscal docs → HTML)
    - `escpos-encoder.ts` — ESC/POS byte encoding: CP858 text, formatted non-fiscal lines, raster bitmaps
    - `html-to-bitmap.ts` — renders HTML to a monochrome bitmap via an offscreen BrowserWindow (for ESC/POS raster)
    - `silent-print.ts` — silent printing of HTML through the OS driver (hidden BrowserWindow, **no print dialog**) + `listSystemPrinters()`
    - `paper-info.ts` — per-OS probing of paper sizes for a system printer (`lpoptions` on macOS/Linux, PowerShell on Windows)
- **`src/preload/index.ts`** — exposes a typed `window.bridge` API to the renderer over `contextBridge` (`getConfig`, `saveConfig`, `testDriver(printerId?, kind?)` with test prints, `listDrivers`, `listSystemPrinters`, `getPaperInfo`, `previewLabel`, plus `onLogEvent`/`onUpdateAvailable` subscriptions).
- **`src/renderer/`** — React + Tailwind config UI (single window). Talks to main **only via `window.bridge` IPC**, never via the HTTP server.

### Two separate interfaces — don't confuse them

1. **HTTP server (`server.ts`, port 8765)** — consumed by the external POS browser. Print/status operations only.
2. **IPC (`preload` ↔ `ipcMain` handlers in `index.ts`)** — consumed by the local React config UI. Config read/write and driver testing.

Config is **not** exposed over HTTP. There are no `GET/PUT /config` HTTP routes; config goes through IPC (`config:get` / `config:save`).

## Driver layer

Drivers live in `src/main/drivers/` and implement `PrinterDriver` (`interface.ts`):

```typescript
interface PrinterDriver {
  readonly name: string
  readonly capabilities: Capability[]   // 'fiscal-receipt' | 'non-fiscal' | 'label' | 'daily-close' | 'drawer' | 'cut'
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  // Optional methods: present only when the matching capability is declared
  printReceipt?(data: ReceiptData): Promise<PrintResult>
  printNonFiscal?(doc: NonFiscalDoc): Promise<PrintResult>
  printLabel?(label: LabelData, layout: LabelLayout): Promise<PrintResult>
  dailyClose?(operatorId: string): Promise<PrintResult>
  openDrawer?(operatorId: string): Promise<void>
}
```

A driver's `capabilities` array is the contract: the server routes requests only to printers whose driver declares the needed capability, and the optional methods (`printReceipt`/`printNonFiscal`/`printLabel`/`dailyClose`/`openDrawer`) must be implemented iff the matching capability is declared.

`registry.ts` is the single source of truth for available drivers — a name→factory map. **To add a driver: implement the interface, then register it in `registry.ts`.** `listDrivers()` (surfaced to the UI via IPC) and `createDriver(name)` both read from this map.

Registered drivers:
- `epson-fpmate` — HTTP POST XML to Epson RT printers; fiscal + non-fiscal (`fiscal-receipt`, `non-fiscal`, `daily-close`, `drawer`)
- `ditron-wec` — raw TCP for Ditron; **stub** (throws "not implemented — pending Wireshark capture")
- `ditron-streamwec` — HTTP/1.0 POST `/cmd/wec` (port 80) with plain-text WEC commands; fiscal + non-fiscal. Receipt syntax confirmed from a capture of the Danea gestionale: `CLEAR` / `CHIAVE REG` / `VEND REP=,PREZZO=,DES='…'` / `SUBT` / `CHIUS T=<tender>` / `wecfine`; success response is one `OK.` line per command. `DES=` gives the descriptive ("parlante") receipt — **preferred over `ditron-keycode` because it prints the article name**. Tender codes are printer-programmed (this unit: cash=1, card=5)
- `ditron-keycode` — HTTPS POST `/cmd/keycode` emulating the physical keypad (same protocol as Ditron's own FCR Manager web UI); status via GET `/cmd/display` (`fiscal-receipt`, `daily-close`, `drawer`)
- `escpos-network` — raw TCP port 9100 ESC/POS, complete: non-fiscal + label (rendered HTML → raster bitmap) + cut (`non-fiscal`, `label`, `cut`)
- `zpl-network` — raw TCP port 9100 ZPL for Zebra-emulation label printers (Printex G300, Godex, TSC, Zebra); native barcodes (`^BE` EAN-13, `^BC` Code128) generated by `printing/zpl.ts`, no raster (`label`)
- `os-printer` — prints via the OS printer driver (`connection.deviceName`), silent, no dialog; label + non-fiscal (`label`, `non-fiscal`)

`DriverConfig` is a flattened per-printer shape (`ip`, `port`, `timeout`, `operatorId`, `deptMapping`, plus optional `deviceName`, `paper`, `template`) built in `index.ts:driverConfigFrom()` from a `PrinterConfig`.

## Multi-printer model

Config holds a `printers[]` array; each printer has an `id` and a `role` (`fiscal` | `label` | `receipt`). The server resolves the target printer per request via `resolveByCapability` in `server.ts`:

- explicit `printerId` in the body → that printer, or **404** if the id doesn't exist, **409** if it exists but lacks the needed capability;
- `printerId` omitted → the **first printer whose driver declares the capability**, or **503** if none does.

`GET /status` is the exception (legacy health check): it targets the first **fiscal** printer (`fiscal-receipt` capability), falling back to `printers[0]`. `index.ts:buildManagedPrinters()` joins config entries with their live driver instances and hands the list to the server via `getPrinters()`.

## REST API (localhost:8765)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Health check: version + active driver + printer list |
| GET | `/status` | Status of the first fiscal printer (fallback `printers[0]`) |
| GET | `/printers` | All configured printers with `role`, `capabilities` and live status (settled in parallel) |
| POST | `/print` | Print fiscal receipt; body `{ items, discount, payments, printerId? }` |
| POST | `/print-nonfiscal` | Non-fiscal document; body `{ lines: [{ text, bold?, size?, align? }], cut?, printerId? }` |
| POST | `/print-label` | Product label; body `{ label: { name, price, variant?, sku?, barcode? }, copies?, printerId? }` |
| POST | `/daily-close` | Z closure; body `{ operatorId?, printerId? }` |
| POST | `/open-drawer` | Cash drawer open; body `{ operatorId?, printerId? }`; 204 on success |

Printer resolution for every print route follows the capability rule above (explicit `printerId` → 404/409; omitted → first printer with the capability → 503 if none).

`/print` remaps each item's `department` via the target printer's `deptMapping` keyed by `vatRate.toFixed(2)`.

`/print-label`: `label.name` (string) and `label.price` (number) are mandatory → **400** otherwise. `copies` is clamped to 1–50; the response includes `copiesRequested` and `copiesPrinted` (partial failures return `success: false` with the copies actually printed). The label layout merges the printer's `paper`/`template` config over `DEFAULT_LABEL_PAPER`/`DEFAULT_LABEL_TEMPLATE`.

`/print-nonfiscal` line options: `bold` (boolean), `size` (`normal` | `double`), `align` (`left` | `center` | `right`); `cut` requests a paper cut where supported.

## Config schema

```json
{
  "printers": [
    {
      "id": "fiscal",
      "label": "Stampante fiscale",
      "role": "fiscal",
      "driver": "epson-fpmate",
      "connection": { "ip": "192.168.1.10", "port": 80, "timeout": 10000 },
      "operatorId": "1",
      "deptMapping": { "22.00": 1, "10.00": 2, "5.00": 3, "4.00": 4, "0.00": 5 }
    },
    {
      "id": "labels",
      "label": "Etichettatrice",
      "role": "label",
      "driver": "os-printer",
      "connection": { "ip": "", "port": 0, "timeout": 10000, "deviceName": "Brother_QL_820NWB" },
      "operatorId": "1",
      "deptMapping": {},
      "paper": { "widthMm": 50, "heightMm": 30, "orientation": "portrait", "marginsMm": { "top": 1, "right": 2, "bottom": 1, "left": 2 } },
      "template": { "preset": "product-price", "showBarcode": true, "fontScale": 1 }
    }
  ],
  "autostart": true,
  "port": 8765,
  "logLevel": "info"
}
```

Per-printer fields: `role` (`fiscal` | `label` | `receipt`, used by the UI; routing uses driver capabilities), `connection.deviceName` (OS printer name, required by `os-printer`), optional `paper` and `template` (label layout overrides; defaults in `printing/defaults.ts`).

`deptMapping` maps VAT-rate strings to printer-specific fiscal department numbers. `config.ts:migrate()` upgrades the **legacy single-printer format** (top-level `driver`/`connection`/`operatorId`/`deptMapping`, no `printers`) into the array form — preserve that migration path when touching config.

## Security constraint

The Fastify server **must** bind to `127.0.0.1` only — never `0.0.0.0` (see `startServer` in `server.ts`). No auth token is needed since it's loopback-only. Printer credentials stay in the local `config.json` and are never sent to cloud backends.

The POS frontend runs on a public HTTPS origin and calls the bridge in loopback, so the server sends **CORS + Private Network Access** headers (`applyCorsHeaders` in `server.ts`): origin is reflected (no credentials, so no allowlist), preflight `OPTIONS` is handled by a wildcard route returning 204, and `Access-Control-Allow-Private-Network: true` is granted when Chrome's PNA preflight asks for it.

## Distribution

`electron-builder` (config in `electron-builder.yml`). GitHub Releases is the auto-update server (`owner: gmashupadv`, `repo: mashup-print-bridge`) via `updater.ts`. Autostart uses `app.setLoginItemSettings()`.

## Integration with Mashup Cashflow (POS frontend)

The POS uses `PrintBridgeClient` (`src/shared/lib/printBridgeClient.ts` in the POS repo) which calls `isAvailable()` first; if the bridge is unreachable it falls back to the legacy `EpsonFiscalClient`. Keep the HTTP contract stable.

## Notes

- `*.pcapng` / `ditron.html` at the repo root are packet captures / protocol reverse-engineering scratch for the Ditron drivers — not part of the build.
- Tests use vitest; coverage spans `config`, `server`, the drivers (`epson-fpmate`, `ditron-streamwec`, `ditron-keycode`, `escpos-network`, `zpl-network`, `os-printer`) and the `printing/` helpers (`barcode`, `label-renderer`, `escpos-encoder`, `paper-info`).
