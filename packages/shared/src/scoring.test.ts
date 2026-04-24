import { describe, it, expect } from 'vitest'
import { scorePlan, gradeFromScore } from './scoring.js'
import type { Plan } from './plan.js'

const minimalPlan: Plan = {
  title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [],
  disclaimer: 'x',
}

describe('scoring', () => {
  it('gradeFromScore returns excellent for 90+', () => {
    expect(gradeFromScore(90)).toBe('excellent')
    expect(gradeFromScore(70)).toBe('good')
    expect(gradeFromScore(50)).toBe('fair')
    expect(gradeFromScore(0)).toBe('poor')
    expect(gradeFromScore(null)).toBe('none')
  })

  it('returns null categories when items absent', () => {
    const s = scorePlan(minimalPlan)
    expect(s.transport.score).toBeNull()
    expect(s.lodging.score).toBeNull()
    expect(s.attraction.score).toBeNull()
  })

  it('full transport item scores 100', () => {
    const plan: Plan = {
      ...minimalPlan,
      dailyPlans: [{
        day: 1, items: [{
          time: '09:00', type: 'transport',
          title: 'CA1234 北京大兴机场→上海浦东机场',
          description: '经济舱 ¥890，提前 2 小时到达办理值机和托运',
          tips: ['提前预订更便宜'],
        }],
      }],
    }
    const s = scorePlan(plan)
    expect(s.transport.score).toBe(100)
  })
})
