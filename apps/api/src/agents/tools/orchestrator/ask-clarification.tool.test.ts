import { describe, it, expect, vi } from 'vitest'
import { askClarificationTool } from './ask-clarification.tool.js'

vi.mock('../../clarifier.js', () => ({
  generateClarification: vi.fn(async () => ({ question: 'When are you planning to depart?', defaultSuggestion: null })),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof askClarificationTool.call>[1])

describe('askClarificationTool', () => {
  it('emits clarify_needed, sets session.pendingClarification, returns halt', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await askClarificationTool.call(
      { reason: 'missing_dates' }, session, async (e) => { events.push(e) },
    )
    expect(r.type).toBe('halt')
    expect(session.pendingClarification).toBeTruthy()
    expect(events.find((e) => (e as { type: string }).type === 'clarify_needed')).toBeTruthy()
  })
})
