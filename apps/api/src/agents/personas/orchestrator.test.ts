import { describe, it, expect, vi } from 'vitest'
import type { SessionState } from '@travel-agent/shared'

// Mock the LLM client so importing orchestrator.js (and its tool modules) does not require env at test time
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

vi.mock('./_compactor.js', () => ({
  COMPACT_THRESHOLD: 10,
  SLIDING_WINDOW: 20,
  // unit tests: no fresh compaction; pass through existing summary so the
  // "compacted history added as system" test still has data to assert on.
  compactHistoryIfNeeded: vi.fn(async (_turns: unknown, existing: string | null) => existing),
}))

import { SYSTEM_PROMPT, buildMessages, buildStateContextMessage, TOOLS } from './orchestrator.js'

const stub = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null, compactedHistory: null,
  ...overrides,
} as unknown as SessionState)

describe('Orchestrator persona', () => {
  it('SYSTEM_PROMPT is non-empty const', () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100)
  })

  it('messages[0] is the static system prompt (cache invariant)', async () => {
    const m = await buildMessages(stub())
    expect(m[0]!.role).toBe('system')
    expect(m[0]!.content).toBe(SYSTEM_PROMPT)
  })

  it('appends compacted history as a system message when present', async () => {
    const session = stub({ compactedHistory: 'SUMMARY OF EARLIER TURNS' } as Partial<SessionState>)
    const m = await buildMessages(session)
    expect(m[1]!.role).toBe('system')
    expect(m[1]!.content).toContain('SUMMARY OF EARLIER TURNS')
  })

  it('buildStateContextMessage produces a user message starting with "Session state:"', () => {
    const m = buildStateContextMessage(stub())
    expect(m.role).toBe('user')
    expect(typeof m.content === 'string' && m.content.startsWith('Session state:')).toBe(true)
  })

  it('TOOLS is a ToolPool (populated by tools/orchestrator/* in later tasks)', () => {
    expect(TOOLS).toBeDefined()
  })
})
