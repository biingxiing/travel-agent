import { describe, it, expect, vi } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: createMock } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
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

describe('generator.runRefine', () => {
  it('returns improved plan from JSON output', async () => {
    const newPlan: Plan = {
      title: 't', destination: '北京', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        { type: 'transport', title: 'CA1234' },
      ] }], tips: [], disclaimer: 'x',
    }
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n' + JSON.stringify(newPlan) + '\n```', tool_calls: [] } }],
    })
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
    const brief: TripBrief = { destination: '北京', days: 1, travelers: 1, preferences: [] }
    const out = await runRefine(original, report, brief)
    expect(out.dailyPlans[0].items).toHaveLength(1)
    expect(out.dailyPlans[0].items[0].title).toBe('CA1234')
  })
})
