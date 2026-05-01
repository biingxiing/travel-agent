import { Hono } from 'hono'
import { promises as fs } from 'fs'
import path from 'path'
import { authMiddleware } from '../auth/middleware.js'

export const devTracesRouter = new Hono()

devTracesRouter.use('*', authMiddleware)

devTracesRouter.get('/:runId', async (c) => {
  const runId = c.req.param('runId').replace(/[^\w-]/g, '')
  if (!runId) return c.json({ error: 'invalid runId' }, 400)
  const file = path.join(process.cwd(), '.traces', `${runId}.jsonl`)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return c.json({ error: 'not found' }, 404)
  }
  const events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const html = `<!doctype html><html><head><title>trace ${runId}</title>
<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:1em;background:#0b0b0c;color:#e6e6e6}
.row{padding:2px 8px;border-left:3px solid #444;margin:1px 0}
.orchestrator{border-color:#7f7fff}.researcher{border-color:#7fff7f}
.event{color:#aaa}.ts{color:#666}</style></head><body>
<h1>Trace ${runId} (${events.length} events)</h1>
${events.map((e: { ts: string; agent: string; event: string }) =>
  `<div class="row ${e.agent.split('#')[0]}"><span class="ts">${e.ts}</span> <b>${e.agent}</b> <span class="event">${e.event}</span> <code>${JSON.stringify(e).replace(/</g, '&lt;')}</code></div>`,
).join('\n')}
</body></html>`
  return c.html(html)
})
