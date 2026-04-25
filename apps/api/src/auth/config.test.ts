import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const VALID_ENV = {
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD: 'super-secret-pw',
  AUTH_COOKIE_SECRET: 'a-secret-of-at-least-16-chars-yes',
  AUTH_COOKIE_NAME: 'travel_agent_auth',
}

describe('getAuthConfig', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv, ...VALID_ENV }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns parsed config when env is valid', async () => {
    const { getAuthConfig } = await import('./config.js')
    const config = getAuthConfig()
    expect(config.username).toBe('admin')
    expect(config.password).toBe('super-secret-pw')
    expect(config.cookieName).toBe('travel_agent_auth')
  })

  it('defaults cookieName to travel_agent_auth when AUTH_COOKIE_NAME unset', async () => {
    delete process.env.AUTH_COOKIE_NAME
    const { getAuthConfig } = await import('./config.js')
    expect(getAuthConfig().cookieName).toBe('travel_agent_auth')
  })

  it('throws when AUTH_USERNAME is missing', async () => {
    delete process.env.AUTH_USERNAME
    const { getAuthConfig } = await import('./config.js')
    expect(() => getAuthConfig()).toThrow(/AUTH_USERNAME/)
  })

  it('throws when AUTH_PASSWORD is missing', async () => {
    delete process.env.AUTH_PASSWORD
    const { getAuthConfig } = await import('./config.js')
    expect(() => getAuthConfig()).toThrow(/AUTH_PASSWORD/)
  })

  it('throws when AUTH_COOKIE_SECRET is shorter than 16 chars', async () => {
    process.env.AUTH_COOKIE_SECRET = 'short'
    const { getAuthConfig } = await import('./config.js')
    expect(() => getAuthConfig()).toThrow(/AUTH_COOKIE_SECRET/)
  })

  it('caches the result across multiple calls', async () => {
    const { getAuthConfig } = await import('./config.js')
    const a = getAuthConfig()
    const b = getAuthConfig()
    expect(a).toBe(b)
  })

  it('assertAuthConfig throws when env is broken', async () => {
    delete process.env.AUTH_USERNAME
    const { assertAuthConfig } = await import('./config.js')
    expect(() => assertAuthConfig()).toThrow()
  })
})
