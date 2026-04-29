import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../prefetch.js', () => ({
  prefetchFlyaiContext: vi.fn(),
}))

vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { prefetchContextTool } from './prefetch-context.tool.js'
import { prefetchFlyaiContext } from '../prefetch.js'
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
})

describe('prefetchContextTool', () => {
  it('returns actionable nudge when neither input nor session has a brief', async () => {
    const session = baseSession()
    const emit = vi.fn().mockResolvedValue(undefined)
    const result = await prefetchContextTool.call({}, session, emit)
    expect(result).toEqual({
      type: 'ok',
      output: expect.stringContaining('call_extractor'),
    })
    expect(prefetchFlyaiContext).not.toHaveBeenCalled()
  })

  it('reads session.brief when input is empty', async () => {
    const session = baseSession()
    session.brief = makeBrief({ destinations: ['顺德', '珠海'] })
    ;(prefetchFlyaiContext as any).mockResolvedValue(['ctx1', 'ctx2'])
    const emit = vi.fn().mockResolvedValue(undefined)

    const result = await prefetchContextTool.call({}, session, emit)
    expect(prefetchFlyaiContext).toHaveBeenCalledWith(session.brief, session.id)
    expect(session.prefetchContext).toEqual(['ctx1', 'ctx2'])
    expect(result.type).toBe('ok')
    if (result.type === 'ok') {
      expect(result.output).toContain('Prefetched 2')
    }
  })

  it('prefers the input brief over session.brief when both are present', async () => {
    const session = baseSession()
    session.brief = makeBrief({ destinations: ['session-dest'] })
    const overrideBrief = makeBrief({ destinations: ['override-dest'] })
    ;(prefetchFlyaiContext as any).mockResolvedValue(['ctx'])
    const emit = vi.fn().mockResolvedValue(undefined)

    await prefetchContextTool.call({ brief: overrideBrief }, session, emit)
    expect(prefetchFlyaiContext).toHaveBeenCalledWith(overrideBrief, session.id)
  })

  it('returns nudge (no crash) when session.brief has empty destinations', async () => {
    const session = baseSession()
    session.brief = makeBrief({ destinations: [] })
    const emit = vi.fn().mockResolvedValue(undefined)

    const result = await prefetchContextTool.call({}, session, emit)
    expect(result.type).toBe('ok')
    if (result.type === 'ok') {
      expect(result.output).toContain('call_extractor')
    }
    expect(prefetchFlyaiContext).not.toHaveBeenCalled()
  })
})
