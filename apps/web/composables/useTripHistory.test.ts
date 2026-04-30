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
})
