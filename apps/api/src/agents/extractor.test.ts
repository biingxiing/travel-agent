import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: {
    chat: { completions: { create: vi.fn() } },
  },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
import { extractBrief } from './extractor.js'

describe('extractor', () => {
  it('parses destination and days from message', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destination: '北京', days: 3, travelers: 2 },
        intent: 'new', changedFields: ['destination','days','travelers'],
      })}}],
    })
    const res = await extractBrief([
      { role: 'user', content: '我想去北京玩 3 天，两个人', timestamp: 1 }
    ], null)
    expect(res.brief.destination).toBe('北京')
    expect(res.brief.days).toBe(3)
    expect(res.brief.travelers).toBe(2)
    expect(res.intent).toBe('new')
  })

  it('merges with existing brief', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destination: '北京', days: 3, originCity: '上海' },
        intent: 'clarify-answer', changedFields: ['originCity'],
      })}}],
    })
    const res = await extractBrief(
      [{ role: 'user', content: '从上海出发', timestamp: 2 }],
      { destination: '北京', days: 3, travelers: 1, preferences: [] },
    )
    expect(res.brief.originCity).toBe('上海')
  })
})
