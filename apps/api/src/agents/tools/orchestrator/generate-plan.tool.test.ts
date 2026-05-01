import { describe, it, expect, vi } from 'vitest'
import { generatePlanTool } from './generate-plan.tool.js'

vi.mock('../../generator.js', () => ({
  runInitial: vi.fn(async function* () {
    yield { type: 'token', delta: '正在生成…' }
    yield {
      type: 'plan',
      plan: {
        title: 'Tokyo 5d', destinations: ['Tokyo'], days: 5, travelers: 2,
        pace: 'balanced',
        dailyPlans: [{ day: 1, items: [{ type: 'attraction', title: 'Senso-ji', description: 'Visit', durationMinutes: 120 }, { type: 'meal', title: 'Tonkatsu', description: 'Lunch' }, { type: 'lodging', title: 'ANA', description: 'Stay' }] }],
        estimatedBudget: { amount: 8000, currency: 'CNY', breakdown: [] },
        tips: [], disclaimer: 'AI generated.',
      },
    }
    yield { type: 'done', messageId: 'm1', converged: true }
    return { title: 'Tokyo 5d' } as unknown as Parameters<typeof generatePlanTool.call>[0]
  }),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: ['flight data: …'], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof generatePlanTool.call>[1])

describe('generatePlanTool', () => {
  it('forwards events and sets session.currentPlan', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await generatePlanTool.call({}, session, async (e) => { events.push(e) })
    expect(r.type).toBe('ok')
    expect(session.currentPlan).toBeTruthy()
    expect(events.some((e) => (e as { type: string }).type === 'token')).toBe(true)
    expect(events.some((e) => (e as { type: string }).type === 'plan')).toBe(true)
  })
})
