import { describe, it, expect, vi } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { QueryEngine } from './query-engine.js'
import { ToolPool } from './tool-pool.js'
import { Trace } from './trace.js'

// Mock the LLM client so importing query-engine.js does not require LLM_BASE_URL/LLM_API_KEY env at test time
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

// Mock loggedStream
vi.mock('../../llm/logger.js', () => ({
  loggedStream: vi.fn(),
}))
import { loggedStream } from '../../llm/logger.js'

function fakeStreamYielding(chunks: string[]) {
  return (async function* () {
    for (const c of chunks) {
      yield { choices: [{ delta: { content: c } }] }
    }
  })()
}

const stubSession = (): SessionState => ({
  id: 's1', userId: 'u', messages: [], status: 'draft',
  brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: 'run-1',
  // Other persistable fields default to undefined / empty
} as unknown as SessionState)

describe('QueryEngine — streaming', () => {
  it('accumulates content from chunked LLM stream', async () => {
    vi.mocked(loggedStream).mockReturnValueOnce(fakeStreamYielding(['hello ', 'world']))
    const session = stubSession()
    const engine = new QueryEngine({
      persona: 'orchestrator',
      pool: new ToolPool([]),
      session,
      runId: 'run-1',
      messages: [{ role: 'system', content: 'sys' }],
      trace: new Trace('run-1-test'),
    })
    const out = await engine.run()
    expect(out.fullContent).toBe('hello world')
    expect(out.toolCalls).toHaveLength(0)
  })

  it('halts when session.lastRunId no longer matches its runId', async () => {
    vi.mocked(loggedStream).mockReturnValueOnce(fakeStreamYielding(['a']))
    const session = stubSession()
    session.lastRunId = 'preempted'
    const engine = new QueryEngine({
      persona: 'orchestrator',
      pool: new ToolPool([]),
      session,
      runId: 'run-1',                          // does not match
      messages: [{ role: 'system', content: 'sys' }],
      trace: new Trace('run-1-test'),
    })
    const out = await engine.run()
    expect(out.cancelled).toBe(true)
  })
})

import type { Tool } from './tool-pool.js'

function makeTool(name: string, opts: { concurrent?: boolean; output?: string; halt?: boolean; throw?: string } = {}): Tool {
  return {
    name,
    description: name,
    parametersSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    isConcurrencySafe: () => opts.concurrent ?? true,
    call: async () => {
      if (opts.throw) throw new Error(opts.throw)
      if (opts.halt) return { type: 'halt', reason: 'clarification_requested' }
      return { type: 'ok', output: opts.output ?? `out-${name}` }
    },
  }
}

describe('QueryEngine — tool dispatch', () => {
  it('runs concurrent-safe tools in parallel', async () => {
    const pool = new ToolPool([makeTool('a'), makeTool('b')])
    const engine = new QueryEngine({
      persona: 'orchestrator', pool, session: stubSession(),
      runId: 'r', messages: [], trace: new Trace('r-test'),
    })
    const calls = [
      { id: '1', name: 'a', arguments: '{}', input: {} },
      { id: '2', name: 'b', arguments: '{}', input: {} },
    ]
    const { toolResultMessages, halt } = await engine.dispatchToolCalls(calls, async () => undefined as unknown as never)
    expect(halt).toBe(false)
    expect(toolResultMessages).toHaveLength(2)
    expect(toolResultMessages[0]!.content).toContain('out-a')
    expect(toolResultMessages[1]!.content).toContain('out-b')
  })

  it('halts on first halt result', async () => {
    const pool = new ToolPool([makeTool('a', { halt: true })])
    const engine = new QueryEngine({
      persona: 'orchestrator', pool, session: stubSession(),
      runId: 'r', messages: [], trace: new Trace('r-test'),
    })
    const { halt } = await engine.dispatchToolCalls(
      [{ id: '1', name: 'a', arguments: '{}', input: {} }],
      async () => undefined as unknown as never,
    )
    expect(halt).toBe(true)
  })

  it('returns parseError as a tool result instead of throwing', async () => {
    const pool = new ToolPool([makeTool('a')])
    const engine = new QueryEngine({
      persona: 'orchestrator', pool, session: stubSession(),
      runId: 'r', messages: [], trace: new Trace('r-test'),
    })
    const { toolResultMessages } = await engine.dispatchToolCalls(
      [{ id: '1', name: 'a', arguments: '{not json', parseError: 'bad' }],
      async () => undefined as unknown as never,
    )
    expect(toolResultMessages[0]!.content).toMatch(/invalid JSON/)
  })

  it('captures throw as Tool error message', async () => {
    const pool = new ToolPool([makeTool('a', { throw: 'boom' })])
    const engine = new QueryEngine({
      persona: 'orchestrator', pool, session: stubSession(),
      runId: 'r', messages: [], trace: new Trace('r-test'),
    })
    const { toolResultMessages } = await engine.dispatchToolCalls(
      [{ id: '1', name: 'a', arguments: '{}', input: {} }],
      async () => undefined as unknown as never,
    )
    expect(toolResultMessages[0]!.content).toMatch(/Tool error: boom/)
  })
})
