import { describe, it, expect, vi } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { SYSTEM_PROMPT, buildMessages, TOOLS } from './orchestrator.js'

vi.mock('./_compactor.js', () => ({
  COMPACT_THRESHOLD: 10,
  SLIDING_WINDOW: 20,
  compactHistoryIfNeeded: vi.fn(async () => null),   // unit tests: no compaction
}))

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

  it('appends a Session state user message at the tail', async () => {
    const m = await buildMessages(stub())
    const last = m[m.length - 1]!
    expect(last.role).toBe('user')
    expect(typeof last.content === 'string' && last.content.startsWith('Session state:')).toBe(true)
  })

  it('TOOLS is a ToolPool (populated by tools/orchestrator/* in later tasks)', () => {
    expect(TOOLS).toBeDefined()
  })
})
