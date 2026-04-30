// apps/api/src/agents/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock llm client to prevent startup error when env vars are missing
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

// Mock persistence to prevent DB errors in tests
vi.mock('../persistence/pg.js', () => ({
  isDatabaseEnabled: vi.fn(() => false),
  insertLLMCall: vi.fn().mockResolvedValue(undefined),
}))

// Mock loggedStream — controls orchestrator behavior
vi.mock('../llm/logger.js', () => ({
  loggedStream: vi.fn(),
  withSessionContext: (_sid: unknown, _rid: unknown, fn: () => unknown) => fn(),
}))

// Mock all subagent tool implementations (not the tools themselves — just their underlying fns)
vi.mock('./extractor.js', () => ({ extractBrief: vi.fn() }))
vi.mock('./generator.js', () => ({
  runInitial: vi.fn(),
}))
vi.mock('./prefetch.js', () => ({
  prefetchFlyaiContext: vi.fn(async () => []),
}))
vi.mock('./clarifier.js', () => ({
  generateClarification: vi.fn(async (_msgs: any, _brief: any, reason: string) => ({
    question: `clarify: ${reason}`,
    defaultSuggestion: null,
  })),
}))

import { runReactLoop } from './react-loop.js'
import { loggedStream } from '../llm/logger.js'
import { extractBrief } from './extractor.js'
import { runInitial } from './generator.js'
import type { SessionState, Plan } from '@travel-agent/shared'

const samplePlan: Plan = {
  title: 't', destinations: ['d'], days: 1, travelers: 1, pace: 'balanced',
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x',
}

function sampleBrief() {
  return {
    destinations: ['北京'], days: 3, travelers: 1, preferences: [],
    travelDates: { start: '2025-01-01', end: '2025-01-04' },
  }
}

async function* makeChunks(toolCalls: Array<{ id: string; name: string; args: string }>, content = '') {
  if (content) {
    yield { choices: [{ delta: { content }, finish_reason: null }] }
  }
  if (toolCalls.length > 0) {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: i, id: tc.id, type: 'function',
              function: { name: tc.name, arguments: tc.args },
            }],
          },
          finish_reason: null,
        }],
      }
    }
    yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  } else {
    yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

function baseSession(): SessionState {
  return {
    id: 's1', userId: 'u1', title: null, brief: null,
    messages: [{ role: 'user', content: '北京 3 天', timestamp: 1 }],
    currentPlan: null, status: 'draft',
    lastRunId: 'r1', pendingClarification: null,
    prefetchContext: [], language: 'zh',
    createdAt: 1, updatedAt: 1,
  }
}

describe('runReactLoop (ReAct)', () => {
  const noopEmit = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits done when orchestrator produces no tool calls', async () => {
    ;(loggedStream as any).mockImplementation(() => makeChunks([], 'Done!'))

    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1', noopEmit))

    expect(events.some(e => e.type === 'done')).toBe(true)
    expect(session.status).toBe('converged')
  })

  it('calls extractor tool when orchestrator requests it', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })

    // Turn 1: orchestrator calls call_extractor
    // Turn 2: orchestrator produces no tool calls (done)
    ;(loggedStream as any)
      .mockImplementationOnce(() => makeChunks([{
        id: 'tc1', name: 'call_extractor',
        args: JSON.stringify({ messages: ['北京 3 天'] }),
      }]))
      .mockImplementationOnce(() => makeChunks([], 'Plan created!'))

    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1', noopEmit))

    expect(extractBrief).toHaveBeenCalledTimes(1)
    expect(session.brief?.destinations).toEqual(['北京'])
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('calls clarifier when orchestrator requests missing info', async () => {
    // Turn 1: orchestrator calls call_clarifier
    ;(loggedStream as any).mockImplementationOnce(() => makeChunks([{
      id: 'tc1', name: 'call_clarifier',
      args: JSON.stringify({ reason: 'missing_destination', brief: {}, language: 'zh' }),
    }]))

    const session = baseSession()
    const emittedEvents: any[] = []
    const captureEmit = async (e: any) => { emittedEvents.push(e) }

    const yieldedEvents = await collect(runReactLoop(session, 'r1', captureEmit))

    // clarify_needed emitted directly via emit fn (not yielded from generator)
    expect(emittedEvents.some(e => e.type === 'clarify_needed')).toBe(true)
    // Loop halts but still emits done so the frontend exits loading state
    expect(yieldedEvents.some(e => e.type === 'done')).toBe(true)
    expect(session.status).toBe('awaiting_user')
  })

  it('aborts when runId mismatches mid-loop', async () => {
    const session = baseSession()  // declare first so mock closure can reference it
    let callCount = 0
    ;(loggedStream as any).mockImplementation(async function*() {
      callCount++
      if (callCount === 1) {
        // Turn 1: return a tool call
        yield* makeChunks([{ id: 'tc1', name: 'call_extractor', args: '{"messages":[]}' }])
      } else {
        yield* makeChunks([], 'done')
      }
    })
    ;(extractBrief as any).mockImplementation(async () => {
      // Simulate cancellation: new run started while extractor runs
      session.lastRunId = 'r2'
      return { brief: sampleBrief(), intent: 'new', changedFields: [] }
    })
    const events = await collect(runReactLoop(session, 'r1', noopEmit))

    // Loop should stop after the cancellation check
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('emits done with converged=true when MAX_TURNS exceeded', async () => {
    // Always return the same tool call to exhaust MAX_TURNS
    ;(loggedStream as any).mockImplementation(() => makeChunks([{
      id: 'tc1', name: 'call_extractor', args: '{"messages":[]}',
    }]))
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })

    const session = baseSession()
    session.currentPlan = samplePlan

    const events = await collect(runReactLoop(session, 'r1', noopEmit))
    expect(events.some(e => e.type === 'done')).toBe(true)
    expect(session.status).toBe('converged')
  })

  it('does not emit assistant_say when orchestrator narrates alongside tool calls', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })
    ;(loggedStream as any)
      .mockImplementationOnce(() => makeChunks(
        [{ id: 'tc1', name: 'call_extractor', args: '{"messages":[]}' }],
        '让我先理解一下你的需求…',
      ))
      .mockImplementationOnce(() => makeChunks([], 'Done!'))

    const session = baseSession()
    const emitted: any[] = []
    await collect(runReactLoop(session, 'r1', async (e) => { emitted.push(e) }))

    // When tool calls are present, narrative text is internal reasoning — do NOT surface it
    const sayEvents = emitted.filter(e => e.type === 'assistant_say')
    expect(sayEvents).toHaveLength(0)
  })

  it('does not emit assistant_say when content is empty', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })
    ;(loggedStream as any)
      .mockImplementationOnce(() => makeChunks(
        [{ id: 'tc1', name: 'call_extractor', args: '{"messages":[]}' }],
        '',
      ))
      .mockImplementationOnce(() => makeChunks([], 'Done!'))

    const session = baseSession()
    const emitted: any[] = []
    await collect(runReactLoop(session, 'r1', async (e) => { emitted.push(e) }))

    expect(emitted.some(e => e.type === 'assistant_say')).toBe(false)
  })

  it('passes parseError to tool_result when tool args are malformed JSON', async () => {
    ;(loggedStream as any)
      .mockImplementationOnce(() => makeChunks([{
        id: 'tc1', name: 'call_extractor', args: '{not valid json',
      }]))
      .mockImplementationOnce(() => makeChunks([], 'Recovered!'))

    const session = baseSession()
    await collect(runReactLoop(session, 'r1', noopEmit))

    // Extractor must NOT have been called — parseError short-circuits it
    expect(extractBrief).not.toHaveBeenCalled()
  })

  it('emits done on MAX_TURNS exit', async () => {
    ;(loggedStream as any).mockImplementation(() => makeChunks([{
      id: 'tc1', name: 'call_extractor', args: '{"messages":[]}',
    }]))
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })

    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1', noopEmit))
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('emits done when cancelled mid-loop', async () => {
    const session = baseSession()
    let callCount = 0
    ;(loggedStream as any).mockImplementation(async function*() {
      callCount++
      if (callCount === 1) {
        yield* makeChunks([{ id: 'tc1', name: 'call_extractor', args: '{"messages":[]}' }])
      } else {
        yield* makeChunks([], 'unreached')
      }
    })
    ;(extractBrief as any).mockImplementation(async () => {
      session.lastRunId = 'r2'
      return { brief: sampleBrief(), intent: 'new', changedFields: [] }
    })
    const events = await collect(runReactLoop(session, 'r1', noopEmit))
    expect(events.some(e => e.type === 'done')).toBe(true)
  })
})
