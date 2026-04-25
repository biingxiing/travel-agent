import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

vi.mock('../persistence/pg.js', () => ({
  isDatabaseEnabled: vi.fn(() => true),
  insertLLMCall: vi.fn().mockResolvedValue(undefined),
}))

import { llm } from '../llm/client.js'
import { insertLLMCall } from '../persistence/pg.js'
import { loggedCompletion, loggedStream, withSessionContext } from './logger.js'

beforeEach(() => vi.clearAllMocks())

describe('loggedCompletion', () => {
  it('returns the response and records the call', async () => {
    const mockResp = {
      choices: [{ message: { content: 'answer', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }
    ;(llm.chat.completions.create as any).mockResolvedValue(mockResp)

    const result = await withSessionContext('sess-abc', 'run-123', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
      }),
    )

    expect(result).toBe(mockResp)
    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'extractor',
        model: 'fake-fast',
        stream: false,
        ok: true,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        sessionId: 'sess-abc',
        runId: 'run-123',
      }),
    )
  })

  it('records the error and re-throws', async () => {
    ;(llm.chat.completions.create as any).mockRejectedValue(
      Object.assign(new Error('rate_limit'), { code: 'rate_limit_exceeded' }),
    )

    await expect(
      withSessionContext('sess-err', 'run-err', () =>
        loggedCompletion('critic', {
          model: 'fake-fast',
          messages: [],
          temperature: 0,
        }),
      ),
    ).rejects.toThrow('rate_limit')

    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        errorMessage: 'rate_limit',
        errorCode: 'rate_limit_exceeded',
      }),
    )
  })
})

describe('loggedStream', () => {
  it('passes chunks through and records the assembled response', async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }], usage: null }
      yield {
        choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }
    }
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStream())

    const chunks: unknown[] = []
    await withSessionContext('sess-stream', 'run-stream', async () => {
      for await (const chunk of loggedStream('generator', {
        model: 'fake-plan',
        messages: [{ role: 'user', content: 'plan trip' }],
        temperature: 0.7,
      })) {
        chunks.push(chunk)
      }
    })

    expect(chunks).toHaveLength(2)
    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'generator',
        stream: true,
        ok: true,
        promptTokens: 10,
        completionTokens: 2,
        response: expect.objectContaining({ content: 'Hello world' }),
        sessionId: 'sess-stream',
        runId: 'run-stream',
      }),
    )
  })
})
