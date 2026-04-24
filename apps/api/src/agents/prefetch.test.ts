import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('../registry/skill-registry.js', () => ({
  skillRegistry: {
    invoke: invokeMock,
    get: () => ({ manifest: { name: 'flyai' } }),
  },
}))

import { prefetchFlyaiContext, __resetPrefetchCache } from './prefetch.js'
import type { TripBrief } from '@travel-agent/shared'

const fullBrief: TripBrief = {
  destination: '上海',
  days: 3,
  originCity: '北京',
  travelers: 2,
  preferences: ['美食', '文化'],
  travelDates: { start: '2026-05-01', end: '2026-05-04' },
}

describe('prefetchFlyaiContext', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    __resetPrefetchCache()
  })

  it('invokes search-flight + search-hotel + search-poi when brief complete', async () => {
    invokeMock.mockResolvedValue('{"data":{"itemList":[]}}')
    const ctx = await prefetchFlyaiContext(fullBrief, 'session-1')
    expect(invokeMock).toHaveBeenCalledTimes(3)
    const cmds = invokeMock.mock.calls.map((c) => (c[1] as Record<string, unknown>).command)
    expect(cmds).toContain('search-flight')
    expect(cmds).toContain('search-hotel')
    expect(cmds).toContain('search-poi')
    expect(ctx).toHaveLength(3)
    expect(ctx[0]).toContain('真实')
  })

  it('skips search-flight when no originCity', async () => {
    invokeMock.mockResolvedValue('{"data":{"itemList":[]}}')
    const brief: TripBrief = { ...fullBrief, originCity: undefined }
    const ctx = await prefetchFlyaiContext(brief, 'session-2')
    const cmds = invokeMock.mock.calls.map((c) => (c[1] as Record<string, unknown>).command)
    expect(cmds).not.toContain('search-flight')
    expect(cmds).toContain('search-hotel')
    expect(cmds).toContain('search-poi')
    expect(ctx).toHaveLength(2)
  })

  it('defaults travelDates when missing (today + 7d)', async () => {
    invokeMock.mockResolvedValue('{"data":{"itemList":[]}}')
    const brief: TripBrief = { ...fullBrief, travelDates: undefined }
    await prefetchFlyaiContext(brief, 'session-3')
    const flightCall = invokeMock.mock.calls.find((c) => (c[1] as Record<string, unknown>).command === 'search-flight')
    expect(flightCall).toBeDefined()
    const depDate = (flightCall![1] as Record<string, unknown>).depDate as string
    expect(depDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const hotelCall = invokeMock.mock.calls.find((c) => (c[1] as Record<string, unknown>).command === 'search-hotel')
    const checkIn = (hotelCall![1] as Record<string, unknown>).checkInDate as string
    const checkOut = (hotelCall![1] as Record<string, unknown>).checkOutDate as string
    expect(checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(checkOut).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(checkOut > checkIn).toBe(true)
  })

  it('truncates oversized output to ~3000 chars per entry', async () => {
    invokeMock.mockResolvedValue('x'.repeat(20000))
    const ctx = await prefetchFlyaiContext(fullBrief, 'session-4')
    for (const entry of ctx) {
      // Allow header + truncated body + ellipsis
      expect(entry.length).toBeLessThan(3500)
    }
  })

  it('continues when one command fails (logs warn, skips that entry)', async () => {
    invokeMock.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      if (args.command === 'search-flight') throw new Error('flyai timeout')
      return '{"data":{"itemList":[]}}'
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = await prefetchFlyaiContext(fullBrief, 'session-5')
    expect(ctx).toHaveLength(2)
    const joined = ctx.join('\n')
    expect(joined).not.toContain('search-flight')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('caches by sessionId+brief hash on second call with identical brief', async () => {
    invokeMock.mockResolvedValue('{"data":{"itemList":[]}}')
    await prefetchFlyaiContext(fullBrief, 'session-cache')
    const firstCount = invokeMock.mock.calls.length
    await prefetchFlyaiContext(fullBrief, 'session-cache')
    expect(invokeMock.mock.calls.length).toBe(firstCount)
  })

  it('refetches when brief changes (different cache key)', async () => {
    invokeMock.mockResolvedValue('{"data":{"itemList":[]}}')
    await prefetchFlyaiContext(fullBrief, 'session-cache2')
    const firstCount = invokeMock.mock.calls.length
    await prefetchFlyaiContext({ ...fullBrief, days: 5 }, 'session-cache2')
    expect(invokeMock.mock.calls.length).toBeGreaterThan(firstCount)
  })
})
