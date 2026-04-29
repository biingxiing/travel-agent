import { describe, it, expect } from 'vitest'
import { ChatStreamEventSchema, FollowupEventSchema, ItemOptionsEventSchema } from './events.js'
import type { ChatStreamEvent } from './events.js'

const minimalPlan = {
  title: 't', destinations: ['d'], days: 1, travelers: 1, pace: 'balanced' as const,
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [],
  disclaimer: 'x',
}

function roundTrip(event: ChatStreamEvent): ChatStreamEvent {
  return ChatStreamEventSchema.parse(JSON.parse(JSON.stringify(event)))
}

describe('ChatStreamEventSchema · variant coverage', () => {
  it('parses session', () => {
    const e = ChatStreamEventSchema.parse({ type: 'session', sessionId: 's1', messageId: 'm1' })
    expect(e.type).toBe('session')
  })

  it('parses agent_step with all status enum values', () => {
    const statuses = ['thinking', 'start', 'done', 'error', 'evaluating', 'refining'] as const
    for (const status of statuses) {
      const e = ChatStreamEventSchema.parse({ type: 'agent_step', agent: 'extractor', status })
      expect(e.type).toBe('agent_step')
    }
  })

  it('parses agent_step with optional skill / input / output', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'agent_step', agent: 'prefetch', skill: 'flyai', status: 'done',
      input: { city: 'sh' }, output: { items: 3 },
    })
    expect(e.type).toBe('agent_step')
  })

  it('parses token', () => {
    const e = ChatStreamEventSchema.parse({ type: 'token', delta: 'hi' })
    expect(e.type).toBe('token')
  })

  it('parses plan_partial with deepPartial plan payload', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'plan_partial', plan: { destinations: ['sh'], dailyPlans: [{ day: 1 }] },
    })
    expect(e.type).toBe('plan_partial')
  })

  it('parses plan with full PlanSchema payload', () => {
    const e = ChatStreamEventSchema.parse({ type: 'plan', plan: minimalPlan })
    expect(e.type).toBe('plan')
  })

  it('parses followup', () => {
    const e = FollowupEventSchema.parse({
      type: 'followup', field: 'budget', question: '预算大概多少？',
      options: ['<3000', '3000-8000', '>8000'], multiSelect: false,
    })
    expect(e.type).toBe('followup')
  })

  it('rejects followup without options', () => {
    expect(() => FollowupEventSchema.parse({
      type: 'followup', field: 'budget', question: '预算？', options: [],
    })).toThrow()
  })

  it('parses item_options', () => {
    const e = ItemOptionsEventSchema.parse({
      type: 'item_options',
      selections: [{
        dayNum: 1, itemIndex: 0, itemTitle: 'CA1234', itemType: 'transport',
        question: '换一个航班？',
        options: [{ id: 'a', label: 'A', description: 'd', patch: { time: '08:00' } }],
      }],
    })
    expect(e.type).toBe('item_options')
  })

  it('rejects item_options selection with empty options', () => {
    expect(() => ItemOptionsEventSchema.parse({
      type: 'item_options',
      selections: [{
        dayNum: 1, itemIndex: 0, itemTitle: 't', itemType: 'lodging',
        question: 'q', options: [],
      }],
    })).toThrow()
  })

  it('parses iteration_progress', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'iteration_progress',
      iteration: 3, maxIterations: 10,
      currentScore: 78, targetScore: 90,
      status: 'refining',
    })
    expect(e.type).toBe('iteration_progress')
  })

  it('rejects iteration_progress with iteration <= 0', () => {
    expect(() => ChatStreamEventSchema.parse({
      type: 'iteration_progress', iteration: 0, maxIterations: 10,
      currentScore: 0, targetScore: 90, status: 'evaluating',
    })).toThrow()
  })

  it('parses score with all category scores', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'score', overall: 88, transport: 90, lodging: 85, attraction: 92,
      iteration: 4, converged: false,
    })
    expect(e.type).toBe('score')
  })

  it('parses score with null category scores', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'score', overall: 50, transport: null, lodging: null, attraction: null,
      iteration: 0, converged: false,
    })
    expect(e.type).toBe('score')
  })

  it('parses clarify_needed', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'clarify_needed', question: '从哪出发？', reason: 'missing_origin',
    })
    expect(e.type).toBe('clarify_needed')
  })

  it('rejects clarify_needed with unknown reason', () => {
    expect(() => ChatStreamEventSchema.parse({
      type: 'clarify_needed', question: 'q', reason: 'totally_invented',
    })).toThrow()
  })

  it('parses assistant_say', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'assistant_say', content: '正在为你查询酒店…',
    })
    expect(e.type).toBe('assistant_say')
  })

  it('rejects assistant_say with empty content', () => {
    expect(() => ChatStreamEventSchema.parse({
      type: 'assistant_say', content: '',
    })).toThrow()
  })

  it('parses max_iter_reached with full plan payload', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'max_iter_reached', currentScore: 87, plan: minimalPlan,
    })
    expect(e.type).toBe('max_iter_reached')
  })

  it('parses done with optional usage', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'done', messageId: 'm1', converged: true,
      usage: { prompt: 1234, completion: 567 },
    })
    expect(e.type).toBe('done')
  })

  it('parses minimal done', () => {
    const e = ChatStreamEventSchema.parse({ type: 'done', messageId: 'm1' })
    expect(e.type).toBe('done')
  })

  it('parses error', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'error', code: 'LOOP_ERROR', message: 'rate limited',
    })
    expect(e.type).toBe('error')
  })
})

describe('ChatStreamEventSchema · round-trip JSON safety', () => {
  it('round-trips every variant through JSON encode/decode', () => {
    const variants: ChatStreamEvent[] = [
      { type: 'session', sessionId: 's', messageId: 'm' },
      { type: 'agent_step', agent: 'critic', status: 'evaluating' },
      { type: 'token', delta: 'x' },
      { type: 'plan_partial', plan: { destinations: ['sh'] } },
      { type: 'plan', plan: minimalPlan },
      {
        type: 'followup', field: 'days', question: '几天？',
        options: ['3', '5'], multiSelect: false,
      },
      {
        type: 'item_options',
        selections: [{
          dayNum: 1, itemIndex: 0, itemTitle: 't', itemType: 'transport',
          question: 'q', options: [{ id: 'a', label: 'A', description: 'd', patch: {} }],
        }],
      },
      {
        type: 'iteration_progress', iteration: 1, maxIterations: 10,
        currentScore: 50, targetScore: 90, status: 'evaluating',
      },
      {
        type: 'score', overall: 80, transport: 80, lodging: 80, attraction: 80,
        iteration: 1, converged: false,
      },
      { type: 'clarify_needed', question: 'q', reason: 'other' },
      { type: 'max_iter_reached', currentScore: 75, plan: minimalPlan },
      { type: 'done', messageId: 'm' },
      { type: 'error', code: 'X', message: 'm' },
      { type: 'assistant_say', content: '思考一下…' },
    ]

    for (const v of variants) {
      const out = roundTrip(v)
      expect(out.type).toBe(v.type)
    }
  })
})

describe('ChatStreamEventSchema · discriminator behavior', () => {
  it('rejects unknown event type', () => {
    expect(() => ChatStreamEventSchema.parse({ type: 'totally_made_up', foo: 1 })).toThrow()
  })

  it('rejects type-correct payload missing required fields', () => {
    expect(() => ChatStreamEventSchema.parse({ type: 'session' })).toThrow()
    expect(() => ChatStreamEventSchema.parse({ type: 'plan' })).toThrow()
    expect(() => ChatStreamEventSchema.parse({ type: 'token' })).toThrow()
  })
})
