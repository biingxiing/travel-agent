import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

const VALID_ENV = {
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD: 'super-secret-pw',
  AUTH_COOKIE_SECRET: 'a-secret-of-at-least-16-chars-yes',
  AUTH_COOKIE_NAME: 'travel_agent_auth',
}

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = process.env
  process.env = { ...originalEnv, ...VALID_ENV }
  vi.resetModules()
})

afterEach(() => {
  process.env = originalEnv
})

async function buildAppWithMiddleware() {
  const { authMiddleware } = await import('./middleware.js')
  const app = new Hono()
  app.use('*', authMiddleware)
  app.get('/api/auth/me', (c) => c.json({ ok: true, scope: 'auth' }))
  app.get('/api/sessions', (c) => c.json({ ok: true, userId: c.get('userId') }))
  app.post('/api/sessions', (c) => c.json({ ok: true, userId: c.get('userId') }))
  return app
}

async function loginCookie(): Promise<string> {
  const { setAuthSession } = await import('./session.js')
  const app = new Hono()
  app.post('/login', async (c) => { await setAuthSession(c); return c.json({ ok: true }) })
  const res = await app.fetch(new Request('http://x/login', { method: 'POST' }))
  const setCookie = res.headers.get('set-cookie')!
  return setCookie.split(';')[0]!
}

describe('authMiddleware', () => {
  it('passes OPTIONS without checking cookie (CORS preflight)', async () => {
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions', { method: 'OPTIONS' }))
    expect(res.status).not.toBe(401)
  })

  it('passes /api/auth/* without a cookie', async () => {
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/auth/me'))
    expect(res.status).toBe(200)
    const body = await res.json() as { scope: string }
    expect(body.scope).toBe('auth')
  })

  it('returns 401 for protected routes without a cookie', async () => {
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions'))
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 with an invalid signed cookie', async () => {
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions', {
      headers: { cookie: 'travel_agent_auth=admin.bad-sig' },
    }))
    expect(res.status).toBe(401)
  })

  it('lets a valid cookie through and sets userId on the context', async () => {
    const cookie = await loginCookie()
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions', {
      headers: { cookie },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { userId: string }
    expect(body.userId).toBe('admin')
  })

  it('clears the auth cookie when rejecting an invalid request', async () => {
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions', {
      headers: { cookie: 'travel_agent_auth=admin.bad-sig' },
    }))
    expect(res.status).toBe(401)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie.toLowerCase()).toMatch(/travel_agent_auth=.*max-age=0|travel_agent_auth=.*expires=/)
  })

  it('a valid cookie also passes for non-GET methods', async () => {
    const cookie = await loginCookie()
    const app = await buildAppWithMiddleware()
    const res = await app.fetch(new Request('http://x/api/sessions', {
      method: 'POST', headers: { cookie },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { userId: string }
    expect(body.userId).toBe('admin')
  })
})
