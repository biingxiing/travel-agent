import { describe, it, expect, vi } from 'vitest'

// Mock llm client to prevent startup error when env vars are missing
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { buildOrchestratorMessages } from './index.js'
import type { SessionState } from '@travel-agent/shared'

function baseSession(): SessionState {
  return {
    id: 's1', userId: 'u1', title: null, brief: null,
    messages: [], currentPlan: null, currentScore: null, currentEvaluation: null, status: 'draft',
    iterationCount: 0, lastRunId: null, pendingClarification: null,
    prefetchContext: [], language: 'zh',
    createdAt: 1, updatedAt: 1,
  }
}

describe('buildOrchestratorMessages', () => {
  it('produces a static system prompt first and a trailing dynamic state user message', () => {
    const msgs = buildOrchestratorMessages(baseSession())
    expect(msgs[0].role).toBe('system')
    const tail = msgs[msgs.length - 1] as { role: string; content: string }
    expect(tail.role).toBe('user')
    expect(tail.content).toContain('Session state:')
  })

  it('includes hasCurrentPlan in the state system message but omits the full currentPlan blob', () => {
    const session = baseSession()
    session.currentPlan = {
      title: 'test', destinations: ['北京'], days: 3, travelers: 1,
      pace: 'balanced', preferences: [], dailyPlans: [], tips: [], disclaimer: '',
    }
    const msgs = buildOrchestratorMessages(session)
    const stateContent = (msgs[msgs.length - 1] as { content: string }).content
    expect(stateContent).toContain('"hasCurrentPlan":true')
    expect(stateContent).not.toContain('"currentPlan"')
  })

  it('places conversation history between the static prompt and the trailing state message', () => {
    const session = baseSession()
    session.messages = [
      { role: 'user', content: '去上海3天', timestamp: 1 },
      { role: 'assistant', content: '已生成方案', timestamp: 2 },
      { role: 'user', content: '改一下第2天', timestamp: 3 },
    ]
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(5)
    expect(msgs[1]).toEqual({ role: 'user', content: '去上海3天' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: '已生成方案' })
    expect(msgs[3]).toEqual({ role: 'user', content: '改一下第2天' })
    expect((msgs[4] as { role: string }).role).toBe('user')
  })

  it('limits conversation history to 20 messages', () => {
    const session = baseSession()
    session.messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `msg ${i}`,
      timestamp: i,
    }))
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(22) // 1 static system + 20 conversation + 1 trailing state
  })

  it('filters out empty/whitespace-only messages', () => {
    const session = baseSession()
    session.messages = [
      { role: 'user', content: '去北京', timestamp: 1 },
      { role: 'assistant', content: '   ', timestamp: 2 },
      { role: 'user', content: '3天', timestamp: 3 },
    ]
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(4) // 1 static system + 2 non-empty + 1 trailing state
    expect(msgs[2]).toEqual({ role: 'user', content: '3天' })
  })

  it('no longer puts user messages in a single flat blob', () => {
    const session = baseSession()
    session.messages = [{ role: 'user', content: '北京 3 天', timestamp: 1 }]
    const msgs = buildOrchestratorMessages(session)
    // Old format would be a single user message containing "User messages:"
    const hasOldFormat = msgs.some(m =>
      m.role === 'user' && typeof m.content === 'string' && m.content.includes('User messages:')
    )
    expect(hasOldFormat).toBe(false)
  })
})
