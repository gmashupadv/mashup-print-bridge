# Mashup Print Bridge - Design Document

## 1. Cos'è

Un'applicazione desktop leggera (Electron) che gira in background sul PC cassa. Espone un server HTTP locale su `localhost:8765` verso cui il browser Mashup POS invia le richieste di stampa. Il bridge traduce queste richieste nel protocollo nativo della stampante fiscale installata.

---

## 2. Architettura

```
┌─────────────────────────────────────────────────────┐
│  PC Cassa                                           │
│                                                     │
│  Browser (Mashup POS)                               │
│       │                                             │
│       │ HTTP JSON → localhost:8765                  │
│       ▼                                             │
│  ┌──────────────────────────────────────────────┐   │
│  │         Mashup Print Bridge (Electron)       │   │
│  │                                              │   │
│  │  Main Process (Node.js)                      │   │
│  │  ┌────────────┐  ┌─────────────────────────┐ │   │
│  │  │ HTTP Server│  │    Driver Registry      │ │   │
│  │  │ :8765      │→ │  ┌────────┐ ┌────────┐  │ │   │
│  │  └────────────┘  │  │ Epson  │ │Ditron  │  │ │   │
│  │                  │  │FpMate  │ │WEC TCP │  │ │   │
│  │  Renderer        │  └────────┘ └────────┘  │ │   │
│  │  ┌────────────┐  │  ┌────────┐ ┌────────┐  │ │   │
│  │  │ Tray + UI  │  │  │Serial  │ │Custom  │  │ │   │
│  │  │ React      │  │  │ESC/POS │ │REST    │  │ │   │
│  │  └────────────┘  │  └────────┘ └────────┘  │ │   │
│  │                  └─────────────────────────┘ │   │
│  └──────────────────────────────────────────────┘   │
│       │              │              │               │
│    HTTP POST      TCP:12345      RS-232/USB          │
│       ▼              ▼              ▼               │
│   Epson RT       Ditron IT      Olivetti/RCH         │
└─────────────────────────────────────────────────────┘
```

---

## 3. Stack tecnico

| Layer | Tecnologia |
|---|---|
| Shell applicazione | **Electron 31+** |
| Main process | **Node.js 20 / TypeScript** |
| HTTP server interno | **Fastify** (leggero, veloce) |
| Porta seriale | **serialport** npm package |
| Driver Epson | HTTP + XML (fetch nativo) |
| Driver Ditron | `net.Socket` Node.js raw TCP |
| UI config | **React + Tailwind** |
| Auto-update | **electron-updater** + GitHub Releases |
| Build/distribuzione | **electron-builder** |
| Config persistente | JSON file in `userData` |

---

## 4. API REST - localhost:8765

### `GET /ping`
Bridge online e configurato.
```json
{ "ok": true, "version": "1.2.0", "driver": "ditron-wec", "printer": "192.168.1.50:12345" }
```

### `GET /status`
Stato della stampante.
```json
{ "online": true, "paperPresent": true, "coverClosed": true, "errorMessage": "" }
```

### `POST /print`
Stampa documento commerciale.
```json
{
  "items": [
    { "description": "Maglia M", "quantity": 2, "unitPrice": 25.00, "vatRate": 22 }
  ],
  "discount": 0,
  "payments": [
    { "description": "Carta", "amount": 50.00, "paymentType": 2 }
  ]
}
```
Response:
```json
{ "success": true, "receiptNumber": "0042", "closureNumber": "005", "printerSerial": "99MEX123456" }
```

### `POST /daily-close`
Chiusura Z.
```json
{ "operatorId": "1" }
```

### `POST /open-drawer`
Apri cassetto.

### `GET /config`
Leggi config corrente.

### `PUT /config`
Salva config.
```json
{
  "driver": "ditron-wec",
  "connection": {
    "ip": "192.168.1.50",
    "port": 12345
  },
  "operatorId": "1",
  "deptMapping": { "22.00": 1, "10.00": 2, "4.00": 3, "0.00": 4 }
}
```

---

## 5. Driver Interface

Ogni driver implementa questa interfaccia TypeScript:

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

### Driver previsti - MVP

| Driver | Protocollo | Stampanti |
|---|---|---|
| `epson-fpmate` | HTTP POST XML | Epson FP-90III RT, FP-81II RT, TM-T88VI |
| `ditron-wec` | TCP raw port 12345/1470 | Ditron I-T, Quadra, I-Deal |
| `ditron-streamwec` | HTTPS REST port 1471 | Ditron IT-ONE, modelli recenti |

### Driver futuri - post-MVP

| Driver | Protocollo | Stampanti |
|---|---|---|
| `serial-escpos` | RS-232 / USB-Serial (XON/XOFF) | Custom, RCH, Olivetti, Sarema |
| `custom-rest` | HTTP custom configurabile | Qualsiasi stampante con webserver |

---

## 6. Configurazione

File JSON in `app.getPath('userData')/config.json`:

```json
{
  "driver": "ditron-wec",
  "autostart": true,
  "port": 8765,
  "logLevel": "info",
  "connection": {
    "ip": "192.168.1.50",
    "port": 12345,
    "timeout": 10000
  },
  "operatorId": "1",
  "deptMapping": {
    "22.00": 1,
    "10.00": 2,
    "5.00": 3,
    "4.00": 4,
    "0.00": 5
  }
}
```

---

## 7. Auto-update

Usa `electron-updater` con GitHub Releases come server degli aggiornamenti.

Flusso:
1. All'avvio il bridge controlla la versione disponibile su GitHub
2. Se c'è aggiornamento → download in background
3. Notifica nell'icona tray: "Aggiornamento pronto"
4. L'utente conferma (o si applica automatico alla prossima chiusura)
5. Electron si riavvia con la nuova versione

`electron-builder.yml`:
```yaml
publish:
  provider: github
  owner: gmashupadv
  repo: mashup-print-bridge
```

Main process:
```typescript
import { autoUpdater } from 'electron-updater';
autoUpdater.checkForUpdatesAndNotify();
```

---

## 8. Distribuzione

### Output build (electron-builder)

| Platform | Formato | Cosa installa |
|---|---|---|
| Windows | `.exe` NSIS installer | App + autostart in registry |
| macOS | `.dmg` | App.app in /Applications + LaunchAgent |
| Linux | `.AppImage` / `.deb` | AppImage autocontenuto o pacchetto .deb |

### Autostart
- **Windows**: chiave `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- **macOS**: `LaunchAgent` plist in `~/Library/LaunchAgents/`
- **Linux**: `~/.config/autostart/mashup-print-bridge.desktop`

Electron gestisce tutto con `app.setLoginItemSettings()`.

---

## 9. UI (Tray + Config Window)

**Tray icon**: indicatore verde/rosso dello stato.

Menu tray:
```
● Bridge attivo (v1.2.0)
  Stampante: Ditron 192.168.1.50 ✓
  ─────────────────────
  Apri configurazione...
  Test di stampa
  ─────────────────────
  Aggiornamento disponibile (1.3.0)
  ─────────────────────
  Esci
```

**Config window**: piccola finestra React (400×500px) con:
- Scelta driver (dropdown)
- IP / porta / COM / parametri driver
- Test connessione
- Mapping reparti IVA
- Log ultimi eventi

---

## 10. Struttura progetto

```
mashup-print-bridge/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # Entry point, tray, lifecycle
│   │   ├── server.ts          # Fastify HTTP server :8765
│   │   ├── updater.ts         # electron-updater wrapper
│   │   ├── config.ts          # Lettura/scrittura config.json
│   │   └── drivers/
│   │       ├── interface.ts   # PrinterDriver interface
│   │       ├── epson-fpmate.ts
│   │       ├── ditron-wec.ts
│   │       └── ditron-streamwec.ts
│   └── renderer/              # React config UI
│       ├── App.tsx
│       └── components/
├── package.json
├── electron-builder.yml
└── tsconfig.json
```

---

## 11. Integrazione con Mashup Cashflow (frontend)

Sostituire `EpsonFiscalClient` con `PrintBridgeClient` con fallback retrocompatibile:

```typescript
// src/shared/lib/printBridgeClient.ts
export class PrintBridgeClient {
  private readonly base = 'http://localhost:8765';

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/ping`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  }

  async printReceipt(data: FiscalReceiptData): Promise<PrintResult> {
    const r = await fetch(`${this.base}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return r.json();
  }

  async dailyClose(operatorId = '1'): Promise<PrintResult> {
    const r = await fetch(`${this.base}/daily-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    });
    return r.json();
  }

  async openDrawer(operatorId = '1'): Promise<void> {
    await fetch(`${this.base}/open-drawer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    });
  }

  async getStatus(): Promise<PrinterStatus> {
    const r = await fetch(`${this.base}/status`);
    return r.json();
  }
}
```

Il POS al checkout fa prima `isAvailable()`: se il bridge è assente cade in fallback
sul vecchio `EpsonFiscalClient` diretto (retrocompatibilità completa).

---

## 12. MVP - Scope e tempi stimati

| Task | Tempo stimato |
|---|---|
| Boilerplate Electron + Fastify + tray | 0.5 gg |
| Driver `epson-fpmate` (port da codice esistente) | 0.5 gg |
| Driver `ditron-wec` (TCP raw) | 1 gg |
| Config window React base | 1 gg |
| Auto-update + CI build (GitHub Actions) | 1 gg |
| Test su hardware reale + fix | 1-2 gg |
| **Totale MVP** | **~1 settimana** |

---

## 13. Note di sicurezza

- Il server Fastify ascolta **solo su `127.0.0.1`** (non su `0.0.0.0`) - non raggiungibile da altri dispositivi in rete
- Nessun token di autenticazione necessario (loopback only)
- Le credenziali stampante (se presenti) restano nel `config.json` locale, mai trasmesse al backend cloud
