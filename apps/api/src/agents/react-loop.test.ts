import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionState } from '@travel-agent/shared'

// Mock LLM client so importing react-loop (and its transitive tool/persona modules)
// does not require LLM_BASE_URL / LLM_API_KEY env at test time.
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

// Mock persistence so any incidental save attempts don't try to hit Postgres.
vi.mock('../persistence/pg.js', () => ({
  isDatabaseEnabled: vi.fn(() => false),
  insertLLMCall: vi.fn().mockResolvedValue(undefined),
}))

// Mock loggedStream / loggedCompletion — controls orchestrator (and any transitive) LLM behavior.
vi.mock('../llm/logger.js', () => ({
  loggedStream: vi.fn(),
  loggedCompletion: vi.fn(async () => ({ choices: [{ message: { content: '' } }] })),
  withSessionContext: (_sid: unknown, _rid: unknown, fn: () => unknown) => fn(),
}))

import { runReactLoop } from './react-loop.js'
import { loggedStream } from '../llm/logger.js'

function fakeStream(turns: Array<{ content?: string; toolCalls?: { id: string; name: string; args: string }[] }>) {
  let i = 0
  vi.mocked(loggedStream).mockImplementation(() => {
    const t = turns[i++] ?? { content: '' }
    return (async function* () {
      if (t.content) yield { choices: [{ delta: { content: t.content } }] }
      if (t.toolCalls) {
        for (const [idx, c] of t.toolCalls.entries()) {
          yield {
            choices: [{
              delta: {
                tool_calls: [{ index: idx, id: c.id, function: { name: c.name, arguments: c.args } }],
              },
            }],
          }
        }
      }
    })() as unknown as ReturnType<typeof loggedStream>
  })
}

const stubSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 's1', userId: 'u', messages: [{ id: 'm1', role: 'user', content: '去东京玩 5 天', ts: 1 }],
  status: 'draft', brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: 'run-1', compactedHistory: null,
  ...overrides,
} as unknown as SessionState)

async function collect(gen: AsyncGenerator<unknown, void, void>) {
  const events: unknown[] = []
  for await (const e of gen) events.push(e)
  return events
}

describe('runReactLoop (v2.0)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('converges immediately when the orchestrator emits no tool calls', async () => {
    fakeStream([{ content: '行程规划已完成。' }])
    const session = stubSession()
    const events = await collect(runReactLoop(session, 'run-1', async () => {}))
    const done = events.at(-1) as { type: string; converged?: boolean }
    expect(done.type).toBe('done')
    expect(done.converged).toBe(true)
    expect(events.some((e) => (e as { type: string }).type === 'token')).toBe(true)
  })

  it('halts and emits done when session.lastRunId is preempted', async () => {
    fakeStream([{ content: 'starting…' }])
    const session = stubSession({ lastRunId: 'preempted' })
    const events = await collect(runReactLoop(session, 'run-1', async () => {}))
    expect((events.at(-1) as { type: string }).type).toBe('done')
  })
})
