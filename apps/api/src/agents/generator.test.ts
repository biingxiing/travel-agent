import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: createMock } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
  REASONING_EFFORT: undefined,
}))

vi.mock('../registry/skill-registry.js', () => ({
  skillRegistry: {
    list: () => [{
      name: 'flyai', version: '1', description: 'flight/hotel',
      parameters: { command: { type: 'string', description: 'sub', required: true } },
    }],
    invoke: vi.fn(async () => '{"items":[]}'),
  },
}))

import { runInitial } from './generator.js'
import type { Plan, TripBrief } from '@travel-agent/shared'

async function* streamContent(content: string) {
  yield { choices: [{ delta: { content }, finish_reason: null }] }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
}

describe('generator.runInitial', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('runInitial uses low reasoning effort for streaming generation', async () => {
    const plan: Plan = {
      title: 'streamed',
      destinations: ['北京'],
      days: 1,
      travelers: 1,
      pace: 'balanced',
      preferences: [],
      dailyPlans: [{ day: 1, items: [{ type: 'meal', title: '早餐' }, { type: 'activity', title: '散步' }, { type: 'lodging', title: '酒店' }] }],
      tips: [],
      disclaimer: 'x',
    }
    createMock.mockResolvedValueOnce(streamContent('```json\n' + JSON.stringify(plan) + '\n```'))

    const brief: TripBrief = { destinations: ['北京'], days: 1, travelers: 1, preferences: [] }
    const gen = runInitial(brief, ['prefetch data'])
    while (true) {
      const next = await gen.next()
      if (next.done) break
    }

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock.mock.calls[0]?.[0]?.reasoning_effort).toBe('low')
  })

  it('runInitial keeps low reasoning effort on correction retry', async () => {
    const plan: Plan = {
      title: 'retried-initial',
      destinations: ['北京'],
      days: 1,
      travelers: 1,
      pace: 'balanced',
      preferences: [],
      dailyPlans: [{ day: 1, items: [{ type: 'meal', title: '早餐' }, { type: 'activity', title: '散步' }, { type: 'lodging', title: '酒店' }] }],
      tips: [],
      disclaimer: 'x',
    }
    createMock
      .mockResolvedValueOnce(streamContent('只有说明，没有 JSON'))
      .mockResolvedValueOnce(streamContent('```json\n' + JSON.stringify(plan) + '\n```'))

    const brief: TripBrief = { destinations: ['北京'], days: 1, travelers: 1, preferences: [] }
    const gen = runInitial(brief, ['prefetch data'])
    while (true) {
      const next = await gen.next()
      if (next.done) break
    }

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(createMock.mock.calls[0]?.[0]?.reasoning_effort).toBe('low')
    expect(createMock.mock.calls[1]?.[0]?.reasoning_effort).toBe('low')
  })
})
