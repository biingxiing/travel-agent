import { describe, it, expect } from 'vitest'
import { ChatStreamEventSchema } from './events.js'

describe('ChatStreamEvent', () => {
  it('parses iteration_progress', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'iteration_progress',
      iteration: 3, maxIterations: 10,
      currentScore: 78, targetScore: 90,
      status: 'refining',
    })
    expect(e.type).toBe('iteration_progress')
  })

  it('parses score', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'score', overall: 88, transport: 90, lodging: 85, attraction: 92,
      iteration: 4, converged: false,
    })
    expect(e.type).toBe('score')
  })

  it('parses clarify_needed', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'clarify_needed', question: '从哪出发？', reason: 'missing_origin',
    })
    expect(e.type).toBe('clarify_needed')
  })

  it('parses max_iter_reached', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'max_iter_reached', currentScore: 87,
      plan: { title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
        preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [],
        disclaimer: 'x' },
    })
    expect(e.type).toBe('max_iter_reached')
  })
})
