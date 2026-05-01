import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM client so importing send-message.js does not require LLM_BASE_URL/LLM_API_KEY env at test time
vi.mock('../../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

vi.mock('../../../llm/logger.js', () => ({
  loggedStream: vi.fn(async function* () {
    yield { choices: [{ delta: { content: '' } }] }
  }),
}))

import { startResearchTool } from './start-research.tool.js'
import * as send from '../../runtime/send-message.js'

vi.spyOn(send, 'sendMessage').mockImplementation(
  async (_target, _payload) => ({ ok: true, summary: 'Tokyo: ANA flights 4500CNY; weather 18°C; cherry season.', sources: ['flyai:flight', 'flyai:weather'] }),
)

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: 'run-1',
  __runtime__: {
    trace: { event: () => {} },
    runId: 'run-1',
    childCounter: { next: () => 0 },
  },
} as unknown as Parameters<typeof startResearchTool.call>[1])

describe('startResearchTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is concurrency-safe', () => {
    expect(startResearchTool.isConcurrencySafe()).toBe(true)
  })

  it('appends researcher summary to session.prefetchContext', async () => {
    const session = stubSession()
    await startResearchTool.call({ researchGoals: ['transport', 'weather'] }, session, async () => {})
    expect(session.prefetchContext).toHaveLength(1)
    expect(session.prefetchContext[0]).toContain('Tokyo')
  })
})
