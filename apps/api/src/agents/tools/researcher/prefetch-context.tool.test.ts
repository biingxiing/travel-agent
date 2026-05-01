import { describe, it, expect, vi } from 'vitest'
import { prefetchContextTool } from './prefetch-context.tool.js'

vi.mock('../../prefetch.js', () => ({
  prefetchFlyaiContext: vi.fn(async () => ['flight: AA123 BJS→TYO', 'hotel: ANA Crowne Plaza']),
}))

describe('prefetchContextTool', () => {
  it('reports concurrency-safe', () => {
    expect(prefetchContextTool.isConcurrencySafe()).toBe(true)
  })

  it('calls prefetchFlyaiContext and returns concatenated string', async () => {
    const session = { id: 's1', brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] } } as unknown as Parameters<typeof prefetchContextTool.call>[1]
    const r = await prefetchContextTool.call({}, session, async () => {})
    expect(r.type).toBe('ok')
    if (r.type === 'ok') {
      expect(r.output).toContain('flight: AA123')
      expect(r.output).toContain('hotel: ANA')
    }
  })
})
