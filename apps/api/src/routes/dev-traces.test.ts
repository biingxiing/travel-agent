import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

vi.mock('../auth/middleware.js', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('userId', 'u-test'); await next() },
}))

const { devTracesRouter } = await import('./dev-traces.js')

const RUN_ID = 'run-test-dev-traces'
const TRACE_DIR = path.join(process.cwd(), '.traces')
const TRACE_FILE = path.join(TRACE_DIR, `${RUN_ID}.jsonl`)

const events = [
  { ts: '2026-05-01T00:00:00.000Z', agent: 'orchestrator', event: 'start', runId: RUN_ID },
  { ts: '2026-05-01T00:00:01.000Z', agent: 'researcher#0', event: 'tool_call', name: 'prefetch' },
]

describe('dev-traces router', () => {
  beforeEach(async () => {
    await fs.mkdir(TRACE_DIR, { recursive: true })
    await fs.writeFile(TRACE_FILE, events.map((e) => JSON.stringify(e)).join('\n'), 'utf8')
  })

  afterEach(async () => {
    await fs.rm(TRACE_FILE, { force: true })
  })

  it('GET /:runId renders an HTML timeline of trace events', async () => {
    const res = await devTracesRouter.fetch(new Request(`http://x/${RUN_ID}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain(`Trace ${RUN_ID} (2 events)`)
    expect(html).toContain('orchestrator')
    expect(html).toContain('researcher#0')
    expect(html).toContain('row researcher')
    expect(html).toContain('row orchestrator')
  })

  it('GET /:runId returns 404 when the trace file does not exist', async () => {
    const res = await devTracesRouter.fetch(new Request('http://x/run-does-not-exist-xyz'))
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body.error).toBe('not found')
  })

  it('sanitizes runId to alphanumerics/underscore/dash', async () => {
    // "../" is stripped; remaining chars match no file
    const res = await devTracesRouter.fetch(new Request('http://x/..%2Fetc%2Fpasswd'))
    expect(res.status).toBe(404)
  })

  it('escapes < in JSON-stringified event payloads', async () => {
    const evil = path.join(TRACE_DIR, 'run-evil.jsonl')
    await fs.writeFile(evil, JSON.stringify({ ts: 't', agent: 'orchestrator', event: 'x', payload: '<script>' }), 'utf8')
    try {
      const res = await devTracesRouter.fetch(new Request('http://x/run-evil'))
      const html = await res.text()
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script>')
    } finally {
      await fs.rm(evil, { force: true })
    }
  })
})
