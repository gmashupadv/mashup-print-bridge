import Fastify, { type FastifyInstance } from 'fastify'
import type { PrinterDriver, Capability } from './drivers/interface'
import type { PrinterConfig } from './config'

export interface ManagedPrinter {
  config: PrinterConfig
  driver: PrinterDriver
}

export interface ServerOptions {
  getPrinters: () => ManagedPrinter[]
  version: string
}

function resolvePrinter(printers: ManagedPrinter[], id?: string): ManagedPrinter | null {
  if (id) return printers.find((p) => p.config.id === id) ?? null
  return printers[0] ?? null
}

function capabilityError(printer: ManagedPrinter, cap: Capability): string {
  return `La stampante '${printer.config.id}' non supporta l'operazione '${cap}'`
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

  app.post<{ Body: { items: any[]; discount: number; payments: any[]; printerId?: string } }>(
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
