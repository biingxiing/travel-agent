import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type { SessionState } from '@travel-agent/shared'
import { sendMessage, registerPersona, __resetPersonas } from './send-message.js'
import { ToolPool } from './tool-pool.js'
import { Trace } from './trace.js'

// Mock the LLM client so importing the runtime modules does not require LLM_BASE_URL/LLM_API_KEY env at test time
vi.mock('../../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  PLANNER_MODEL: 'fake-planner',
  FAST_MODEL: 'fake-fast',
  REASONING_EFFORT: undefined,
}))

vi.mock('../../llm/logger.js', () => ({
  loggedStream: vi.fn(async function* () {
    yield { choices: [{ delta: { content: '{"ok":true,"value":42}' } }] }
  }),
}))

const InSchema = z.object({ q: z.string() })
const OutSchema = z.object({ ok: z.boolean(), value: z.number() })

const stubSession = (): SessionState => ({
  id: 's1', userId: 'u', messages: [], status: 'draft',
  brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: 'run-1',
} as unknown as SessionState)

describe('sendMessage', () => {
  beforeEach(() => __resetPersonas())

  it('validates input, runs child engine, parses output', async () => {
    registerPersona({
      name: 'noop',
      systemPrompt: 'You output exactly: {"ok":true,"value":42}',
      InputSchema: InSchema,
      OutputSchema: OutSchema,
      buildMessages: (input) => [
        { role: 'system', content: 'You output exactly: {"ok":true,"value":42}' },
        { role: 'user', content: JSON.stringify(input) },
      ],
      tools: new ToolPool([]),
    })
    const session = stubSession()
    const trace = new Trace('run-1-send-test')
    const out = await sendMessage('noop', { q: 'hi' }, {
      session, parentRunId: 'run-1', parentPersona: 'orchestrator', trace, childIndex: 0,
    })
    expect(out).toEqual({ ok: true, value: 42 })
  })

  it('throws on input schema mismatch', async () => {
    registerPersona({
      name: 'noop2',
      systemPrompt: 'x',
      InputSchema: InSchema,
      OutputSchema: OutSchema,
      buildMessages: () => [{ role: 'system', content: 'x' }],
      tools: new ToolPool([]),
    })
    const session = stubSession()
    const trace = new Trace('run-1-send-test')
    await expect(sendMessage('noop2', { q: 123 } as unknown as { q: string }, {
      session, parentRunId: 'run-1', parentPersona: 'orchestrator', trace, childIndex: 0,
    })).rejects.toThrow(/Invalid|expected/i)
  })
})
