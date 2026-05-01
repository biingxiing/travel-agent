import { describe, it, expect, vi } from 'vitest'
import type { Message } from '@travel-agent/shared'
import { compactHistoryIfNeeded, COMPACT_THRESHOLD } from './_compactor.js'

// Mock llm/client to avoid the LLM_BASE_URL/LLM_API_KEY env requirement at import time
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

vi.mock('../../llm/logger.js', () => ({
  loggedCompletion: vi.fn(async () => ({
    choices: [{ message: { content: 'SUMMARY: user wanted Tokyo 5d, family.' } }],
  })),
}))

function turns(n: number): Message[] {
  const out: Message[] = []
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', content: `user ${i}`, timestamp: i })
    out.push({ role: 'assistant', content: `assistant ${i}`, timestamp: i })
  }
  return out
}

describe('compactHistoryIfNeeded', () => {
  it('returns null when turn count is under threshold', async () => {
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD - 1), null)
    expect(r).toBeNull()
  })

  it('returns a summary string when turn count exceeds threshold and no existing summary', async () => {
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD + 5), null)
    expect(r).toMatch(/SUMMARY/)
  })

  it('returns existing summary unchanged once locked', async () => {
    const existing = 'PREVIOUS SUMMARY'
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD + 5), existing)
    expect(r).toBe(existing)
  })
})
