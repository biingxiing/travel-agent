import { describe, it, expect } from 'vitest'
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
    const m = buildMessages({
      brief: { destinations: ['Beijing'], days: 3, travelers: 2, preferences: [] },
      researchGoals: ['transport'],
    })
    expect(m[0]!.role).toBe('system')
    expect(m[0]!.content).toBe(SYSTEM_PROMPT)
  })

  it('exposes a ToolPool (initially empty in v2.0 stub state)', () => {
    expect(TOOLS).toBeDefined()
    expect(Array.isArray(TOOLS.tools)).toBe(true)
  })
})
