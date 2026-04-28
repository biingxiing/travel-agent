import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
  REASONING_EFFORT: undefined,
}))

vi.mock('../persistence/pg.js', () => ({
  isDatabaseEnabled: vi.fn(() => false),
  insertLLMCall: vi.fn().mockResolvedValue(undefined),
}))

import { llm } from '../llm/client.js'
import { generateClarification } from './clarifier.js'

const emptyBrief = { destinations: [], days: 0, travelers: 1, preferences: [] }
const briefWithDest = { destinations: ['成都'], days: 0, travelers: 1, preferences: [] }
const briefComplete = { destinations: ['成都'], days: 5, travelers: 1, preferences: [] }

async function* fakeStream(content: string) {
  yield {
    choices: [{ delta: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('generateClarification', () => {
  it('missing destinations: returns non-empty question, null defaultSuggestion', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStream('你想去哪里旅行？'))
    const result = await generateClarification([], emptyBrief, 'missing_destination')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toBeNull()
  })

  it('missing days: returns non-empty question, defaultSuggestion includes "5"', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStream('你打算玩几天？'))
    const result = await generateClarification([], briefWithDest, 'missing_days')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toMatch(/5/)
  })

  it('missing dates: returns non-empty question, defaultSuggestion includes a date', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStream('你打算什么时候出发？'))
    const result = await generateClarification([], briefComplete, 'missing_dates')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('LLM failure: returns fallback string, does not throw', async () => {
    ;(llm.chat.completions.create as any).mockRejectedValue(new Error('network error'))
    const result = await generateClarification([], emptyBrief, 'missing_destination')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toBeNull()
  })
})
