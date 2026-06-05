import Fastify, { type FastifyInstance } from 'fastify'
import type { PrinterDriver } from './drivers/interface'

interface ServerOptions {
  getDriver: () => PrinterDriver
  version: string
  getDeptMapping?: () => Record<string, number>
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  const { getDriver, version, getDeptMapping } = opts

  app.get('/ping', async () => ({
    ok: true,
    version,
    driver: getDriver().name,
  }))

  app.get('/status', async (_req, reply) => {
    try {
      return await getDriver().getStatus()
    } catch (err: unknown) {
      reply.status(500)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.post<{ Body: { items: any[]; discount: number; payments: any[] } }>(
    '/print',
    async (req, reply) => {
      try {
        const mapping = getDeptMapping?.() ?? {}
        const items = req.body.items.map((item) => ({
          ...item,
          department: mapping[Number(item.vatRate).toFixed(2)] ?? item.department ?? 1,
        }))
        return await getDriver().printReceipt({ items, discount: req.body.discount, payments: req.body.payments })
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )

  app.post<{ Body: { operatorId?: string } }>('/daily-close', async (req, reply) => {
    try {
      return await getDriver().dailyClose(req.body.operatorId ?? '1')
    } catch (err: unknown) {
      reply.status(500)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  app.post<{ Body: { operatorId?: string } }>('/open-drawer', async (req, reply) => {
    try {
      await getDriver().openDrawer(req.body.operatorId ?? '1')
      reply.status(204)
    } catch (err: unknown) {
      reply.status(500)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
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
