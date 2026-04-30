import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../clarifier.js', () => ({
  generateClarification: vi.fn(),
}))

vi.mock('../../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { askClarificationTool } from './ask-clarification.tool.js'
import { generateClarification } from '../../clarifier.js'
import type { SessionState, TripBrief } from '@travel-agent/shared'

function baseSession(): SessionState {
  return {
    id: 's1', userId: 'u1', title: null, brief: null,
    messages: [], currentPlan: null, currentScore: null, currentEvaluation: null, status: 'draft',
    iterationCount: 0, lastRunId: null, pendingClarification: null,
    prefetchContext: [], language: 'zh',
    createdAt: 1, updatedAt: 1,
  }
}

function makeBrief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    destinations: ['顺德'],
    days: 3,
    travelers: 2,
    preferences: [],
    ...overrides,
  } as TripBrief
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(generateClarification as any).mockResolvedValue({
    question: '你打算什么时候出发？',
    defaultSuggestion: null,
  })
})

describe('askClarificationTool', () => {
  it('uses session.brief when input has no brief', async () => {
    const session = baseSession()
    session.brief = makeBrief({ destinations: ['顺德', '珠海'] })
    const emit = vi.fn().mockResolvedValue(undefined)

    await askClarificationTool.call(
      { reason: 'missing_dates', language: 'zh' },
      session,
      emit,
    )

    expect(generateClarification).toHaveBeenCalledTimes(1)
    const args = (generateClarification as any).mock.calls[0]
    // signature: (msgs, brief, reason, language)
    expect(args[1]).toBe(session.brief)
    expect(args[2]).toBe('missing_dates')
    expect(args[3]).toBe('zh')
  })

  it('prefers explicit input brief over session.brief', async () => {
    const session = baseSession()
    session.brief = makeBrief({ destinations: ['session-dest'] })
    const overrideBrief = makeBrief({ destinations: ['override-dest'] })
    const emit = vi.fn().mockResolvedValue(undefined)

    await askClarificationTool.call(
      { reason: 'missing_dates', brief: overrideBrief, language: 'zh' },
      session,
      emit,
    )
    const args = (generateClarification as any).mock.calls[0]
    expect(args[1]).toBe(overrideBrief)
  })

  it('passes undefined when neither input nor session has a brief', async () => {
    const session = baseSession()
    const emit = vi.fn().mockResolvedValue(undefined)

    await askClarificationTool.call(
      { reason: 'missing_destination', language: 'zh' },
      session,
      emit,
    )
    const args = (generateClarification as any).mock.calls[0]
    expect(args[1]).toBeUndefined()
  })

  it('updates session state and returns halt result', async () => {
    const session = baseSession()
    session.brief = makeBrief()
    const emit = vi.fn().mockResolvedValue(undefined)

    const result = await askClarificationTool.call(
      { reason: 'missing_dates', language: 'zh' },
      session,
      emit,
    )

    expect(session.status).toBe('awaiting_user')
    expect(session.pendingClarification).toBe('你打算什么时候出发？')
    expect(result).toEqual({ type: 'halt', reason: 'clarification_requested' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'clarify_needed',
      question: '你打算什么时候出发？',
      reason: 'missing_dates',
    }))
  })
})
