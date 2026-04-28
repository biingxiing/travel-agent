import { describe, it, expect, vi } from 'vitest'

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

import { runRefine } from './generator.js'
import type { Plan, EvaluationReport, TripBrief } from '@travel-agent/shared'

async function* streamContent(content: string) {
  yield { choices: [{ delta: { content }, finish_reason: null }] }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
}

describe('generator.runRefine', () => {
  it('returns improved plan from JSON output', async () => {
    const newPlan: Plan = {
      title: 't', destinations: ['北京'], days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        { type: 'transport', title: 'CA1234' },
      ] }], tips: [], disclaimer: 'x',
    }
    createMock.mockResolvedValueOnce(streamContent('```json\n' + JSON.stringify(newPlan) + '\n```'))
    const original: Plan = { ...newPlan, dailyPlans: [{ day: 1, items: [] }] }
    const report: EvaluationReport = {
      ruleScore: { overall: 0, grade: 'poor', transport: { score: 0, count: 0, items: [], grade: 'poor' },
        lodging: { score: null, count: 0, items: [], grade: 'none' },
        attraction: { score: null, count: 0, items: [], grade: 'none' },
        meal: { score: null, count: 0, items: [], grade: 'none' },
        coverage: { score: 0, daysWithTransport: 0, daysWithLodging: 0, daysWithAttractions: 0, totalDays: 1 },
        suggestions: [] },
      llmScore: 0,
      combined: { overall: 0, transport: 0, lodging: null, attraction: null },
      blockers: [], itemIssues: [], globalIssues: [], converged: false,
    }
    const brief: TripBrief = { destinations: ['北京'], days: 1, travelers: 1, preferences: [] }
    const out = await runRefine(original, report, brief)
    expect(out.dailyPlans[0].items).toHaveLength(1)
    expect(out.dailyPlans[0].items[0].title).toBe('CA1234')
  })

  it('runRefine accepts prefetchContext instead of messages', async () => {
    const newPlan: Plan = {
      title: 't', destinations: ['Beijing'], days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        { type: 'transport', title: 'CA1234' },
      ] }], tips: [], disclaimer: 'x',
    }
    createMock.mockResolvedValueOnce(streamContent('```json\n' + JSON.stringify(newPlan) + '\n```'))
    const mockPlan: Plan = { ...newPlan, dailyPlans: [{ day: 1, items: [] }] }
    const mockReport: EvaluationReport = {
      combined: { overall: 70, transport: 70, lodging: 70, attraction: 70 },
      itemIssues: [], globalIssues: [], blockers: [], converged: false,
      ruleScore: {} as any, llmScore: 70,
    }
    const mockBrief: TripBrief = {
      destinations: ['Beijing'], days: 3, travelers: 1,
      preferences: [], originCity: undefined, pace: 'balanced',
      budget: undefined, travelDates: undefined, notes: undefined,
    }

    // Should not throw — no messages param
    const result = await runRefine(mockPlan, mockReport, mockBrief, ['prefetch data'])
    expect(result).toBeDefined()
  })
})
