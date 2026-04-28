import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

vi.mock('../llm/logger.js', () => ({
  loggedCompletion: vi.fn(),
}))

import { loggedCompletion } from '../llm/logger.js'
import { extractBrief } from './extractor.js'

describe('extractor', () => {
  it('parses destinations and days from message', async () => {
    ;(loggedCompletion as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destinations: ['北京'], days: 3, travelers: 2 },
        intent: 'new', changedFields: ['destinations','days','travelers'],
      })}}],
    })
    const res = await extractBrief([
      { role: 'user', content: '我想去北京玩 3 天，两个人', timestamp: 1 }
    ], null)
    expect(res.brief.destinations[0]).toBe('北京')
    expect(res.brief.days).toBe(3)
    expect(res.brief.travelers).toBe(2)
    expect(res.intent).toBe('new')
  })

  it('merges with existing brief', async () => {
    ;(loggedCompletion as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destinations: ['北京'], days: 3, originCity: '上海' },
        intent: 'clarify-answer', changedFields: ['originCity'],
      })}}],
    })
    const res = await extractBrief(
      [{ role: 'user', content: '从上海出发', timestamp: 2 }],
      { destinations: ['北京'], days: 3, travelers: 1, preferences: [] },
    )
    expect(res.brief.originCity).toBe('上海')
  })

  it('passes latestMessage separately so intent comes from newest message only', async () => {
    ;(loggedCompletion as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destinations: ['北京'], days: 4 },
        intent: 'refine',
        changedFields: ['days'],
      })}}],
    })

    await extractBrief([
      { role: 'user', content: '我想去北京3天', timestamp: 1 },
      { role: 'user', content: '改成4天吧', timestamp: 2 },
    ], { destinations: ['北京'], days: 3, travelers: 1, preferences: [] })

    const callParams = (loggedCompletion as any).mock.calls.at(-1)[1]
    const userMsgContent: string = callParams.messages[1].content
    expect(userMsgContent).toContain('allMessages:')
    expect(userMsgContent).toContain('latestMessage:')
    // latestMessage should be only the last message
    const latestSection = userMsgContent.split('latestMessage:')[1]
    expect(latestSection).toContain('改成4天吧')
    expect(latestSection).not.toContain('我想去北京3天')
  })

  describe('bug-report input handling', () => {
    const BUG_INPUT = '顺德，珠海， 出行人数3，两个大人一个小孩从北京出发旅游节奏：当地特色景点和必打卡景点，亲子 美食， 5月2号出发， 5月9号回北京'

    it('Variant A: tolerates LLM null fields and YYYY year placeholder', async () => {
      ;(loggedCompletion as any).mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          brief: {
            destinations: ['顺德', '珠海'],
            days: 8,
            originCity: '北京',
            travelers: 3,
            preferences: ['当地特色景点', '必打卡景点', '亲子', '美食'],
            pace: null,
            budget: { amount: null, currency: 'CNY' },
            travelDates: { start: 'YYYY-05-02', end: 'YYYY-05-09' },
            notes: '2大1小',
          },
          intent: 'new',
          changedFields: [],
        })}}],
      })

      const res = await extractBrief(
        [{ role: 'user', content: BUG_INPUT, timestamp: 1 }],
        null,
      )

      expect(res.brief.destinations).toEqual(['顺德', '珠海'])
      expect(res.brief.travelers).toBe(3)
      expect(res.brief.travelDates?.start).toMatch(/^\d{4}-05-02$/)
      expect(res.brief.travelDates?.end).toMatch(/^\d{4}-05-09$/)
      expect(res.brief.preferences).toContain('亲子')
      expect(res.brief.preferences).toContain('美食')
      expect(res.brief.pace).toBeUndefined()
      expect(res.brief.budget?.amount).toBeUndefined()
    })

    it('Variant B: regex fallback alone produces a usable brief when LLM throws', async () => {
      ;(loggedCompletion as any).mockRejectedValue(new Error('boom'))

      const res = await extractBrief(
        [{ role: 'user', content: BUG_INPUT, timestamp: 1 }],
        null,
      )

      expect(res.brief.destinations).toEqual(expect.arrayContaining(['顺德', '珠海']))
      expect(res.brief.travelers).toBe(3)
      expect(res.brief.travelDates?.start).toMatch(/^\d{4}-05-02$/)
      expect(res.brief.travelDates?.end).toMatch(/^\d{4}-05-09$/)
      expect(res.brief.preferences).toEqual(expect.arrayContaining(['亲子', '美食']))
    })

    it('Variant C: clean LLM output passes through with proper 2026 dates', async () => {
      ;(loggedCompletion as any).mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          brief: {
            destinations: ['顺德', '珠海'],
            days: 8,
            originCity: '北京',
            travelers: 3,
            preferences: ['亲子', '美食'],
            travelDates: { start: '2026-05-02', end: '2026-05-09' },
          },
          intent: 'new',
          changedFields: [],
        })}}],
      })

      const res = await extractBrief(
        [{ role: 'user', content: BUG_INPUT, timestamp: 1 }],
        null,
      )

      expect(res.brief.travelDates?.start).toBe('2026-05-02')
      expect(res.brief.travelDates?.end).toBe('2026-05-09')
      expect(res.brief.destinations).toEqual(['顺德', '珠海'])
      expect(res.brief.travelers).toBe(3)
      expect(res.brief.days).toBe(8)
    })

    it('user message includes Today is YYYY-MM-DD anchor', async () => {
      ;(loggedCompletion as any).mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          brief: { destinations: ['顺德'], days: 3 },
          intent: 'new',
          changedFields: [],
        })}}],
      })

      await extractBrief(
        [{ role: 'user', content: '去顺德玩3天', timestamp: 1 }],
        null,
      )

      const callParams = (loggedCompletion as any).mock.calls.at(-1)[1]
      const userMsgContent: string = callParams.messages[1].content
      expect(userMsgContent).toMatch(/^Today is \d{4}-\d{2}-\d{2}\.\n/)
    })
  })
})
