import { describe, expect, it } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { entryFromSession } from './useTripHistory'

describe('entryFromSession', () => {
  const baseSession: SessionState = {
    id: 'session-1',
    userId: 'user-1',
    title: null,
    brief: null,
    messages: [],
    currentPlan: null,
    currentScore: null,
    currentEvaluation: null,
    status: 'draft',
    iterationCount: 0,
    lastRunId: null,
    pendingClarification: null,
    prefetchContext: [],
    language: 'zh',
    createdAt: 1,
    updatedAt: 1,
  }

  it('drops draft sessions that have no brief and no generated plan', () => {
    const entry = entryFromSession({
      ...baseSession,
      messages: [{ role: 'user', content: '只是发出一条消息', timestamp: 1 }],
    })

    expect(entry).toBeNull()
  })

  it('keeps sessions that already have a structured brief', () => {
    const entry = entryFromSession({
      ...baseSession,
      brief: {
        destinations: ['顺德', '珠海'],
        days: 8,
        travelers: 3,
        preferences: ['美食'],
      },
      messages: [{ role: 'user', content: '顺德珠海', timestamp: 1 }],
    })

    expect(entry?.destination).toBe('顺德 / 珠海')
  })

  it('keeps sessions with status planning even when they have no brief or plan', () => {
    const entry = entryFromSession({
      ...baseSession,
      status: 'planning',
      messages: [{ role: 'user', content: '帮我规划三亚五天', timestamp: 1 }],
    })
    expect(entry).not.toBeNull()
    expect(entry?.status).toBe('planning')
  })

  it('derives title from first user message for in-progress sessions', () => {
    const entry = entryFromSession({
      ...baseSession,
      status: 'refining',
      messages: [{ role: 'user', content: '我想去成都吃火锅，四天三夜', timestamp: 1 }],
    })
    expect(entry?.title).toBe('我想去成都吃火锅，四天三夜')
  })

  it('truncates long user messages to 40 chars with ellipsis', () => {
    const longMessage = '我想去一个非常非常非常遥远的地方旅行，具体来说是想去新疆看看大漠孤烟'
    const entry = entryFromSession({
      ...baseSession,
      status: 'awaiting_user',
      messages: [{ role: 'user', content: longMessage, timestamp: 1 }],
    })
    expect(entry?.title).toBe(longMessage.slice(0, 40) + '…')
  })

  it('falls back to 规划中… when in-progress session has no user message', () => {
    const entry = entryFromSession({
      ...baseSession,
      status: 'planning',
      messages: [],
    })
    expect(entry).not.toBeNull()
    expect(entry?.title).toBe('规划中…')
  })
})
