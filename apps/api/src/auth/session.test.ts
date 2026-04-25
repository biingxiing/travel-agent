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

describe('verifyCredentials', () => {
  it('returns true for matching username and password', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('admin', 'super-secret-pw')).toBe(true)
  })

  it('returns false when username differs', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('attacker', 'super-secret-pw')).toBe(false)
  })

  it('returns false when password differs', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('admin', 'wrong-pw')).toBe(false)
  })

  it('returns false when both differ', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('attacker', 'wrong-pw')).toBe(false)
  })

  it('returns false when password length differs (no length-leak crash)', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('admin', 'short')).toBe(false)
    expect(verifyCredentials('admin', 'super-secret-pw-and-more')).toBe(false)
  })

  it('rejects empty credentials', async () => {
    const { verifyCredentials } = await import('./session.js')
    expect(verifyCredentials('', '')).toBe(false)
    expect(verifyCredentials('admin', '')).toBe(false)
    expect(verifyCredentials('', 'super-secret-pw')).toBe(false)
  })
})

describe('setAuthSession + getAuthenticatedUsername', () => {
  it('round-trips a signed cookie back to the username', async () => {
    const { setAuthSession, getAuthenticatedUsername } = await import('./session.js')

    const app = new Hono()
    app.post('/login', async (c) => { await setAuthSession(c); return c.json({ ok: true }) })
    app.get('/me', async (c) => {
      const u = await getAuthenticatedUsername(c)
      return c.json({ username: u })
    })

    const loginRes = await app.fetch(new Request('http://x/login', { method: 'POST' }))
    expect(loginRes.status).toBe(200)
    const setCookie = loginRes.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('travel_agent_auth=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie?.toLowerCase()).toContain('samesite=lax')

    const cookieHeader = setCookie!.split(';')[0]!
    const meRes = await app.fetch(new Request('http://x/me', {
      headers: { cookie: cookieHeader },
    }))
    const body = await meRes.json() as { username: string | null }
    expect(body.username).toBe('admin')
  })

  it('getAuthenticatedUsername returns null without a cookie', async () => {
    const { getAuthenticatedUsername } = await import('./session.js')
    const app = new Hono()
    app.get('/me', async (c) => c.json({ u: await getAuthenticatedUsername(c) }))
    const res = await app.fetch(new Request('http://x/me'))
    const body = await res.json() as { u: string | null }
    expect(body.u).toBeNull()
  })

  it('getAuthenticatedUsername returns null when cookie signature is invalid', async () => {
    const { getAuthenticatedUsername } = await import('./session.js')
    const app = new Hono()
    app.get('/me', async (c) => c.json({ u: await getAuthenticatedUsername(c) }))
    const res = await app.fetch(new Request('http://x/me', {
      headers: { cookie: 'travel_agent_auth=admin.tampered-sig' },
    }))
    const body = await res.json() as { u: string | null }
    expect(body.u).toBeNull()
  })

  it('cookie marked Secure when x-forwarded-proto=https', async () => {
    const { setAuthSession } = await import('./session.js')
    const app = new Hono()
    app.post('/login', async (c) => { await setAuthSession(c); return c.json({ ok: true }) })
    const res = await app.fetch(new Request('http://x/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
    }))
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie.toLowerCase()).toContain('secure')
  })

  it('cookie NOT marked Secure on plain http requests', async () => {
    const { setAuthSession } = await import('./session.js')
    const app = new Hono()
    app.post('/login', async (c) => { await setAuthSession(c); return c.json({ ok: true }) })
    const res = await app.fetch(new Request('http://x/login', { method: 'POST' }))
    const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase()
    expect(setCookie).not.toContain('secure')
  })
})

describe('clearAuthSession', () => {
  it('emits a Set-Cookie that expires the auth cookie', async () => {
    const { clearAuthSession } = await import('./session.js')
    const app = new Hono()
    app.post('/logout', (c) => { clearAuthSession(c); return c.json({ ok: true }) })
    const res = await app.fetch(new Request('http://x/logout', { method: 'POST' }))
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('travel_agent_auth=')
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/)
  })
})
