import { describe, it, expect, vi } from 'vitest'

// Mock llm/client to avoid the LLM_BASE_URL/LLM_API_KEY env requirement at import time.
// researcher.ts -> registerPersona -> send-message.ts -> query-engine.ts -> llm/client.ts
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

import { SYSTEM_PROMPT, InputSchema, OutputSchema, buildMessages, TOOLS } from './researcher.js'

describe('Researcher persona', () => {
  it('SYSTEM_PROMPT is a non-empty const string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string')
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(50)
  })

  it('InputSchema accepts valid payload', () => {
    const r = InputSchema.parse({
      brief: { destinations: ['Beijing'], days: 3, travelers: 2, preferences: [] },
      researchGoals: ['transport', 'weather'],
    })
    expect(r.researchGoals).toContain('transport')
  })

  it('OutputSchema discriminated by ok', () => {
    expect(OutputSchema.parse({ ok: true, summary: 'hi', sources: [] }).ok).toBe(true)
    expect(OutputSchema.parse({ ok: false, error: 'x' }).ok).toBe(false)
  })

  it('buildMessages places SYSTEM_PROMPT at index 0 (cache invariant)', () => {
    const input = InputSchema.parse({
      brief: { destinations: ['Beijing'], days: 3, travelers: 2, preferences: [] },
      researchGoals: ['transport'],
    })
    const m = buildMessages(input)
    expect(m[0]!.role).toBe('system')
    expect(m[0]!.content).toBe(SYSTEM_PROMPT)
  })

  it('exposes a ToolPool (initially empty in v2.0 stub state)', () => {
    expect(TOOLS).toBeDefined()
    expect(Array.isArray(TOOLS.tools)).toBe(true)
  })
})
