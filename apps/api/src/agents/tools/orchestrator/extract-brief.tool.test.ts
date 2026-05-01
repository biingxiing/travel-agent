import { describe, it, expect, vi } from 'vitest'
import { extractBriefTool } from './extract-brief.tool.js'

vi.mock('../../extractor.js', () => ({
  extractBrief: vi.fn(async () => ({
    brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [], originCity: 'Beijing' },
    intent: 'new',
    changedFields: ['destinations', 'days'],
  })),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [{ id: 'm1', role: 'user', content: '去东京玩 5 天', ts: 1 }],
  status: 'draft', brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof extractBriefTool.call>[1])

describe('extractBriefTool', () => {
  it('mutates session.brief and emits agent_step events', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await extractBriefTool.call({}, session, async (e) => { events.push(e) })
    expect(r.type).toBe('ok')
    expect(session.brief).toBeTruthy()
    expect((session.brief as { destinations: string[] }).destinations).toContain('Tokyo')
    expect(events.some((e) => (e as { type: string }).type === 'agent_step')).toBe(true)
  })
})
