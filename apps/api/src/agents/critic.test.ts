import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
import { criticReview } from './critic.js'
import type { Plan } from '@travel-agent/shared'

const samplePlan: Plan = {
  title: 'Beijing 3D', destination: '北京', days: 3, travelers: 1,
  pace: 'balanced', preferences: [], dailyPlans: [
    { day: 1, items: [{ type: 'transport', title: '高铁前往', description: '从上海乘高铁' }] },
    { day: 1, items: [] }, { day: 1, items: [] },
  ], tips: [], disclaimer: 'x',
}

describe('critic', () => {
  it('parses critic JSON', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        qualityScore: 60,
        blockers: [{ type: 'missing_origin', message: '请告诉我出发城市' }],
        itemIssues: [{ dayNum: 1, itemIndex: 0, severity: 'high',
          category: 'transport', problem: '缺车次号', suggestedAction: 'call_flyai_train' }],
        globalIssues: ['节奏过紧'],
      })}}],
    })
    const r = await criticReview(samplePlan, { destination: '北京', days: 3, travelers: 1, preferences: [] })
    expect(r.qualityScore).toBe(60)
    expect(r.blockers).toHaveLength(1)
    expect(r.itemIssues[0].suggestedAction).toBe('call_flyai_train')
  })

  it('gracefully degrades on bad JSON', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    })
    const r = await criticReview(samplePlan, { destination: '北京', days: 3, travelers: 1, preferences: [] })
    expect(r.qualityScore).toBe(0)
    expect(r.blockers).toEqual([])
  })
})
