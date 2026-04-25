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
  runReactLoop: async function* () {
    yield { type: 'plan', plan: { title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced', preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x' } }
    yield { type: 'done', messageId: 'm-1' }
  },
}))

import { sessionsRouter } from './sessions.js'

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
})
