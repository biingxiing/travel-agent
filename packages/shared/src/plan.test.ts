import { describe, it, expect } from 'vitest'
import { PlanSchema, PlanItemSchema, DailyPlanSchema, EstimatedBudgetSchema } from './plan.js'

const realisticPlan = {
  title: '上海亲子三日游',
  destination: '上海',
  originCity: '北京',
  startDate: '2026-05-01',
  endDate: '2026-05-03',
  days: 3,
  travelers: 3,
  pace: 'balanced',
  preferences: ['亲子', '美食'],
  dailyPlans: [
    {
      day: 1,
      date: '2026-05-01',
      theme: '抵达 + 外滩',
      items: [
        {
          time: '08:00',
          type: 'transport',
          title: 'CA1858 北京→上海',
          description: '国航直飞',
          location: { name: '首都机场', city: '北京', lat: 40.0, lng: 116.6 },
          estimatedCost: { amount: 1280, currency: 'CNY' },
        },
        {
          time: '14:00',
          type: 'lodging',
          title: '入住外滩茂悦',
          location: { name: '上海茂悦', city: '上海' },
        },
        { time: '19:00', type: 'attraction', title: '外滩夜景' },
      ],
    },
    { day: 2, items: [] },
    { day: 3, theme: '返程', items: [] },
  ],
  estimatedBudget: {
    amount: 12000, currency: 'CNY', note: '不含购物',
    breakdown: [
      { category: 'transport', amount: 4000 },
      { category: 'lodging', amount: 5000 },
      { category: 'food', amount: 2000 },
      { category: 'tickets', amount: 1000 },
    ],
  },
  tips: ['五一假期景区拥挤，建议提前订票'],
  disclaimer: '本行程由 AI 生成，仅供参考。',
}

describe('PlanItemSchema', () => {
  it('parses each type enum value', () => {
    const types = ['attraction', 'meal', 'transport', 'lodging', 'activity', 'note'] as const
    for (const type of types) {
      const item = PlanItemSchema.parse({ type, title: 't' })
      expect(item.type).toBe(type)
    }
  })

  it('rejects unknown item type', () => {
    expect(() => PlanItemSchema.parse({ type: 'shopping', title: 't' })).toThrow()
  })

  it('requires title', () => {
    expect(() => PlanItemSchema.parse({ type: 'attraction' })).toThrow()
  })

  it('parses minimal item', () => {
    const item = PlanItemSchema.parse({ type: 'note', title: '提醒：带身份证' })
    expect(item.title).toBe('提醒：带身份证')
  })

  it('keeps location lat/lng when supplied', () => {
    const item = PlanItemSchema.parse({
      type: 'attraction', title: '外滩',
      location: { name: '外滩', lat: 31.24, lng: 121.49 },
    })
    expect(item.location?.lat).toBe(31.24)
    expect(item.location?.lng).toBe(121.49)
  })

  it('rejects estimatedCost missing currency', () => {
    expect(() => PlanItemSchema.parse({
      type: 'meal', title: '小笼包', estimatedCost: { amount: 50 },
    })).toThrow()
  })
})

describe('DailyPlanSchema', () => {
  it('parses minimal day with empty items', () => {
    const day = DailyPlanSchema.parse({ day: 1, items: [] })
    expect(day.day).toBe(1)
    expect(day.items).toEqual([])
  })

  it('requires items array', () => {
    expect(() => DailyPlanSchema.parse({ day: 1 })).toThrow()
  })
})

describe('EstimatedBudgetSchema', () => {
  it('defaults currency to CNY', () => {
    const budget = EstimatedBudgetSchema.parse({ amount: 5000 })
    expect(budget.currency).toBe('CNY')
  })

  it('parses breakdown with all category enum values', () => {
    const budget = EstimatedBudgetSchema.parse({
      amount: 1000,
      breakdown: [
        { category: 'transport', amount: 100 },
        { category: 'lodging', amount: 200 },
        { category: 'food', amount: 300 },
        { category: 'tickets', amount: 200 },
        { category: 'other', amount: 200 },
      ],
    })
    expect(budget.breakdown).toHaveLength(5)
  })

  it('rejects breakdown with unknown category', () => {
    expect(() => EstimatedBudgetSchema.parse({
      amount: 1000,
      breakdown: [{ category: 'shopping', amount: 100 }],
    })).toThrow()
  })
})

describe('PlanSchema', () => {
  it('parses a realistic 3-day plan', () => {
    const plan = PlanSchema.parse(realisticPlan)
    expect(plan.dailyPlans).toHaveLength(3)
    expect(plan.travelers).toBe(3)
    expect(plan.estimatedBudget?.breakdown).toHaveLength(4)
  })

  it('round-trips through JSON encode/decode', () => {
    const reparsed = PlanSchema.parse(JSON.parse(JSON.stringify(realisticPlan)))
    expect(reparsed.title).toBe(realisticPlan.title)
    expect(reparsed.dailyPlans[0]?.items).toHaveLength(3)
  })

  it('applies defaults for travelers / pace / preferences / tips / disclaimer', () => {
    const plan = PlanSchema.parse({
      title: 't', destination: 'd', days: 1,
      dailyPlans: [{ day: 1, items: [] }],
    })
    expect(plan.travelers).toBe(1)
    expect(plan.pace).toBe('balanced')
    expect(plan.preferences).toEqual([])
    expect(plan.tips).toEqual([])
    expect(plan.disclaimer.length).toBeGreaterThan(0)
  })

  it('rejects invalid pace enum', () => {
    expect(() => PlanSchema.parse({
      title: 't', destination: 'd', days: 1, pace: 'sprint',
      dailyPlans: [{ day: 1, items: [] }],
    })).toThrow()
  })

  it('requires destination, title, days', () => {
    expect(() => PlanSchema.parse({ destination: 'd', days: 1, dailyPlans: [] })).toThrow()
    expect(() => PlanSchema.parse({ title: 't', days: 1, dailyPlans: [] })).toThrow()
    expect(() => PlanSchema.parse({ title: 't', destination: 'd', dailyPlans: [] })).toThrow()
  })

  it('keeps optional originCity / startDate / endDate when provided', () => {
    const plan = PlanSchema.parse({
      title: 't', destination: 'sh', days: 2, originCity: 'bj',
      startDate: '2026-05-01', endDate: '2026-05-02',
      dailyPlans: [{ day: 1, items: [] }, { day: 2, items: [] }],
    })
    expect(plan.originCity).toBe('bj')
    expect(plan.startDate).toBe('2026-05-01')
    expect(plan.endDate).toBe('2026-05-02')
  })

  it('deepPartial parses heavily empty payloads (used by plan_partial event)', () => {
    const partial = PlanSchema.deepPartial().parse({ destination: 'sh' })
    expect(partial.destination).toBe('sh')
    expect(partial.dailyPlans).toBeUndefined()
  })
})
