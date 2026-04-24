import { describe, it, expect } from 'vitest'
import { SessionStatusEnum, SessionStateSchema } from './session.js'

describe('SessionState', () => {
  it('accepts all valid statuses', () => {
    for (const s of ['draft','planning','refining','awaiting_user','converged','error']) {
      expect(SessionStatusEnum.parse(s)).toBe(s)
    }
  })

  it('parses minimal session', () => {
    const s = SessionStateSchema.parse({
      id: 'sess-1', userId: 'u-1', messages: [], status: 'draft',
      iterationCount: 0, createdAt: 1, updatedAt: 1,
    })
    expect(s.brief).toBeNull()
    expect(s.currentPlan).toBeNull()
    expect(s.currentScore).toBeNull()
  })
})
