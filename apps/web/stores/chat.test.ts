import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Message, Plan } from '@travel-agent/shared'
import { sanitizePersistedState, useChatStore } from './chat'

describe('chat store history hydration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('collapses oversized assistant markdown history into a compact placeholder', () => {
    const store = useChatStore()
    const messages: Message[] = [
      {
        role: 'user',
        content: '帮我规划一下',
        timestamp: 1,
      },
      {
        role: 'assistant',
        content: '下面是完整方案：\n\n## Day 1\n- 早餐\n- 午餐\n- 晚餐\n**提示**\n' + '更多内容 '.repeat(80),
        timestamp: 2,
      },
    ]

    store.hydrateFromSessionMessages(messages)

    expect(store.messages).toHaveLength(3)
    expect(store.messages[2]?.content).toBe('✅ 行程已生成')
  })

  it('restores result phase when a persisted plan exists', () => {
    const plan: Plan = {
      title: '已生成行程',
      destinations: ['顺德'],
      days: 3,
      travelers: 2,
      pace: 'balanced',
      preferences: [],
      dailyPlans: [{ day: 1, items: [] }, { day: 2, items: [] }, { day: 3, items: [] }],
      tips: [],
      disclaimer: 'x',
    }

    const sanitized = sanitizePersistedState({
      sessionId: 'session-1',
      draft: '',
      phase: 'error',
      agentStatus: '生成失败',
      streamSteps: [],
      errorMessage: '连接中断，请重试',
      messages: [],
      plan,
      pendingSelections: [],
    })

    expect(sanitized.phase).toBe('result')
    expect(sanitized.agentStatus).toBe('登录后继续调整行程')
  })

  it('drops stale system error bubbles when a persisted plan exists', () => {
    const plan: Plan = {
      title: '已生成行程',
      destinations: ['顺德'],
      days: 3,
      travelers: 2,
      pace: 'balanced',
      preferences: [],
      dailyPlans: [{ day: 1, items: [] }, { day: 2, items: [] }, { day: 3, items: [] }],
      tips: [],
      disclaimer: 'x',
    }

    const sanitized = sanitizePersistedState({
      sessionId: 'session-1',
      draft: '',
      phase: 'error',
      agentStatus: '生成失败',
      streamSteps: [],
      errorMessage: '连接中断，请重试',
      messages: [
        { id: 'assistant-1', role: 'assistant', content: '✅ 行程已生成' },
        { id: 'system-1', role: 'system', content: '连接中断，请重试' },
      ] as any,
      plan,
      pendingSelections: [],
    })

    expect(sanitized.messages.map((message) => message.role)).not.toContain('system')
    expect(sanitized.errorMessage).toBe('')
  })
})
