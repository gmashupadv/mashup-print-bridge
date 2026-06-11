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
- **`src/preload/index.ts`** — exposes a typed `window.bridge` API to the renderer over `contextBridge` (`getConfig`, `saveConfig`, `testDriver`, `listDrivers`, plus `onLogEvent`/`onUpdateAvailable` subscriptions).
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
  connect(config: DriverConfig): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  printReceipt(data: ReceiptData): Promise<PrintResult>
  dailyClose(operatorId: string): Promise<PrintResult>
  openDrawer(operatorId: string): Promise<void>
}
```

`registry.ts` is the single source of truth for available drivers — a name→factory map. **To add a driver: implement the interface, then register it in `registry.ts`.** `listDrivers()` (surfaced to the UI via IPC) and `createDriver(name)` both read from this map.

Registered drivers:
- `epson-fpmate` — HTTP POST XML to Epson RT printers
- `ditron-wec` — raw TCP for Ditron
- `ditron-streamwec` — HTTPS REST (port 1471) for newer Ditron
- `escpos-network` — network ESC/POS

`DriverConfig` is a flattened per-printer shape (`ip`, `port`, `timeout`, `operatorId`, `deptMapping`) built in `index.ts:driverConfigFrom()` from a `PrinterConfig`.

## Multi-printer model

Config holds a `printers[]` array; each printer has an `id`. The server routes by an optional `printerId` in the request body and falls back to the **first** printer when omitted (`resolvePrinter` in `server.ts`). `index.ts:buildManagedPrinters()` joins config entries with their live driver instances and hands the list to the server via `getPrinters()`.

## REST API (localhost:8765)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Health check: version + active driver + printer list |
| GET | `/status` | Status of the default (first) printer |
| GET | `/printers` | Status of all configured printers (settled in parallel) |
| POST | `/print` | Print fiscal receipt; body `{ items, discount, payments, printerId? }` |
| POST | `/daily-close` | Z closure; body `{ operatorId?, printerId? }` |
| POST | `/open-drawer` | Cash drawer open; body `{ operatorId?, printerId? }`; 204 on success |

`/print` remaps each item's `department` via the target printer's `deptMapping` keyed by `vatRate.toFixed(2)`. Missing printer → 404 if `printerId` was given, 503 if none configured.

## Config schema

```json
{
  "printers": [
    {
      "id": "fiscal",
      "label": "Stampante fiscale",
      "driver": "epson-fpmate",
      "connection": { "ip": "192.168.1.10", "port": 80, "timeout": 10000 },
      "operatorId": "1",
      "deptMapping": { "22.00": 1, "10.00": 2, "5.00": 3, "4.00": 4, "0.00": 5 }
    }
  ],
  "autostart": true,
  "port": 8765,
  "logLevel": "info"
}
```

`deptMapping` maps VAT-rate strings to printer-specific fiscal department numbers. `config.ts:migrate()` upgrades the **legacy single-printer format** (top-level `driver`/`connection`/`operatorId`/`deptMapping`, no `printers`) into the array form — preserve that migration path when touching config.

## Security constraint

The Fastify server **must** bind to `127.0.0.1` only — never `0.0.0.0` (see `startServer` in `server.ts`). No auth token is needed since it's loopback-only. Printer credentials stay in the local `config.json` and are never sent to cloud backends.

## Distribution

`electron-builder` (config in `electron-builder.yml`). GitHub Releases is the auto-update server (`owner: gmashupadv`, `repo: mashup-print-bridge`) via `updater.ts`. Autostart uses `app.setLoginItemSettings()`.

## Integration with Mashup Cashflow (POS frontend)

The POS uses `PrintBridgeClient` (`src/shared/lib/printBridgeClient.ts` in the POS repo) which calls `isAvailable()` first; if the bridge is unreachable it falls back to the legacy `EpsonFiscalClient`. Keep the HTTP contract stable.

## Notes

- `*.pcapng` / `ditron.html` at the repo root are packet captures / protocol reverse-engineering scratch for the Ditron drivers — not part of the build.
- Tests use vitest; existing coverage is in `config.test.ts`, `server.test.ts`, `epson-fpmate.test.ts`.
