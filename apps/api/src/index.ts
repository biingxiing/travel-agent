import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { assertAuthConfig } from './auth/config.js'
import { authRouter } from './routes/auth.js'
import { sessionsRouter } from './routes/sessions.js'
import { registryRouter } from './routes/registry.js'
import { devTracesRouter } from './routes/dev-traces.js'
import { runDatabaseMigrations } from './persistence/pg.js'
import { bootstrapRegistry } from './registry/bootstrap.js'

const app = new Hono()
const configuredCorsOrigin = process.env.CORS_ORIGIN

function resolveCorsOrigin(origin?: string) {
  if (!origin) return configuredCorsOrigin ?? 'http://localhost:3000'
  if (configuredCorsOrigin && origin === configuredCorsOrigin) return origin
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin
  return configuredCorsOrigin ?? 'http://localhost:3000'
}

app.use('*', logger())
app.use('*', cors({
  origin: (origin) => resolveCorsOrigin(origin),
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

app.route('/api', authRouter)
app.route('/api/sessions', sessionsRouter)
app.route('/api/registry', registryRouter)

if (process.env.NODE_ENV !== 'production') {
  app.route('/dev/traces', devTracesRouter)
}

app.get('/health', (c) => c.json({ status: 'ok' }))

assertAuthConfig()
bootstrapRegistry()
await runDatabaseMigrations()

const port = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 API server running at http://localhost:${info.port}`)
})

export default app
