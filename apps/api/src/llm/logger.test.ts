import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => ({ reasoningEffort: undefined as string | undefined }))

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
  get REASONING_EFFORT() {
    return mockState.reasoningEffort
  },
}))

vi.mock('../persistence/pg.js', () => ({
  isDatabaseEnabled: vi.fn(() => true),
  insertLLMCall: vi.fn().mockResolvedValue(undefined),
}))

import { llm } from '../llm/client.js'
import { insertLLMCall } from '../persistence/pg.js'
import { loggedCompletion, loggedStream, withSessionContext } from './logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockState.reasoningEffort = undefined
})

async function* singleChunk(content: string) {
  yield {
    choices: [{ delta: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }
}

describe('loggedCompletion', () => {
  it('returns assembled content and records the call', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('answer'))

    const result = await withSessionContext('sess-abc', 'run-123', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
      }),
    )

    expect(result.choices[0].message.content).toBe('answer')
    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'extractor',
        model: 'fake-fast',
        stream: true,
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

describe('reasoning_effort injection', () => {
  it('does NOT inject reasoning_effort when env is unset', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('ok'))

    await withSessionContext('s', 'r', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    const callArgs = (llm.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('reasoning_effort')
  })

  it('injects reasoning_effort=xhigh in loggedCompletion when env is set', async () => {
    mockState.reasoningEffort = 'xhigh'
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('ok'))

    await withSessionContext('s', 'r', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    const callArgs = (llm.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.reasoning_effort).toBe('xhigh')
    expect(callArgs.stream).toBe(true)
  })

  it('injects reasoning_effort=xhigh in loggedStream when env is set', async () => {
    mockState.reasoningEffort = 'xhigh'
    async function* fake() {
      yield { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], usage: null }
    }
    ;(llm.chat.completions.create as any).mockReturnValue(fake())

    await withSessionContext('s', 'r', async () => {
      for await (const _ of loggedStream('generator', {
        model: 'fake-plan',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        void _
      }
    })

    const callArgs = (llm.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.reasoning_effort).toBe('xhigh')
  })

  it('caller-provided reasoning_effort overrides env', async () => {
    mockState.reasoningEffort = 'xhigh'
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('ok'))

    await withSessionContext('s', 'r', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'low',
      } as any),
    )

    const callArgs = (llm.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.reasoning_effort).toBe('low')
  })

  it('logs effort=<value> in the console log line when set', async () => {
    mockState.reasoningEffort = 'xhigh'
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('ok'))
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withSessionContext('s', 'r', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    const lines = spy.mock.calls.map((args) => String(args[0]))
    spy.mockRestore()
    expect(lines.some((l) => l.includes('[llm]') && l.includes('effort=xhigh'))).toBe(true)
  })

  it('omits effort= when neither env nor caller set it', async () => {
    ;(llm.chat.completions.create as any).mockReturnValue(singleChunk('ok'))
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withSessionContext('s', 'r', () =>
      loggedCompletion('extractor', {
        model: 'fake-fast',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    const lines = spy.mock.calls.map((args) => String(args[0]))
    spy.mockRestore()
    const llmLine = lines.find((l) => l.includes('[llm] agent=extractor'))
    expect(llmLine).toBeDefined()
    expect(llmLine).not.toContain('effort=')
  })
})

describe('cached_tokens observability', () => {
  it('logs cached=N and passes cachedTokens to insertLLMCall when chunk has prompt_tokens_details', async () => {
    async function* fakeStreamWithCache() {
      yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }], usage: null }
      yield {
        choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      }
    }
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStreamWithCache())
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withSessionContext('s', 'r', async () => {
      for await (const _ of loggedStream('generator', {
        model: 'fake-plan',
        messages: [{ role: 'user', content: 'plan' }],
      })) {
        void _
      }
    })

    const lines = spy.mock.calls.map((args) => String(args[0]))
    spy.mockRestore()
    expect(lines.some((l) => l.includes('[llm]') && l.includes('cached=80'))).toBe(true)
    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({ cachedTokens: 80 }),
    )
  })

  it('omits cached= and passes cachedTokens=null when prompt_tokens_details absent', async () => {
    async function* fakeStreamNoCache() {
      yield {
        choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      }
    }
    ;(llm.chat.completions.create as any).mockReturnValue(fakeStreamNoCache())
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withSessionContext('s', 'r', async () => {
      for await (const _ of loggedStream('generator', {
        model: 'fake-plan',
        messages: [{ role: 'user', content: 'plan' }],
      })) {
        void _
      }
    })

    const lines = spy.mock.calls.map((args) => String(args[0]))
    spy.mockRestore()
    const llmLine = lines.find((l) => l.includes('[llm] agent=generator'))
    expect(llmLine).toBeDefined()
    expect(llmLine).not.toContain('cached=')
    expect(insertLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({ cachedTokens: null }),
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

  it('prints streamed tool_calls in verbose output', async () => {
    vi.resetModules()
    vi.stubEnv('LLM_VERBOSE', 'true')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const createMock = vi.fn().mockReturnValue((async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'tc1',
                function: {
                  name: 'call_extractor',
                  arguments: '{"messages":["顺德，珠海"]}',
                },
              }],
            },
            finish_reason: null,
          }],
          usage: null,
        }
        yield {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }
      })())

      vi.doMock('../llm/client.js', () => ({
        llm: { chat: { completions: { create: createMock } } },
        FAST_MODEL: 'fake-fast',
        PLANNER_MODEL: 'fake-plan',
        REASONING_EFFORT: undefined,
      }))
      vi.doMock('../persistence/pg.js', () => ({
        isDatabaseEnabled: vi.fn(() => true),
        insertLLMCall: vi.fn().mockResolvedValue(undefined),
      }))

      const { loggedStream: verboseLoggedStream, withSessionContext: verboseWithSessionContext } = await import('./logger.js')

      await verboseWithSessionContext('sess-stream', 'run-stream', async () => {
        for await (const _ of verboseLoggedStream('orchestrator', {
          model: 'fake-plan',
          messages: [{ role: 'user', content: 'plan trip' }],
          tools: [],
        })) {
          void _
        }
      })

      const logs = consoleSpy.mock.calls.map(args => String(args[0]))
      const outputLog = logs.find(line => line.includes('[llm:output] agent=orchestrator'))
      expect(outputLog).toContain('tool_calls:')
      expect(outputLog).toContain('call_extractor')
      expect(outputLog).toContain('\\"messages\\":[\\"顺德，珠海\\"]')
    } finally {
      consoleSpy.mockRestore()
      vi.unstubAllEnvs()
      vi.doUnmock('../llm/client.js')
      vi.doUnmock('../persistence/pg.js')
      vi.resetModules()
    }
  })
})
