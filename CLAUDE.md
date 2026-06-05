# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Mashup Print Bridge** is a lightweight Electron desktop app that runs as a background tray process on a POS machine. It exposes a local HTTP server on `localhost:8765` (bound to `127.0.0.1` only) that receives print requests from the Mashup POS browser frontend and translates them into the native protocol of the connected fiscal printer.

## Commands

Once the project is scaffolded, the expected commands are:

```bash
npm install          # install dependencies
npm run dev          # start Electron in dev mode (hot reload)
npm run build        # compile TypeScript
npm run dist         # package with electron-builder
npm test             # run tests
```

Config file location at runtime: `app.getPath('userData')/config.json`

## Architecture

```
src/
├── main/                   # Electron main process (Node.js / TypeScript)
│   ├── index.ts            # Entry point: tray icon, app lifecycle, IPC
│   ├── server.ts           # Fastify HTTP server on localhost:8765
│   ├── updater.ts          # electron-updater wrapper (GitHub Releases)
│   ├── config.ts           # Read/write config.json in userData
│   └── drivers/
│       ├── interface.ts    # PrinterDriver interface (see below)
│       ├── epson-fpmate.ts # HTTP POST XML to Epson RT printers
│       ├── ditron-wec.ts   # Raw TCP on port 12345/1470 for Ditron
│       └── ditron-streamwec.ts  # HTTPS REST port 1471 for newer Ditron
└── renderer/               # React + Tailwind config UI (400×500px window)
    ├── App.tsx
    └── components/
```

**Tech stack**: Electron 31+, Node.js 20, TypeScript, Fastify (HTTP server), React + Tailwind (config UI), serialport (future serial driver), electron-updater + electron-builder.

## Driver interface

Every printer driver must implement:

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
```

MVP drivers: `epson-fpmate`, `ditron-wec`, `ditron-streamwec`.
Post-MVP: `serial-escpos` (RS-232/USB), `custom-rest`.

## REST API (localhost:8765)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Health check, returns version + active driver |
| GET | `/status` | Printer status (paper, cover, errors) |
| POST | `/print` | Print fiscal receipt (items, payments, discounts) |
| POST | `/daily-close` | Z closure |
| POST | `/open-drawer` | Cash drawer open |
| GET | `/config` | Read current config |
| PUT | `/config` | Save config |

## Config schema

```json
{
  "driver": "ditron-wec",
  "autostart": true,
  "port": 8765,
  "logLevel": "info",
  "connection": { "ip": "192.168.1.50", "port": 12345, "timeout": 10000 },
  "operatorId": "1",
  "deptMapping": { "22.00": 1, "10.00": 2, "5.00": 3, "4.00": 4, "0.00": 5 }
}
```

`deptMapping` maps VAT rate strings to fiscal department numbers (printer-specific).

## Security constraint

The Fastify server **must** bind to `127.0.0.1` only — never `0.0.0.0`. No auth token is needed since it's loopback-only. Printer credentials stay in the local `config.json` and are never sent to cloud backends.

## Distribution

Built with `electron-builder`. GitHub Releases used as the auto-update server (`owner: gmashupadv`, `repo: mashup-print-bridge`). Targets: Windows NSIS `.exe`, macOS `.dmg`, Linux `.AppImage`/`.deb`. Autostart handled via `app.setLoginItemSettings()`.

## Integration with Mashup Cashflow (POS frontend)

The POS uses `PrintBridgeClient` (`src/shared/lib/printBridgeClient.ts`) which calls `isAvailable()` first; if the bridge is unreachable it falls back to the legacy `EpsonFiscalClient` for backwards compatibility. Keep this contract stable.
