import { describe, it, expect, vi } from 'vitest'

vi.mock('./critic.js', () => ({
  criticReview: vi.fn(),
}))

vi.mock('../config/eval.js', () => ({
  getEvalConfig: () => ({
    ruleWeight: 0.7, llmWeight: 0.3, threshold: 90, maxIter: 10,
    requiredCategories: ['transport', 'lodging', 'attraction'],
  }),
}))

import { evaluate } from './evaluator.js'
import { criticReview } from './critic.js'
import type { Plan, TripBrief } from '@travel-agent/shared'

const fullTransport = (s: number, n: number) => Array.from({ length: n }, () => ({
  time: '09:00', type: 'transport' as const, title: 'CA1234 北京大兴机场→上海浦东机场',
  description: '经济舱 ¥890，提前 2 小时到达办理值机和托运',
  tips: ['提前预订更便宜'],
}))

describe('evaluate', () => {
  it('combines rule and LLM scores', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 50, blockers: [], itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: fullTransport(100, 1) }],
      tips: [], disclaimer: 'x',
    }
    const brief: TripBrief = { destination: 'd', days: 1, travelers: 1, preferences: [] }
    const r = await evaluate(plan, brief)
    // ruleScore.transport.score = 100, ruleScore.overall depends on coverage too
    // combined.transport = 100 (no LLM per-cat); use rule only for cats
    expect(r.combined.transport).toBe(100)
    expect(r.llmScore).toBe(50)
    // overall = 0.7 * ruleScore.overall + 0.3 * 50
  })

  it('marks converged when all required cats >= 90 by rule', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        ...fullTransport(100, 1),
        { type: 'lodging', title: '北京饭店 大床房', description: '入住 14:00 后，每晚 ¥800，地址：王府井大街 33 号，含早餐', estimatedCost: { amount: 800, currency: 'CNY' } },
        { type: 'attraction', title: '故宫博物院', description: '开放时间 08:30-17:00，门票 ¥60/人，建议游览 3 小时，明清两代皇宫，必看', tips: ['提前预约'] },
        { type: 'attraction', title: '天安门', description: '开放时间 05:00-22:00，免费开放，建议游览 1 小时，世界最大城市广场之一，地标', tips: ['人多'] },
      ] }],
      tips: [], disclaimer: 'x',
    }
    const brief: TripBrief = { destination: 'd', days: 1, travelers: 1, preferences: [] }
    const r = await evaluate(plan, brief)
    expect(r.converged).toBe(true)
  })

  it('passes blockers from critic', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 60, blockers: [{ type: 'missing_origin', message: '?' }],
      itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x',
    }
    const r = await evaluate(plan, { destination: 'd', days: 1, travelers: 1, preferences: [] })
    expect(r.blockers).toHaveLength(1)
  })
})
