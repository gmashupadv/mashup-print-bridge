import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify'
import type {
  PrinterDriver,
  Capability,
  NonFiscalLine,
  LabelData,
  PrintResult,
  ReceiptItem,
  ReceiptPayment,
} from './drivers/interface'
import type { PrinterConfig } from './config'
import { DEFAULT_LABEL_PAPER, DEFAULT_LABEL_TEMPLATE } from './printing/defaults'
import { normalizeEan13 } from './printing/barcode'

export interface ManagedPrinter {
  config: PrinterConfig
  driver: PrinterDriver
}

export interface ServerOptions {
  getPrinters: () => ManagedPrinter[]
  version: string
}

function capabilityError(printer: ManagedPrinter, cap: Capability): string {
  return `La stampante '${printer.config.id}' non supporta l'operazione '${cap}'`
}

// CORS + Private Network Access. Il POS gira su origin pubblico HTTPS
// (es. https://cashflow.mashupadv.it) e chiama il bridge in loopback: il browser
// pretende sia gli header CORS sia, per la PNA, Access-Control-Allow-Private-Network.
// Nessun cookie/credenziale in gioco → riflettiamo l'origin (con Vary) senza allowlist.
function applyCorsHeaders(req: FastifyRequest, reply: FastifyReply): void {
  const origin = req.headers.origin
  reply.header('Access-Control-Allow-Origin', origin ?? '*')
  reply.header('Vary', 'Origin')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  reply.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.headers['access-control-request-private-network']) {
    reply.header('Access-Control-Allow-Private-Network', 'true')
  }
}

export function resolveByCapability(
  printers: ManagedPrinter[],
  cap: Capability,
  id?: string
): { printer: ManagedPrinter } | { status: number; error: string } {
  if (id) {
    const p = printers.find((x) => x.config.id === id)
    if (!p) return { status: 404, error: `Printer not found: ${id}` }
    if (!p.driver.capabilities.includes(cap)) return { status: 409, error: capabilityError(p, cap) }
    return { printer: p }
  }
  const p = printers.find((x) => x.driver.capabilities.includes(cap))
  if (!p) return { status: 503, error: `Nessuna stampante con capability '${cap}' configurata` }
  return { printer: p }
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  const { getPrinters, version } = opts

  // Header CORS/PNA su ogni risposta delle route reali (GET/POST).
  app.addHook('onRequest', async (req, reply) => {
    applyCorsHeaders(req, reply)
  })

  // Preflight: le POST con Content-Type application/json sono "non-simple" → OPTIONS.
  // Route wildcard esplicita così la preflight matcha sempre (niente 404) e chiude a 204.
  app.options('/*', async (req, reply) => {
    applyCorsHeaders(req, reply)
    reply.code(204).send()
  })

  app.get('/ping', async () => {
    const printers = getPrinters()
    return {
      ok: true,
      version,
      driver: printers[0]?.driver.name ?? '',
      printers: printers.map((p) => ({ id: p.config.id, driver: p.driver.name })),
    }
  })

  app.get('/status', async (_req, reply) => {
    // /status is the health-check used by legacy POS clients that expect THE fiscal printer.
    // Fallback to printers[0] keeps the endpoint useful in non-fiscal installations.
    const printers = getPrinters()
    const printer = printers.find((p) => p.driver.capabilities.includes('fiscal-receipt')) ?? printers[0] ?? null
    if (!printer) {
      reply.status(503)
      return { error: 'No printers configured' }
    }
    try {
      return await printer.driver.getStatus()
    } catch (err: unknown) {
      reply.status(500)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.get('/printers', async () => {
    const printers = getPrinters()
    const results = await Promise.allSettled(
      printers.map((p) => p.driver.getStatus())
    )
    return printers.map((p, i) => {
      const settled = results[i]
      return {
        id: p.config.id,
        label: p.config.label,
        role: p.config.role,
        capabilities: p.driver.capabilities,
        driver: p.driver.name,
        ip: p.config.connection.ip,
        status: settled.status === 'fulfilled' ? settled.value : { online: false, errorMessage: settled.reason?.message ?? 'Error' },
      }
    })
  })

  // Incoming items may omit `department` (resolved via deptMapping or defaulted to 1 below)
  type IncomingReceiptItem = Omit<ReceiptItem, 'department'> & { department?: number }

  app.post<{
    Body: { items: IncomingReceiptItem[]; discount: number; payments: ReceiptPayment[]; printerId?: string }
  }>(
    '/print',
    async (req, reply) => {
      const resolved = resolveByCapability(getPrinters(), 'fiscal-receipt', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      const printer = resolved.printer
      try {
        const mapping = printer.config.deptMapping
        const items = req.body.items.map((item) => ({
          ...item,
          department: mapping[Number(item.vatRate).toFixed(2)] ?? item.department ?? 1,
        }))
        return await printer.driver.printReceipt!({
          items,
          discount: req.body.discount,
          payments: req.body.payments,
        })
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )

  app.post<{ Body: { lines: NonFiscalLine[]; cut?: boolean; printerId?: string } }>(
    '/print-nonfiscal',
    async (req, reply) => {
      const resolved = resolveByCapability(getPrinters(), 'non-fiscal', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      try {
        return await resolved.printer.driver.printNonFiscal!({
          lines: req.body.lines ?? [],
          cut: req.body.cut ?? false,
        })
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )

  app.post<{ Body: { label: LabelData; copies?: number; printerId?: string } }>(
    '/print-label',
    async (req, reply) => {
      const { label } = req.body
      if (!label || typeof label.name !== 'string' || !Number.isFinite(label.price)) {
        reply.status(400)
        return { success: false, error: 'label.name (string) e label.price (number) sono obbligatori' }
      }

      if (label.barcode !== undefined) {
        try {
          normalizeEan13(String(label.barcode))
        } catch (err: unknown) {
          reply.status(400)
          return { success: false, error: err instanceof Error ? err.message : 'Barcode non valido' }
        }
      }

      // Validate copies: if provided must be a finite number >= 1
      const rawCopies = req.body.copies
      if (rawCopies !== undefined && rawCopies !== null) {
        if (!Number.isFinite(rawCopies) || Math.trunc(rawCopies as number) < 1) {
          reply.status(400)
          return { success: false, error: 'copies deve essere un numero ≥ 1' }
        }
      }
      const copies = Math.min(50, Math.trunc((rawCopies as number) ?? 1))

      const resolved = resolveByCapability(getPrinters(), 'label', req.body.printerId)
      if ('error' in resolved) {
        reply.status(resolved.status)
        return { success: false, error: resolved.error }
      }
      const pc = resolved.printer.config
      const layout = {
        paper: { ...DEFAULT_LABEL_PAPER, ...pc.paper },
        template: { ...DEFAULT_LABEL_TEMPLATE, ...pc.template },
      }
      let copiesPrinted = 0
      try {
        let last: PrintResult | null = null
        for (let i = 0; i < copies; i++) {
          last = await resolved.printer.driver.printLabel!(label, layout)
          if (!last.success) break
          copiesPrinted++
        }
        return { ...last, copiesRequested: rawCopies ?? 1, copiesPrinted }
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error', copiesPrinted }
      }
    }
  )

  app.post<{ Body: { operatorId?: string; printerId?: string } }>('/daily-close', async (req, reply) => {
    const resolved = resolveByCapability(getPrinters(), 'daily-close', req.body.printerId)
    if ('error' in resolved) {
      reply.status(resolved.status)
      return { success: false, error: resolved.error }
    }
    const printer = resolved.printer
    try {
      const operatorId = req.body.operatorId ?? printer.config.operatorId ?? '1'
      return await printer.driver.dailyClose!(operatorId)
    } catch (err: unknown) {
      reply.status(500)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.post<{ Body: { operatorId?: string; printerId?: string } }>('/open-drawer', async (req, reply) => {
    const resolved = resolveByCapability(getPrinters(), 'drawer', req.body.printerId)
    if ('error' in resolved) {
      reply.status(resolved.status)
      return { success: false, error: resolved.error }
    }
    const printer = resolved.printer
    try {
      await printer.driver.openDrawer!(req.body.operatorId ?? printer.config.operatorId ?? '1')
      reply.status(204)
      return
    } catch (err: unknown) {
      reply.status(500)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  return app
}

export async function startServer(
  opts: ServerOptions & { port: number }
): Promise<FastifyInstance> {
  const app = buildServer(opts)
  await app.listen({ host: '127.0.0.1', port: opts.port })
  return app
}
