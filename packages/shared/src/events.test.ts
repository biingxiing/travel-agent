import { describe, it, expect } from 'vitest'
import { ChatStreamEventSchema } from './events.js'

const KEPT = [
  'session', 'agent_step', 'token', 'plan_partial',
  'plan', 'clarify_needed', 'done', 'error',
] as const
const REMOVED = [
  'tool_reasoning', 'assistant_say', 'followup', 'item_options', 'heartbeat',
] as const

describe('ChatStreamEventSchema (v2.0)', () => {
  it('contains exactly the kept 8 discriminator values', () => {
    // Walk the discriminated-union options and collect type literals
    const options = (ChatStreamEventSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options
    const got = options.map((o) => o.shape.type.value).sort()
    expect(got).toEqual([...KEPT].sort())
  })

  it('rejects removed variants', () => {
    for (const t of REMOVED) {
      const r = ChatStreamEventSchema.safeParse({ type: t })
      expect(r.success).toBe(false)
    }
  })

  it('accepts agent_step with agent="researcher"', () => {
    const r = ChatStreamEventSchema.safeParse({
      type: 'agent_step', agent: 'researcher', status: 'start',
    })
    expect(r.success).toBe(true)
  })
})
