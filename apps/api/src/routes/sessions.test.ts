import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

vi.mock('../auth/middleware.js', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('userId', 'u-test'); await next() },
}))
vi.mock('../agents/react-loop.js', () => ({
  runReactLoop: vi.fn(async function* () {
    yield { type: 'plan', plan: { title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced', preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x' } }
    yield { type: 'done', messageId: 'm-1' }
  }),
}))

import { sessionsRouter } from './sessions.js'
import { runReactLoop } from '../agents/react-loop.js'

async function readSSE(res: Response): Promise<Array<{ type: string; raw: string }>> {
  const text = await res.text()
  const events: Array<{ type: string; raw: string }> = []
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) continue
    const json = dataLine.slice(5).trim()
    try {
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed.type === 'string') {
        events.push({ type: parsed.type, raw: json })
      }
    } catch { /* skip */ }
  }
  return events
}

describe('sessions router', () => {
  it('POST /sessions creates a new session', async () => {
    const res = await sessionsRouter.fetch(new Request('http://x/', { method: 'POST' }))
    const body = await res.json() as any
    expect(res.status).toBe(201)
    expect(body.session.userId).toBe('u-test')
    expect(body.session.status).toBe('draft')
  })

  it('GET /sessions lists user sessions', async () => {
    await sessionsRouter.fetch(new Request('http://x/', { method: 'POST' }))
    const res = await sessionsRouter.fetch(new Request('http://x/'))
    const body = await res.json() as any
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  it('GET /sessions/:id returns 404 when not found', async () => {
    const res = await sessionsRouter.fetch(new Request('http://x/no-such'))
    expect(res.status).toBe(404)
  })

  it('emits done after a loop error so the frontend exits loading state', async () => {
    // Force runReactLoop to throw mid-stream
    ;(runReactLoop as any).mockImplementationOnce(async function* () {
      throw new Error('boom')
    })

    // Create a session first
    const createRes = await sessionsRouter.fetch(new Request('http://x/', { method: 'POST' }))
    const { session } = await createRes.json() as any

    const res = await sessionsRouter.fetch(new Request(`http://x/${session.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    }))
    const events = await readSSE(res)
    const errIdx = events.findIndex(e => e.type === 'error')
    const doneIdx = events.findIndex(e => e.type === 'done')
    expect(errIdx).toBeGreaterThan(-1)
    expect(doneIdx).toBeGreaterThan(errIdx)
  })

  it('emits done after error in /continue handler', async () => {
    ;(runReactLoop as any).mockImplementationOnce(async function* () {
      throw new Error('continue boom')
    })

    // Create a session and place it in awaiting_user state via direct store access
    const createRes = await sessionsRouter.fetch(new Request('http://x/', { method: 'POST' }))
    const { session } = await createRes.json() as any
    const { sessionStore } = await import('../session/store.js')
    const stored = await sessionStore.get(session.id, 'u-test')
    if (stored) {
      stored.status = 'awaiting_user'
      await sessionStore.save(stored)
    }

    const res = await sessionsRouter.fetch(new Request(`http://x/${session.id}/continue`, {
      method: 'POST',
    }))
    const events = await readSSE(res)
    const errIdx = events.findIndex(e => e.type === 'error')
    const doneIdx = events.findIndex(e => e.type === 'done')
    expect(errIdx).toBeGreaterThan(-1)
    expect(doneIdx).toBeGreaterThan(errIdx)
  })
})
