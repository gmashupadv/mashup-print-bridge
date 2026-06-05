# Mashup Print Bridge — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

---

## 1. Overview

Lightweight Electron desktop app that runs as a background tray process on a POS machine. Exposes a local HTTP server on `localhost:8765` (bound to `127.0.0.1` only) that receives print requests from the Mashup POS browser frontend and translates them into the native protocol of the connected fiscal printer.

Target platforms: **Windows** (NSIS installer) and **macOS** (DMG) from MVP. Linux AppImage included in CI but secondary.

---

## 2. Tooling & Build

- **Scaffold:** `electron-vite` template (React + TypeScript)
- **Main process:** TypeScript compiled via `tsc`
- **Renderer:** Vite with React + Tailwind CSS
- **Packaging:** `electron-builder` (GitHub Releases as update server)
- **Auto-update:** `electron-updater` reading `latest.yml` / `latest-mac.yml` from release assets

**npm scripts:**
```
dev        → electron-vite dev
build      → electron-vite build && electron-builder
dist:win   → electron-builder --win
dist:mac   → electron-builder --mac
dist:linux → electron-builder --linux
```

**Key dependencies:**
- `fastify` — HTTP server
- `fast-xml-parser` — XML parsing in Node.js (replaces browser DOMParser)
- `electron-updater` + `electron-log` — auto-update and logging
- `tailwindcss` + `@headlessui/react` — config UI

---

## 3. Project Structure

```
mashup-print-bridge/
├── electron-builder.yml
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── resources/
│   ├── icon.png          # tray icon (16, 32, 512px)
│   └── icon.ico          # Windows
├── src/
│   ├── main/
│   │   ├── index.ts      # app lifecycle, tray, IPC handlers
│   │   ├── server.ts     # Fastify on 127.0.0.1:8765
│   │   ├── config.ts     # read/write config.json in userData
│   │   ├── updater.ts    # electron-updater wrapper
│   │   └── drivers/
│   │       ├── interface.ts      # PrinterDriver interface + shared types
│   │       ├── registry.ts       # driver factory map
│   │       ├── epson-fpmate.ts   # HTTP+XML Epson RT driver
│   │       └── ditron-wec.ts     # stub (pending Wireshark capture)
│   ├── preload/
│   │   └── index.ts      # contextBridge IPC surface
│   └── renderer/
│       └── src/
│           ├── App.tsx
│           └── components/
│               ├── DriverPicker.tsx
│               ├── ConnectionForm.tsx
│               ├── DeptMapping.tsx
│               └── EventLog.tsx
└── .github/
    └── workflows/
        └── release.yml
```

---

## 4. Main Process

### index.ts
- Loads config synchronously at startup
- Instantiates active driver from registry
- Starts Fastify server
- Creates tray icon (green = printer online, red = offline/error)
- Polls `driver.getStatus()` every 30 seconds to update tray icon and tooltip
- Opens config window on "Apri configurazione..." menu item
- Adds "Aggiornamento disponibile (x.y.z)" tray menu item when update is ready (hidden otherwise)

**Tray menu:**
```
● Bridge attivo (v1.2.0)
  Stampante: Epson 192.168.1.10 ✓
  ─────────────────────
  Apri configurazione...
  Test di stampa
  ─────────────────────
  [Aggiornamento disponibile (1.3.0)]
  ─────────────────────
  Esci
```

### server.ts
- Bind to `127.0.0.1:8765` — never `0.0.0.0`
- Driver reference updatable at runtime (swapped when config is saved)
- All route errors caught and returned as `{ success: false, error: "..." }` with appropriate HTTP status — server never crashes on driver errors
- Routes: `GET /ping`, `GET /status`, `POST /print`, `POST /daily-close`, `POST /open-drawer`, `GET /config`, `PUT /config`

### config.ts
- Synchronous read at startup, async write thereafter
- `saveConfig(partial)` does a shallow merge
- Validates schema on load; if corrupted or missing, writes defaults and continues

### updater.ts
- Calls `autoUpdater.checkForUpdatesAndNotify()` 10 seconds after app ready
- On update available: sends `update:available` IPC event to renderer, adds tray menu item
- Update applies on next restart

---

## 5. Driver Layer

### interface.ts

```typescript
interface PrinterDriver {
  name: string;
  connect(config: DriverConfig): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<PrinterStatus>;
  printReceipt(data: ReceiptData): Promise<PrintResult>;
  dailyClose(operatorId: string): Promise<PrintResult>;
  openDrawer(operatorId: string): Promise<void>;
}

interface DriverConfig {
  ip: string;
  port: number;
  timeout: number;
  operatorId: string;
  deptMapping: Record<string, number>;
}

interface PrinterStatus {
  online: boolean;
  paperPresent: boolean;
  coverClosed: boolean;
  errorMessage: string;
}

interface ReceiptData {
  items: Array<{ description: string; quantity: number; unitPrice: number; department: number; vatRate: number }>;
  discount: number;
  payments: Array<{ description: string; amount: number; paymentType: number }>;
}

interface PrintResult {
  success: boolean;
  receiptNumber: string;
  closureNumber: string;
  printerSerial: string;
  errorMessage: string;
}
```

### registry.ts

```typescript
const DRIVERS: Record<string, () => PrinterDriver> = {
  'epson-fpmate': () => new EpsonFpMateDriver(),
  'ditron-wec':   () => new DitronWecDriver(),
};

export function createDriver(name: string): PrinterDriver
export function listDrivers(): string[]
```

### epson-fpmate.ts
Port of existing `EpsonFiscalClient`:
- `buildReceiptXml`, `buildDailyCloseXml`, `escapeXml`, `toCents`, `toMillis` — copied verbatim
- `parseResponse` — replaces `DOMParser` with `fast-xml-parser` (`XMLParser.parse()`)
- `printerConfig` removed from `ReceiptData` (config is global, not per-call)
- i18n dependency removed; error messages are plain English strings
- `connect(config)` stores ip/port/timeout on the instance

### ditron-wec.ts
Implements `PrinterDriver` interface. Every method throws:
```
Error('Ditron WEC driver: not implemented — pending Wireshark capture')
```
Server returns `501 Not Implemented` if this driver is active. Visible in the driver dropdown with a "⚠ Not implemented" badge.

---

## 6. Renderer (Config Window)

Window: 400×520px, non-resizable. No direct filesystem or driver access — all operations via IPC.

**IPC channels:**
```
config:get    → returns current config object
config:save   → saves partial config, main reinitializes driver
driver:test   → calls driver.getStatus(), returns PrinterStatus
driver:list   → returns string[] of available driver names
log:event     → main → renderer push, appends to EventLog
```

**UI sections:**
1. **Driver** — dropdown (from `driver:list`). Selecting `ditron-wec` shows "⚠ Not implemented" badge.
2. **Connessione** — IP, Porta, Timeout (ms). "Testa connessione" button → spinner → green/red badge.
3. **Mapping reparti IVA** — fixed rows for Italian standard VAT rates (0%, 4%, 5%, 10%, 22%), editable department number per row.
4. **Log eventi** — scrollable list, last 50 events, "Pulisci log" button.

Form fields adapt to selected driver (e.g., `ditron-wec` shows port 12345 as default).

---

## 7. CI / Release Pipeline

**`.github/workflows/release.yml`** — trigger: `push` of tag `v*.*.*`

Three parallel jobs on native runners:
- `build-win` on `windows-latest`
- `build-mac` on `macos-latest`  
- `build-linux` on `ubuntu-latest`

Each job: `npm ci` → `npm run build` → `electron-builder --[platform]` with `GH_TOKEN` for upload to GitHub Release draft.

Release is published manually after verification.

**Code signing:** unsigned for MVP. CI is pre-wired for `CSC_LINK` / `CSC_KEY_PASSWORD` secrets when certificates are acquired.

**electron-builder.yml:**
```yaml
appId: com.mashupadv.print-bridge
productName: Mashup Print Bridge
publish:
  provider: github
  owner: gmashupadv
  repo: mashup-print-bridge
win:
  target: nsis
  icon: resources/icon.ico
mac:
  target: dmg
  icon: resources/icon.png
  category: public.app-category.utilities
linux:
  target: [AppImage, deb]
  icon: resources/icon.png
```

---

## 8. Out of Scope (MVP)

- `ditron-streamwec` driver (same unknown as `ditron-wec`)
- `serial-escpos` driver (RS-232/USB)
- `custom-rest` driver
- Code signing certificates
- `PrintBridgeClient` integration in Mashup Cashflow frontend (separate repo)
