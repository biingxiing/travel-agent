# v2.0 Harness & Multi-Agent Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/api/src/agents/` as a Claude-Code-style star-topology multi-agent runtime. v2.0 ships behavioural parity with the current pipeline plus the new structural primitives (QueryEngine, SendMessage, typed I/O, persona modules, JSONL trace).

**Architecture:** A single `Orchestrator` main agent runs the user-facing ReAct loop. Its tool pool contains `extract_brief` / `generate_plan` / `ask_clarification` (LLM-call wrappers) plus `start_research` (the bridge that spawns a `Researcher` LocalAgent subagent via `sendMessage`). The Researcher runs its own ReAct sub-loop with its own tool pool (in v2.0: just `prefetch_context`) and returns a typed result. Each agent session is a `QueryEngine` instance with isolated context, tool pool, trace stream, and cancellation hook. Multiple researchers may be spawned concurrently per orchestrator turn (`Promise.all` over `sendMessage` calls).

**Tech Stack:** TypeScript (strict), Hono, OpenAI-compatible LLM client, zod schemas, vitest. No new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-01-v2-harness-multi-agent-design.md`

---

## Phasing

| Phase | Tasks | Commits | Goal |
|---|---|---|---|
| 1 | 1–2 | 2 | New SSE schema + frontend compiles |
| 2 | 3–7 | 5 | Runtime primitives in place, fully tested |
| 3 | 8–10 | 3 | Persona modules ready |
| 4 | 11–14 | 4 | Researcher pool + Orchestrator pool tools |
| 5 | 15 | 1 | start_research bridge |
| 6 | 16–18 | 3 | Integration: react-loop, routes, frontend |
| 7 | 19 | 1 | Dev trace endpoint |
| 8 | 20–21 | 2 | Cleanup + final verification |

---

## Phase 1 — SSE Schema Pruning

### Task 1: Reduce `events.ts` to v2.0 minimal set

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`

The v2.0 schema keeps 8 variants and deletes 6 (the four dead variants, the `tool_reasoning` variant, and `heartbeat`). Subagent visibility piggybacks on `agent_step` by adding `'researcher'` as an allowed agent value (the `agent` field is already `z.string()` so this is a documentation change, not a schema change).

Also delete the three orphan exports (`FollowupEventSchema`, `ItemOptionsEventSchema`, `BlockerTypeEnum` — actually `BlockerTypeEnum` is still used by `clarify_needed`, keep it).

- [ ] **Step 1: Update `events.test.ts` to assert the new variant set**

Replace the entire file `packages/shared/src/events.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { ChatStreamEventSchema } from './events.js'

const KEPT = [
  'session', 'agent_step', 'token', 'plan_partial',
  'plan', 'clarify_needed', 'done', 'error',
] as const
const REMOVED = [
  'tool_reasoning', 'assistant_say', 'followup', 'item_options', 'heartbeat',
] as const

describe('ChatStreamEventSchema (v2.0)', () => {
  it('contains exactly the kept 8 discriminator values', () => {
    // Walk the discriminated-union options and collect type literals
    const options = (ChatStreamEventSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options
    const got = options.map((o) => o.shape.type.value).sort()
    expect(got).toEqual([...KEPT].sort())
  })

  it('rejects removed variants', () => {
    for (const t of REMOVED) {
      const r = ChatStreamEventSchema.safeParse({ type: t })
      expect(r.success).toBe(false)
    }
  })

  it('accepts agent_step with agent="researcher"', () => {
    const r = ChatStreamEventSchema.safeParse({
      type: 'agent_step', agent: 'researcher', status: 'start',
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, expect it to fail**

```bash
pnpm --filter @travel-agent/shared exec vitest run src/events.test.ts
```

Expected: FAIL — current schema still contains `tool_reasoning`, `assistant_say`, `followup`, `item_options`, `heartbeat`.

- [ ] **Step 3: Edit `events.ts` to keep only 8 variants**

Replace `packages/shared/src/events.ts` with:

```ts
import { z } from 'zod'
import { PlanSchema, rawPlanShape } from './plan.js'

export const BlockerTypeEnum = z.enum([
  'missing_origin', 'missing_destination', 'missing_days',
  'missing_dates', 'missing_budget', 'unclear_preference', 'other',
])
export type BlockerType = z.infer<typeof BlockerTypeEnum>

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.string(), messageId: z.string() }),
  z.object({
    type: z.literal('agent_step'),
    // v2.0: 'orchestrator' | 'researcher' | legacy persona names. Kept open as string for forward-compat.
    agent: z.string(),
    skill: z.string().optional(),
    status: z.enum(['thinking', 'start', 'done', 'error']),
    input: z.any().optional(),
    output: z.any().optional(),
  }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({ type: z.literal('plan_partial'), plan: rawPlanShape.deepPartial() }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
    defaultSuggestion: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    messageId: z.string(),
    converged: z.boolean().optional(),
    usage: z.object({ prompt: z.number(), completion: z.number() }).optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @travel-agent/shared exec vitest run src/events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "feat(shared): reduce ChatStreamEvent to v2.0 8-variant set"
```

---

### Task 2: Make API + frontend compile against the pruned schema

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts:51` (delete `tool_reasoning` emit)
- Modify: `apps/api/src/routes/sessions.ts` (delete `heartbeat` emits — search for `type: 'heartbeat'`)
- Modify: `apps/web/stores/chat.ts` (delete handlers for removed variants)
- Modify: `apps/web/composables/useChatStream.ts` (if it references removed types)
- Search-and-delete: any component import of `FollowupEventSchema` / `ItemOptionsEventSchema`

This task is pure type-error elimination. Do NOT add behavioural changes; just remove the dead branches so `pnpm build` succeeds. Concerns about losing dev-mode keepalive (heartbeat) are deferred — modern HTTP/2 keeps SSE alive without it.

- [ ] **Step 1: Confirm current type errors**

```bash
pnpm build 2>&1 | head -100
```

Expected: many errors referring to removed event types in API + web.

- [ ] **Step 2: Delete `tool_reasoning` emission in `react-loop.ts`**

Open `apps/api/src/agents/react-loop.ts`. Find the block at line 46-52:

```ts
if (delta.content) {
  fullContent += delta.content
  // Per-chunk live preview (kept for future foldable "thinking" UI).
  // Final user-visible emission happens after the stream ends, based on
  // whether tool calls follow.
  await emit({ type: 'tool_reasoning', delta: delta.content } as ChatStreamEvent)
}
```

Replace with:

```ts
if (delta.content) {
  fullContent += delta.content
  // Subagent transparency policy: orchestrator's mid-stream reasoning is not
  // surfaced. Final user-visible 'token' emission happens after the stream ends.
}
```

(This file will be rewritten entirely in Task 16; the change here is just to make the module compile in the interim.)

- [ ] **Step 3: Delete heartbeat emission in `routes/sessions.ts`**

```bash
grep -n "type: 'heartbeat'\|type: \"heartbeat\"" apps/api/src/routes/sessions.ts
```

Remove the lines matched and any surrounding `setInterval` / `setTimeout` that exclusively existed to schedule the heartbeat. If the interval also schedules other work, only remove the heartbeat emit.

- [ ] **Step 4: Update frontend `stores/chat.ts`**

Open `apps/web/stores/chat.ts`. Search for the lines indexed in the audit (~253, 256, 267, 271, 273, 285, 290, 293, 300, 304, 312, 318) — find the switch/if cases dispatching on `event.type`. Delete the cases for: `tool_reasoning`, `assistant_say`, `followup`, `item_options`, `heartbeat`.

- [ ] **Step 5: Hunt remaining references**

```bash
grep -rn "tool_reasoning\|assistant_say\|FollowupEventSchema\|ItemOptionsEventSchema\|item_options\|'heartbeat'\|\"heartbeat\"" \
  apps/api/src apps/web --include='*.ts' --include='*.vue'
```

For each hit, delete the dead branch / import. Components that rendered followup or item_options UI should have those branches removed; their templates may also need cleanup — keep minimal: just delete v-if blocks bound to deleted event state. The PlanningPreview / ChatPanel UX continues to work because `clarify_needed` and `plan` still exist.

- [ ] **Step 6: Build all**

```bash
pnpm build
```

Expected: PASS (no type errors).

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
pnpm -r test
```

Expected: PASS or only pre-existing failures unrelated to events (note any in commit message).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/web
git commit -m "chore: drop removed SSE variants from emit + consume sites"
```

---

## Phase 2 — Runtime Primitives

### Task 3: `runtime/trace.ts` — JSONL writer

**Files:**
- Create: `apps/api/src/agents/runtime/trace.ts`
- Create: `apps/api/src/agents/runtime/trace.test.ts`

**Responsibility:** opens a per-runId append-only file at `apps/api/.traces/<runId>.jsonl`, exposes a `Trace` instance per run with `.event(obj)` for writing structured events, and `.close()` to flush. All trace writes are fire-and-forget (no awaiting from runtime hot path).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/runtime/trace.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { Trace, traceDir } from './trace.js'

const TEST_RUN = 'run-test-123'

describe('Trace', () => {
  beforeEach(async () => {
    await fs.rm(path.join(traceDir(), `${TEST_RUN}.jsonl`), { force: true })
  })
  afterEach(async () => {
    await fs.rm(path.join(traceDir(), `${TEST_RUN}.jsonl`), { force: true })
  })

  it('appends one JSON object per line and flushes on close', async () => {
    const t = new Trace(TEST_RUN)
    t.event({ agent: 'orchestrator', event: 'llm_call_start', model: 'gpt-5.4' })
    t.event({ agent: 'researcher#0', event: 'spawn', parent: 'orchestrator' })
    await t.close()
    const txt = await fs.readFile(path.join(traceDir(), `${TEST_RUN}.jsonl`), 'utf8')
    const lines = txt.trim().split('\n')
    expect(lines).toHaveLength(2)
    const a = JSON.parse(lines[0]!)
    const b = JSON.parse(lines[1]!)
    expect(a.agent).toBe('orchestrator')
    expect(a.event).toBe('llm_call_start')
    expect(typeof a.ts).toBe('string')
    expect(b.agent).toBe('researcher#0')
  })

  it('creates the .traces directory if missing', async () => {
    const t = new Trace(TEST_RUN)
    t.event({ agent: 'x', event: 'noop' })
    await t.close()
    await expect(fs.stat(traceDir())).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/trace.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runtime/trace.ts`**

Create `apps/api/src/agents/runtime/trace.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'

const TRACE_DIR = path.resolve(process.cwd(), '.traces')

export function traceDir(): string { return TRACE_DIR }

export interface TraceEvent {
  agent: string
  event: string
  [k: string]: unknown
}

export class Trace {
  private buf: string[] = []
  private writePromise: Promise<void> = Promise.resolve()
  private closed = false

  constructor(private readonly runId: string) {}

  event(obj: TraceEvent): void {
    if (this.closed) return
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'
    this.buf.push(line)
    // schedule flush (debounced via single in-flight chain)
    this.writePromise = this.writePromise.then(() => this.flushLocked())
  }

  private async flushLocked(): Promise<void> {
    if (this.buf.length === 0) return
    const chunk = this.buf.join('')
    this.buf = []
    await fs.mkdir(TRACE_DIR, { recursive: true })
    await fs.appendFile(path.join(TRACE_DIR, `${this.runId}.jsonl`), chunk, 'utf8')
  }

  async close(): Promise<void> {
    this.closed = false      // allow final flush
    await this.writePromise
    await this.flushLocked()
    this.closed = true
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/trace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add `.traces` to `.gitignore`**

```bash
grep -q "^\.traces" .gitignore || echo ".traces/" >> .gitignore
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/runtime/trace.ts apps/api/src/agents/runtime/trace.test.ts .gitignore
git commit -m "feat(api/runtime): add JSONL Trace writer"
```

---

### Task 4: `runtime/tool-pool.ts` — typed tool pool wrapper

**Files:**
- Create: `apps/api/src/agents/runtime/tool-pool.ts`
- Create: `apps/api/src/agents/runtime/tool-pool.test.ts`

**Responsibility:** lightweight typed wrapper around `SubagentTool[]`. Provides `find(name)`, `toOpenAITools()`, and an `isolate(other: ToolPool)` invariant so leaks across pools are caught in tests.

The new `SubagentTool` interface lives here (replaces the old one in `tools/types.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/runtime/tool-pool.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { ToolPool, type Tool } from './tool-pool.js'

const dummy = (name: string): Tool => ({
  name,
  description: `dummy ${name}`,
  parametersSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  isConcurrencySafe: () => true,
  call: async () => ({ type: 'ok', output: 'ok' }),
})

describe('ToolPool', () => {
  it('finds tools by name', () => {
    const p = new ToolPool([dummy('a'), dummy('b')])
    expect(p.find('a')?.name).toBe('a')
    expect(p.find('missing')).toBeUndefined()
  })

  it('emits OpenAI tool definitions', () => {
    const p = new ToolPool([dummy('a')])
    const ot = p.toOpenAITools()
    expect(ot).toHaveLength(1)
    expect(ot[0]!.type).toBe('function')
    expect(ot[0]!.function.name).toBe('a')
  })

  it('isolate() detects pool overlap', () => {
    const shared = dummy('overlap')
    const p1 = new ToolPool([shared, dummy('a')])
    const p2 = new ToolPool([shared, dummy('b')])
    expect(() => p1.assertDisjoint(p2)).toThrow(/overlap/)
  })

  it('isolate() passes for disjoint pools', () => {
    const p1 = new ToolPool([dummy('a')])
    const p2 = new ToolPool([dummy('b')])
    expect(() => p1.assertDisjoint(p2)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/tool-pool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runtime/tool-pool.ts`**

Create the file:

```ts
import type OpenAI from 'openai'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'

export type EmitFn = (event: ChatStreamEvent) => Promise<void>

export type ToolResult =
  | { type: 'ok'; output: string }
  | { type: 'halt'; reason: string }

export interface Tool {
  name: string
  description: string
  parametersSchema: Record<string, unknown>
  isConcurrencySafe: () => boolean
  call: (
    input: Record<string, unknown>,
    session: SessionState,
    emit: EmitFn,
  ) => Promise<ToolResult>
}

export class ToolPool {
  constructor(public readonly tools: readonly Tool[]) {}

  find(name: string): Tool | undefined {
    return this.tools.find((t) => t.name === name)
  }

  toOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
    return this.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersSchema,
      },
    }))
  }

  /** Throws if any tool name appears in both pools. Used in tests to guard isolation invariant. */
  assertDisjoint(other: ToolPool): void {
    const overlap = this.tools
      .map((t) => t.name)
      .filter((n) => other.tools.some((o) => o.name === n))
    if (overlap.length > 0) {
      throw new Error(`ToolPool overlap detected: ${overlap.join(', ')}`)
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/tool-pool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/runtime/tool-pool.ts apps/api/src/agents/runtime/tool-pool.test.ts
git commit -m "feat(api/runtime): add ToolPool with isolation invariant"
```

---

### Task 5: `runtime/query-engine.ts` (part 1) — LLM loop scaffolding

**Files:**
- Create: `apps/api/src/agents/runtime/query-engine.ts`
- Create: `apps/api/src/agents/runtime/query-engine.test.ts`

**Responsibility:** Single-agent lifecycle. Owns `messages`, `pool`, runs streaming LLM calls in a loop, accumulates content + tool_calls, dispatches tools, emits trace events, supports cancellation. This task implements the LLM streaming + cancellation; tool dispatch comes in Task 6.

- [ ] **Step 1: Write the failing test for streaming**

Create `apps/api/src/agents/runtime/query-engine.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { QueryEngine } from './query-engine.js'
import { ToolPool } from './tool-pool.js'
import { Trace } from './trace.js'

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
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/query-engine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runtime/query-engine.ts`**

```ts
import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { PLANNER_MODEL } from '../../llm/client.js'
import { loggedStream } from '../../llm/logger.js'
import type { ToolPool } from './tool-pool.js'
import type { Trace } from './trace.js'

export interface QueryEngineOptions {
  persona: string
  pool: ToolPool
  session: SessionState
  runId: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  trace: Trace
  model?: string
  temperature?: number
  maxTurns?: number
}

export interface RawToolCall { id: string; name: string; arguments: string; parseError?: string; input?: Record<string, unknown> }

export interface RunOutput {
  fullContent: string
  toolCalls: RawToolCall[]
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  cancelled: boolean
}

export class QueryEngine {
  constructor(public readonly opts: QueryEngineOptions) {}

  private isCancelled(): boolean {
    return this.opts.session.lastRunId !== this.opts.runId
  }

  /** Single LLM stream pass. Returns assistant message + tool_calls, or cancelled flag. */
  async run(): Promise<RunOutput> {
    const { persona, pool, messages, trace, model, temperature } = this.opts
    if (this.isCancelled()) {
      return {
        fullContent: '',
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: '' },
        cancelled: true,
      }
    }

    trace.event({ agent: persona, event: 'llm_call_start', model: model ?? PLANNER_MODEL })

    let fullContent = ''
    const raw = new Map<number, { id: string; name: string; arguments: string }>()

    for await (const chunk of loggedStream(persona, {
      model: model ?? PLANNER_MODEL,
      messages,
      tools: pool.toOpenAITools(),
      tool_choice: 'auto',
      temperature: temperature ?? 0.3,
    })) {
      if (this.isCancelled()) break
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) fullContent += delta.content
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          const e = raw.get(idx) ?? { id: '', name: '', arguments: '' }
          raw.set(idx, {
            id: tc.id || e.id,
            name: tc.function?.name || e.name,
            arguments: e.arguments + (tc.function?.arguments ?? ''),
          })
        }
      }
    }

    trace.event({ agent: persona, event: 'llm_call_end', contentLen: fullContent.length, toolCalls: raw.size })

    if (this.isCancelled()) {
      return { fullContent, toolCalls: [], assistantMessage: { role: 'assistant', content: '' }, cancelled: true }
    }

    const toolCalls: RawToolCall[] = Array.from(raw.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => {
        try {
          return { ...tc, input: tc.arguments ? JSON.parse(tc.arguments) : {} }
        } catch (err) {
          return { ...tc, parseError: err instanceof Error ? err.message : String(err) }
        }
      })

    const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = toolCalls.length > 0
      ? {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
      : { role: 'assistant', content: fullContent }

    return { fullContent, toolCalls, assistantMessage, cancelled: false }
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/query-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/runtime/query-engine.ts apps/api/src/agents/runtime/query-engine.test.ts
git commit -m "feat(api/runtime): add QueryEngine streaming pass"
```

---

### Task 6: `runtime/query-engine.ts` (part 2) — tool dispatch

**Files:**
- Modify: `apps/api/src/agents/runtime/query-engine.ts`
- Modify: `apps/api/src/agents/runtime/query-engine.test.ts`

Add `dispatchToolCalls()` method to QueryEngine that takes `RawToolCall[]`, partitions by `isConcurrencySafe()`, runs concurrent batches via `Promise.all`, runs non-concurrent serially, returns `{ toolResultMessages, halt }`. This is a re-implementation of the current `tool-execution.ts` logic, scoped to a pool.

- [ ] **Step 1: Add the failing test**

Append to `apps/api/src/agents/runtime/query-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/query-engine.test.ts -t 'tool dispatch'
```

Expected: FAIL — `dispatchToolCalls` does not exist.

- [ ] **Step 3: Add `dispatchToolCalls` method on `QueryEngine`**

Add the imports at the top of `apps/api/src/agents/runtime/query-engine.ts`:

```ts
import type { EmitFn } from './tool-pool.js'
```

Then add this method inside the `QueryEngine` class body (after `run()`):

```ts
  async dispatchToolCalls(
    calls: RawToolCall[],
    emit: EmitFn,
  ): Promise<{ toolResultMessages: OpenAI.Chat.ChatCompletionMessageParam[]; halt: boolean }> {
    const { pool, session, trace, persona } = this.opts

    interface BatchedCall { concurrent: boolean; calls: RawToolCall[] }
    const partitioned: BatchedCall[] = []
    let acc: RawToolCall[] = []
    for (const c of calls) {
      const tool = pool.find(c.name)
      if (tool?.isConcurrencySafe()) {
        acc.push(c)
      } else {
        if (acc.length > 0) { partitioned.push({ concurrent: true, calls: acc }); acc = [] }
        partitioned.push({ concurrent: false, calls: [c] })
      }
    }
    if (acc.length > 0) partitioned.push({ concurrent: true, calls: acc })

    const runOne = async (c: RawToolCall): Promise<{ id: string; output: string; halt: boolean }> => {
      if (c.parseError) {
        return { id: c.id, output: `Error: invalid JSON arguments — ${c.parseError}.`, halt: false }
      }
      const tool = pool.find(c.name)
      if (!tool) return { id: c.id, output: `Error: unknown tool "${c.name}"`, halt: false }
      trace.event({ agent: persona, event: 'tool_call', tool: c.name, args: c.input })
      try {
        const r = await tool.call(c.input ?? {}, session, emit)
        if (r.type === 'halt') {
          trace.event({ agent: persona, event: 'tool_halt', tool: c.name, reason: r.reason })
          return { id: c.id, output: 'Clarification requested.', halt: true }
        }
        trace.event({ agent: persona, event: 'tool_result', tool: c.name })
        return { id: c.id, output: r.output, halt: false }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        trace.event({ agent: persona, event: 'tool_error', tool: c.name, error: msg })
        return { id: c.id, output: `Tool error: ${msg}`, halt: false }
      }
    }

    const results: { id: string; output: string; halt: boolean }[] = []
    for (const batch of partitioned) {
      if (batch.concurrent) {
        results.push(...await Promise.all(batch.calls.map(runOne)))
      } else {
        for (const c of batch.calls) results.push(await runOne(c))
      }
    }
    return {
      halt: results.some((r) => r.halt),
      toolResultMessages: results.map((r) => ({ role: 'tool' as const, tool_call_id: r.id, content: r.output })),
    }
  }
```

- [ ] **Step 4: Run all engine tests, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/query-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/runtime/query-engine.ts apps/api/src/agents/runtime/query-engine.test.ts
git commit -m "feat(api/runtime): add QueryEngine.dispatchToolCalls"
```

---

### Task 7: `runtime/send-message.ts` — typed parent→child dispatch

**Files:**
- Create: `apps/api/src/agents/runtime/send-message.ts`
- Create: `apps/api/src/agents/runtime/send-message.test.ts`

**Responsibility:** A typed function that, given a target persona name + zod-validated payload + parent QueryEngine, instantiates a child QueryEngine with that persona's tool pool, runs its ReAct loop to completion, validates the typed return against the persona's OutputSchema, and returns it. Any LocalAgent persona registers itself with this module.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/runtime/send-message.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { SessionState } from '@travel-agent/shared'
import { sendMessage, registerPersona, __resetPersonas } from './send-message.js'
import { ToolPool } from './tool-pool.js'
import { Trace } from './trace.js'

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
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/send-message.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runtime/send-message.ts`**

```ts
import type { z } from 'zod'
import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { QueryEngine } from './query-engine.js'
import type { ToolPool } from './tool-pool.js'
import type { Trace } from './trace.js'

export interface PersonaDef<I, O> {
  name: string
  systemPrompt: string
  InputSchema: z.ZodType<I>
  OutputSchema: z.ZodType<O>
  buildMessages: (input: I) => OpenAI.Chat.ChatCompletionMessageParam[]
  tools: ToolPool
  /** Max sub-loop turns; default 6 (researcher only invokes ~2 tool batches). */
  maxTurns?: number
}

const REGISTRY = new Map<string, PersonaDef<unknown, unknown>>()

export function registerPersona<I, O>(def: PersonaDef<I, O>): void {
  REGISTRY.set(def.name, def as PersonaDef<unknown, unknown>)
}

export function __resetPersonas(): void { REGISTRY.clear() }

export interface SendMessageContext {
  session: SessionState
  parentRunId: string
  parentPersona: string
  trace: Trace
  childIndex: number
}

const NOOP_EMIT = async () => {}

export async function sendMessage<I, O>(
  targetPersona: string,
  rawInput: I,
  ctx: SendMessageContext,
): Promise<O> {
  const def = REGISTRY.get(targetPersona)
  if (!def) throw new Error(`Unknown persona: ${targetPersona}`)

  const input = def.InputSchema.parse(rawInput) as I
  const childAgentName = `${targetPersona}#${ctx.childIndex}`

  ctx.trace.event({
    agent: childAgentName, event: 'spawn',
    parent: ctx.parentPersona, input: input as unknown,
  })

  const messages = (def as PersonaDef<I, O>).buildMessages(input)
  let workingMessages = messages
  const maxTurns = def.maxTurns ?? 6
  let final = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    const engine = new QueryEngine({
      persona: childAgentName,
      pool: def.tools,
      session: ctx.session,
      runId: ctx.parentRunId,             // share parent runId so cancellation propagates
      messages: workingMessages,
      trace: ctx.trace,
    })
    const r = await engine.run()
    if (r.cancelled) throw new Error('cancelled')
    if (r.toolCalls.length === 0) { final = r.fullContent; break }
    const tr = await engine.dispatchToolCalls(r.toolCalls, NOOP_EMIT)
    workingMessages = [...workingMessages, r.assistantMessage, ...tr.toolResultMessages]
  }

  // Subagent must return JSON. Parse and validate.
  const json = (() => {
    const m = final.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    return (m?.[1] ?? final).trim()
  })()

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    ctx.trace.event({ agent: childAgentName, event: 'return', ok: false, error: 'invalid_json' })
    throw new Error(`Subagent ${targetPersona} did not return valid JSON: ${err instanceof Error ? err.message : err}`)
  }
  const out = def.OutputSchema.parse(parsed) as O
  ctx.trace.event({ agent: childAgentName, event: 'return', ok: true })
  return out
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/runtime/send-message.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/runtime/send-message.ts apps/api/src/agents/runtime/send-message.test.ts
git commit -m "feat(api/runtime): add typed sendMessage primitive"
```

---

## Phase 3 — Persona Modules

### Task 8: `personas/_compactor.ts` — head summarization helper

**Files:**
- Create: `apps/api/src/agents/personas/_compactor.ts`
- Create: `apps/api/src/agents/personas/_compactor.test.ts`

**Responsibility:** when chat history exceeds 10 user/assistant turns, summarize the earliest turns falling outside the most recent 20 into a single `system` message. The summary is written once and then locked (caller is responsible for storing it on the session). Uses `FAST_MODEL`.

The leading underscore in the filename signals "runtime helper, not a public persona", so future code-readers don't try to dispatch to `_compactor` via SendMessage.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/personas/_compactor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { Message } from '@travel-agent/shared'
import { compactHistoryIfNeeded, COMPACT_THRESHOLD } from './_compactor.js'

vi.mock('../../llm/logger.js', () => ({
  loggedCompletion: vi.fn(async () => ({
    choices: [{ message: { content: 'SUMMARY: user wanted Tokyo 5d, family.' } }],
  })),
}))

function turns(n: number): Message[] {
  const out: Message[] = []
  for (let i = 0; i < n; i++) {
    out.push({ id: `u${i}`, role: 'user', content: `user ${i}`, ts: i })
    out.push({ id: `a${i}`, role: 'assistant', content: `assistant ${i}`, ts: i })
  }
  return out
}

describe('compactHistoryIfNeeded', () => {
  it('returns null when turn count is under threshold', async () => {
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD - 1), null)
    expect(r).toBeNull()
  })

  it('returns a summary string when turn count exceeds threshold and no existing summary', async () => {
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD + 5), null)
    expect(r).toMatch(/SUMMARY/)
  })

  it('returns existing summary unchanged once locked', async () => {
    const existing = 'PREVIOUS SUMMARY'
    const r = await compactHistoryIfNeeded(turns(COMPACT_THRESHOLD + 5), existing)
    expect(r).toBe(existing)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/_compactor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `_compactor.ts`**

```ts
import { FAST_MODEL } from '../../llm/client.js'
import { loggedCompletion } from '../../llm/logger.js'
import type { Message } from '@travel-agent/shared'

export const COMPACT_THRESHOLD = 10
export const SLIDING_WINDOW = 20

const SYSTEM_PROMPT = `You compress a long travel-planning chat into one paragraph that preserves: destinations, dates, traveler count, declared preferences, hard constraints, anything the user explicitly said NO to. Drop greetings, filler, repetitions. Output one paragraph (≤ 200 Chinese chars / 100 English words). No headings, no bullet points.` as const

/**
 * Summarize earliest turns once and lock the result.
 * Returns existing summary unchanged if already set.
 * Returns null if no compaction needed.
 */
export async function compactHistoryIfNeeded(
  turns: Message[],
  existingSummary: string | null,
): Promise<string | null> {
  if (existingSummary) return existingSummary
  // count user+assistant turns
  const userAssistant = turns.filter((t) => t.role === 'user' || t.role === 'assistant')
  if (userAssistant.length <= COMPACT_THRESHOLD) return null

  // The block to summarize is everything outside the most-recent SLIDING_WINDOW
  const head = userAssistant.slice(0, Math.max(0, userAssistant.length - SLIDING_WINDOW))
  if (head.length === 0) return null

  const transcript = head.map((t) => `${t.role}: ${t.content}`).join('\n')
  try {
    const resp = await loggedCompletion('compactor', {
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 320,
    })
    const out = resp.choices[0]?.message?.content?.trim()
    return out && out.length > 0 ? out : null
  } catch (err) {
    console.warn('[compactor] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/_compactor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/personas/_compactor.ts apps/api/src/agents/personas/_compactor.test.ts
git commit -m "feat(api/personas): add head-summary compactor"
```

---

### Task 9: `personas/researcher.ts` — Researcher persona module

**Files:**
- Create: `apps/api/src/agents/personas/researcher.ts`
- Create: `apps/api/src/agents/personas/researcher.test.ts`

**Responsibility:** exports `SYSTEM_PROMPT`, `InputSchema`, `OutputSchema`, `buildMessages`, and lazily-initialized `TOOLS`. The TOOLS member is populated AFTER the prefetch tool exists (Task 11), so this task keeps it as an empty pool that Task 15 will replace via a setter — but to avoid a temporal dependency we expose `getTools()` instead of a const.

Actually we'll keep this clean: this task creates the module with TOOLS = `new ToolPool([])`. Task 11 creates the prefetch tool and updates this module to use it. Task 15 (start-research) wires this persona into `registerPersona`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/personas/researcher.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT, InputSchema, OutputSchema, buildMessages, TOOLS } from './researcher.js'

describe('Researcher persona', () => {
  it('SYSTEM_PROMPT is a non-empty const string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string')
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(50)
  })

  it('InputSchema accepts valid payload', () => {
    const r = InputSchema.parse({
      brief: { destinations: ['Beijing'], days: 3, travelers: 2, preferences: [] },
      researchGoals: ['transport', 'weather'],
    })
    expect(r.researchGoals).toContain('transport')
  })

  it('OutputSchema discriminated by ok', () => {
    expect(OutputSchema.parse({ ok: true, summary: 'hi', sources: [] }).ok).toBe(true)
    expect(OutputSchema.parse({ ok: false, error: 'x' }).ok).toBe(false)
  })

  it('buildMessages places SYSTEM_PROMPT at index 0 (cache invariant)', () => {
    const m = buildMessages({
      brief: { destinations: ['Beijing'], days: 3, travelers: 2, preferences: [] },
      researchGoals: ['transport'],
    })
    expect(m[0]!.role).toBe('system')
    expect(m[0]!.content).toBe(SYSTEM_PROMPT)
  })

  it('exposes a ToolPool (initially empty in v2.0 stub state)', () => {
    expect(TOOLS).toBeDefined()
    expect(Array.isArray(TOOLS.tools)).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/researcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `researcher.ts`**

```ts
import { z } from 'zod'
import type OpenAI from 'openai'
import { TripBriefSchema } from '@travel-agent/shared'
import { ToolPool } from '../runtime/tool-pool.js'

export const SYSTEM_PROMPT = `You are a travel research subagent. Your sole job is to gather concrete real-world data needed to plan a trip.

You receive a JSON payload with a TripBrief and a list of researchGoals (e.g. "transport", "weather", "hotels", "attractions"). For each goal you must:
1. Use the tools available in your tool pool to query the relevant data sources.
2. Aggregate the results into a single, dense summary the planner can quote from.
3. Cite which tool produced each fact so the planner can trace claims.

Output rules (STRICT):
- Your final assistant message MUST be a single fenced JSON code block (\`\`\`json … \`\`\`).
- The JSON must match this shape exactly:
  - On success: { "ok": true, "summary": string, "sources": string[] }
  - On unrecoverable failure: { "ok": false, "error": string }
- summary should be 200–600 words, structured by goal. Cite source ids in line.
- sources is the list of tool/source identifiers you actually used.
- Do NOT include prose outside the JSON block. Do NOT add markdown headers outside the block.
- If a goal cannot be answered after one tool attempt, note it inside summary; do not loop indefinitely.` as const

export const InputSchema = z.object({
  brief: TripBriefSchema,
  researchGoals: z.array(z.string()).min(1),
  depth: z.enum(['fast', 'standard']).default('standard'),
})
export type Input = z.infer<typeof InputSchema>

export const OutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), summary: z.string(), sources: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type Output = z.infer<typeof OutputSchema>

export function buildMessages(input: Input): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ]
}

// Populated in Task 11 once prefetch tool exists. Mutable on purpose.
export const TOOLS = new ToolPool([])
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/researcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/personas/researcher.ts apps/api/src/agents/personas/researcher.test.ts
git commit -m "feat(api/personas): add Researcher persona module (empty toolpool)"
```

---

### Task 10: `personas/orchestrator.ts` — Orchestrator persona module

**Files:**
- Create: `apps/api/src/agents/personas/orchestrator.ts`
- Create: `apps/api/src/agents/personas/orchestrator.test.ts`

**Responsibility:** exports `SYSTEM_PROMPT`, `buildMessages(session)` returning `[system, optional compacted-history system, …recent 20 turns…, stateContext]`. TOOLS pool is populated in Tasks 12-15 to contain `extract_brief`, `generate_plan`, `start_research`, `ask_clarification` — for now expose as empty `ToolPool` and let later tasks mutate via a registration helper.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/personas/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { SYSTEM_PROMPT, buildMessages, TOOLS } from './orchestrator.js'

vi.mock('./_compactor.js', () => ({
  COMPACT_THRESHOLD: 10,
  SLIDING_WINDOW: 20,
  compactHistoryIfNeeded: vi.fn(async () => null),   // unit tests: no compaction
}))

const stub = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null, compactedHistory: null,
  ...overrides,
} as unknown as SessionState)

describe('Orchestrator persona', () => {
  it('SYSTEM_PROMPT is non-empty const', () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100)
  })

  it('messages[0] is the static system prompt (cache invariant)', async () => {
    const m = await buildMessages(stub())
    expect(m[0]!.role).toBe('system')
    expect(m[0]!.content).toBe(SYSTEM_PROMPT)
  })

  it('appends compacted history as a system message when present', async () => {
    const session = stub({ compactedHistory: 'SUMMARY OF EARLIER TURNS' } as Partial<SessionState>)
    const m = await buildMessages(session)
    expect(m[1]!.role).toBe('system')
    expect(m[1]!.content).toContain('SUMMARY OF EARLIER TURNS')
  })

  it('appends a Session state user message at the tail', async () => {
    const m = await buildMessages(stub())
    const last = m[m.length - 1]!
    expect(last.role).toBe('user')
    expect(typeof last.content === 'string' && last.content.startsWith('Session state:')).toBe(true)
  })

  it('TOOLS is a ToolPool (populated by tools/orchestrator/* in later tasks)', () => {
    expect(TOOLS).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/orchestrator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `orchestrator.ts`**

```ts
import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { ToolPool } from '../runtime/tool-pool.js'
import { compactHistoryIfNeeded, SLIDING_WINDOW } from './_compactor.js'

export const SYSTEM_PROMPT = `You are an expert travel-planning orchestrator building personalized itineraries.

A great travel plan goes beyond logistics. It reflects who the traveler is: how many people are going, whether they prefer trains or flights, packed vs leisurely pace, interests (history, food, nature, nightlife, shopping), budget sensitivity, special needs.

You have these tools:
- extract_brief: distill TripBrief from chat history (call once at the start of a new request, or after the user gave a clarification answer).
- start_research: spawn one or more Researcher subagents to gather real-world data (transport, weather, hotels, attractions). You MAY issue multiple start_research tool calls in the same response to research different goals in parallel.
- generate_plan: produce the final itinerary JSON, using the TripBrief and any research summaries already in session state.
- ask_clarification: ONLY when destination, travel dates, or traveler count is genuinely missing or ambiguous. Do NOT clarify on optional details (budget, pace, accommodation style, preferences) — generate_plan handles those with sensible defaults.

Ground every itinerary in real-world data. Use start_research before generate_plan. If a research call fails, the planner may use general knowledge with an explicit caveat in the plan disclaimer.

After generate_plan returns, emit only a single short sentence in Chinese (≤ 30 chars) such as '行程规划已完成，祝您旅途愉快！' Do NOT reproduce the itinerary. No markdown.` as const

export const TOOLS = new ToolPool([])    // populated by tools/orchestrator/* tasks

function buildStateContextMessage(session: SessionState): OpenAI.Chat.ChatCompletionMessageParam {
  let loopPhase: string
  if (session.currentPlan) loopPhase = 'planned'
  else if (session.brief) loopPhase = 'briefed'
  else loopPhase = 'draft'
  return {
    role: 'user',
    content: `Session state:\n${JSON.stringify({
      hasBrief: !!session.brief,
      brief: session.brief,
      hasCurrentPlan: !!session.currentPlan,
      language: session.language ?? 'zh',
      status: session.status,
      loopPhase,
      researchSummaries: (session.prefetchContext ?? []).length,
    })}`,
  }
}

export async function buildMessages(
  session: SessionState,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const userAssistant = (session.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0,
  )
  const summary = await compactHistoryIfNeeded(userAssistant, session.compactedHistory ?? null)
  // Persist newly-generated summary on the session so it is locked thereafter.
  if (summary && !session.compactedHistory) {
    (session as unknown as { compactedHistory: string }).compactedHistory = summary
  }
  const recent = userAssistant.slice(-SLIDING_WINDOW).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (summary) out.push({ role: 'system', content: `Earlier-turn summary:\n${summary}` })
  out.push(...recent)
  out.push(buildStateContextMessage(session))
  return out
}
```

- [ ] **Step 4: Add `compactedHistory` to `SessionState` schema**

Open `packages/shared/src/session.ts`. Inside the zod object passed to `SessionStateSchema = z.object({ ... })`, add this field next to the other nullable string fields (e.g. near `pendingClarification`):

```ts
  compactedHistory: z.string().nullable().default(null),
```

The inferred TypeScript type updates automatically. If `SessionState` is also defined as a TS interface in this file (rather than purely from `z.infer`), add `compactedHistory: string | null` to that interface as well.

If `apps/api/src/persistence/pg.ts` mirrors this field to a column, add a migration that creates `compacted_history TEXT NULL`. Per the spec ("数据库没有要保留的内容") it is acceptable to drop and recreate the table during migration; check `packages/memory-pg/migrations/` and add a new migration file appending the column.

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/personas/orchestrator.test.ts
pnpm --filter @travel-agent/shared test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/personas/orchestrator.ts apps/api/src/agents/personas/orchestrator.test.ts packages/shared/src/session.ts
git commit -m "feat(api/personas): add Orchestrator persona module + compactedHistory field"
```

---

## Phase 4 — Tool Migrations

### Task 11: `tools/researcher/prefetch-context.tool.ts` (migrated)

**Files:**
- Create: `apps/api/src/agents/tools/researcher/prefetch-context.tool.ts`
- Create: `apps/api/src/agents/tools/researcher/prefetch-context.tool.test.ts`
- Modify: `apps/api/src/agents/personas/researcher.ts` (wire tool into TOOLS)

**Responsibility:** wraps `prefetchFlyaiContext` from current `agents/prefetch.ts` as a Tool implementing the new `Tool` interface from `runtime/tool-pool.ts`. The prefetch implementation itself stays where it is for now (Task 21 will move it).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/tools/researcher/prefetch-context.tool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { prefetchContextTool } from './prefetch-context.tool.js'

vi.mock('../../prefetch.js', () => ({
  prefetchFlyaiContext: vi.fn(async () => ['flight: AA123 BJS→TYO', 'hotel: ANA Crowne Plaza']),
}))

describe('prefetchContextTool', () => {
  it('reports concurrency-safe', () => {
    expect(prefetchContextTool.isConcurrencySafe()).toBe(true)
  })

  it('calls prefetchFlyaiContext and returns concatenated string', async () => {
    const session = { id: 's1', brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] } } as unknown as Parameters<typeof prefetchContextTool.call>[1]
    const r = await prefetchContextTool.call({}, session, async () => {})
    expect(r.type).toBe('ok')
    if (r.type === 'ok') {
      expect(r.output).toContain('flight: AA123')
      expect(r.output).toContain('hotel: ANA')
    }
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/researcher/prefetch-context.tool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

```ts
import type { Tool } from '../../runtime/tool-pool.js'
import { prefetchFlyaiContext } from '../../prefetch.js'

export const prefetchContextTool: Tool = {
  name: 'prefetch_context',
  description: 'Fetch real-world flight, train, hotel, and POI data for the current TripBrief from the flyai data source. Returns a single string containing all results, sectioned per query.',
  parametersSchema: {
    type: 'object',
    properties: {
      // No parameters — implicitly uses session.brief.
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  call: async (_input, session, _emit) => {
    if (!session.brief) {
      return { type: 'ok', output: 'No TripBrief available; cannot prefetch.' }
    }
    const ctx = await prefetchFlyaiContext(session.brief, session.id)
    return { type: 'ok', output: ctx.length > 0 ? ctx.join('\n\n---\n\n') : 'No data returned by flyai.' }
  },
}
```

- [ ] **Step 4: Wire into `personas/researcher.ts`**

In `apps/api/src/agents/personas/researcher.ts`, replace:

```ts
export const TOOLS = new ToolPool([])
```

with:

```ts
import { prefetchContextTool } from '../tools/researcher/prefetch-context.tool.js'
export const TOOLS = new ToolPool([prefetchContextTool])
```

- [ ] **Step 5: Run all relevant tests, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/researcher src/agents/personas/researcher.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/tools/researcher apps/api/src/agents/personas/researcher.ts
git commit -m "feat(api/tools): migrate prefetch_context to researcher pool"
```

---

### Task 12: `tools/orchestrator/extract-brief.tool.ts` (migrated)

**Files:**
- Create: `apps/api/src/agents/tools/orchestrator/extract-brief.tool.ts`
- Create: `apps/api/src/agents/tools/orchestrator/extract-brief.tool.test.ts`

**Responsibility:** wraps the existing `extractBrief` function from `agents/extractor.ts` as an orchestrator-pool Tool. Tool emits an `agent_step` event on entry/exit, invokes `extractBrief`, mutates `session.brief`, and returns a summary string for the LLM.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/tools/orchestrator/extract-brief.tool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { extractBriefTool } from './extract-brief.tool.js'

vi.mock('../../extractor.js', () => ({
  extractBrief: vi.fn(async () => ({
    brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [], originCity: 'Beijing' },
    intent: 'new',
    changedFields: ['destinations', 'days'],
  })),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [{ id: 'm1', role: 'user', content: '去东京玩 5 天', ts: 1 }],
  status: 'draft', brief: null, currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof extractBriefTool.call>[1])

describe('extractBriefTool', () => {
  it('mutates session.brief and emits agent_step events', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await extractBriefTool.call({}, session, async (e) => { events.push(e) })
    expect(r.type).toBe('ok')
    expect(session.brief).toBeTruthy()
    expect((session.brief as { destinations: string[] }).destinations).toContain('Tokyo')
    expect(events.some((e) => (e as { type: string }).type === 'agent_step')).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/extract-brief.tool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

```ts
import type { Tool } from '../../runtime/tool-pool.js'
import { extractBrief } from '../../extractor.js'

export const extractBriefTool: Tool = {
  name: 'extract_brief',
  description: 'Distill a TripBrief from the conversation history. Call once for a new request or after the user answers a clarification question. Updates session.brief in place.',
  parametersSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,                // mutates session.brief
  call: async (_input, session, emit) => {
    await emit({ type: 'agent_step', agent: 'extractor', status: 'start' })
    try {
      const { brief, intent, changedFields } = await extractBrief(
        session.messages ?? [],
        session.brief ?? null,
      )
      session.brief = brief
      await emit({ type: 'agent_step', agent: 'extractor', status: 'done', output: { intent, changedFields } })
      return {
        type: 'ok',
        output: `TripBrief extracted: ${JSON.stringify(brief)}; intent=${intent}; changedFields=${JSON.stringify(changedFields)}.`,
      }
    } catch (err) {
      await emit({ type: 'agent_step', agent: 'extractor', status: 'error' })
      throw err
    }
  },
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/extract-brief.tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tools/orchestrator/extract-brief.tool.ts apps/api/src/agents/tools/orchestrator/extract-brief.tool.test.ts
git commit -m "feat(api/tools): migrate extract_brief to orchestrator pool"
```

---

### Task 13: `tools/orchestrator/generate-plan.tool.ts` (migrated)

**Files:**
- Create: `apps/api/src/agents/tools/orchestrator/generate-plan.tool.ts`
- Create: `apps/api/src/agents/tools/orchestrator/generate-plan.tool.test.ts`

**Responsibility:** wraps `runInitial` (the streaming generator) from `agents/generator.ts`. Iterates the generator, forwards `token` / `plan_partial` / `plan` / `done` / `error` events to `emit`, sets `session.currentPlan` on success.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/tools/orchestrator/generate-plan.tool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { generatePlanTool } from './generate-plan.tool.js'

vi.mock('../../generator.js', () => ({
  runInitial: vi.fn(async function* () {
    yield { type: 'token', delta: '正在生成…' }
    yield {
      type: 'plan',
      plan: {
        title: 'Tokyo 5d', destinations: ['Tokyo'], days: 5, travelers: 2,
        pace: 'balanced',
        dailyPlans: [{ day: 1, items: [{ type: 'attraction', title: 'Senso-ji', description: 'Visit', durationMinutes: 120 }, { type: 'meal', title: 'Tonkatsu', description: 'Lunch' }, { type: 'lodging', title: 'ANA', description: 'Stay' }] }],
        estimatedBudget: { amount: 8000, currency: 'CNY', breakdown: [] },
        tips: [], disclaimer: 'AI generated.',
      },
    }
    yield { type: 'done', messageId: 'm1', converged: true }
    return { title: 'Tokyo 5d' } as unknown as Parameters<typeof generatePlanTool.call>[0]
  }),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: ['flight data: …'], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof generatePlanTool.call>[1])

describe('generatePlanTool', () => {
  it('forwards events and sets session.currentPlan', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await generatePlanTool.call({}, session, async (e) => { events.push(e) })
    expect(r.type).toBe('ok')
    expect(session.currentPlan).toBeTruthy()
    expect(events.some((e) => (e as { type: string }).type === 'token')).toBe(true)
    expect(events.some((e) => (e as { type: string }).type === 'plan')).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/generate-plan.tool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

```ts
import type { Tool } from '../../runtime/tool-pool.js'
import { runInitial } from '../../generator.js'

export const generatePlanTool: Tool = {
  name: 'generate_plan',
  description: 'Generate the final travel itinerary using the current TripBrief and any prefetched real-world data in the session. Streams plan tokens to the user. Sets session.currentPlan on success.',
  parametersSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  call: async (_input, session, emit) => {
    if (!session.brief) {
      return { type: 'ok', output: 'Cannot generate plan: TripBrief not yet extracted. Call extract_brief first.' }
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'start' })
    let planSet = false
    try {
      for await (const event of runInitial(session.brief, session.prefetchContext ?? [], session.language ?? 'zh')) {
        await emit(event)
        if (event.type === 'plan') {
          (session as { currentPlan: typeof event.plan | null }).currentPlan = event.plan
          planSet = true
        }
      }
      await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
      return {
        type: 'ok',
        output: planSet ? 'Plan generated and stored in session.currentPlan.' : 'Plan generation completed without a final plan; consider asking the user for clarification.',
      }
    } catch (err) {
      await emit({ type: 'agent_step', agent: 'generator', status: 'error' })
      throw err
    }
  },
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/generate-plan.tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tools/orchestrator/generate-plan.tool.ts apps/api/src/agents/tools/orchestrator/generate-plan.tool.test.ts
git commit -m "feat(api/tools): migrate generate_plan to orchestrator pool"
```

---

### Task 14: `tools/orchestrator/ask-clarification.tool.ts` (migrated)

**Files:**
- Create: `apps/api/src/agents/tools/orchestrator/ask-clarification.tool.ts`
- Create: `apps/api/src/agents/tools/orchestrator/ask-clarification.tool.test.ts`

**Responsibility:** uses `generateClarification` from `agents/clarifier.ts` to produce a question, emits `clarify_needed`, sets `session.pendingClarification`, returns `{ type: 'halt', reason: 'clarification_requested' }` so QueryEngine breaks the orchestrator loop.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/tools/orchestrator/ask-clarification.tool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { askClarificationTool } from './ask-clarification.tool.js'

vi.mock('../../clarifier.js', () => ({
  generateClarification: vi.fn(async () => ({ question: 'When are you planning to depart?', defaultSuggestion: null })),
}))

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: null,
} as unknown as Parameters<typeof askClarificationTool.call>[1])

describe('askClarificationTool', () => {
  it('emits clarify_needed, sets session.pendingClarification, returns halt', async () => {
    const events: unknown[] = []
    const session = stubSession()
    const r = await askClarificationTool.call(
      { reason: 'missing_dates' }, session, async (e) => { events.push(e) },
    )
    expect(r.type).toBe('halt')
    expect(session.pendingClarification).toBeTruthy()
    expect(events.find((e) => (e as { type: string }).type === 'clarify_needed')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/ask-clarification.tool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the tool**

```ts
import type { Tool } from '../../runtime/tool-pool.js'
import { generateClarification } from '../../clarifier.js'
import { BlockerTypeEnum } from '@travel-agent/shared'

export const askClarificationTool: Tool = {
  name: 'ask_clarification',
  description: 'Ask the user for a missing destination, travel dates, or traveler count. Use only when one of these three is genuinely unknown. Halts the orchestrator loop and surfaces the question to the user.',
  parametersSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['missing_origin', 'missing_destination', 'missing_days', 'missing_dates', 'missing_budget', 'unclear_preference', 'other'],
        description: 'Which field is missing.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  call: async (input, session, emit) => {
    const reason = BlockerTypeEnum.parse((input as { reason?: string }).reason ?? 'other')
    const { question, defaultSuggestion } = await generateClarification(
      session.messages ?? [], session.brief ?? undefined, reason, session.language ?? 'zh',
    )
    await emit({
      type: 'clarify_needed',
      question,
      reason,
      ...(defaultSuggestion ? { defaultSuggestion } : {}),
    })
    ;(session as { pendingClarification: { reason: typeof reason; question: string; defaultSuggestion: string | null } | null }).pendingClarification = {
      reason, question, defaultSuggestion,
    }
    return { type: 'halt', reason: 'clarification_requested' }
  },
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/ask-clarification.tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tools/orchestrator/ask-clarification.tool.ts apps/api/src/agents/tools/orchestrator/ask-clarification.tool.test.ts
git commit -m "feat(api/tools): migrate ask_clarification to orchestrator pool"
```

---

## Phase 5 — Subagent Bridge

### Task 15: `tools/orchestrator/start-research.tool.ts` (NEW)

**Files:**
- Create: `apps/api/src/agents/tools/orchestrator/start-research.tool.ts`
- Create: `apps/api/src/agents/tools/orchestrator/start-research.tool.test.ts`
- Modify: `apps/api/src/agents/personas/orchestrator.ts` (populate TOOLS)
- Modify: `apps/api/src/agents/personas/researcher.ts` (export persona def for registration)

**Responsibility:** the bridge tool. Validates `researchGoals` from the orchestrator's call, packages into `ResearcherInput`, calls `sendMessage('researcher', input, ctx)`, appends the returned summary to `session.prefetchContext`, returns a string for the orchestrator's tool result. Concurrency-safe so multiple `start_research` calls in the same turn run in parallel.

This task also *registers* the Researcher persona via `registerPersona` and *populates* `Orchestrator.TOOLS` so the system is finally end-to-end.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/tools/orchestrator/start-research.tool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startResearchTool } from './start-research.tool.js'
import * as send from '../../runtime/send-message.js'

vi.spyOn(send, 'sendMessage').mockImplementation(
  async (_target, _payload) => ({ ok: true, summary: 'Tokyo: ANA flights 4500CNY; weather 18°C; cherry season.', sources: ['flyai:flight', 'flyai:weather'] }),
)

const stubSession = () => ({
  id: 's', userId: 'u', messages: [], status: 'draft',
  brief: { destinations: ['Tokyo'], days: 5, travelers: 2, preferences: [] },
  currentPlan: null, prefetchContext: [], language: 'zh',
  pendingClarification: null, lastRunId: 'run-1',
  __runtime__: { trace: { event: () => {} } },                         // injected by runtime
} as unknown as Parameters<typeof startResearchTool.call>[1])

describe('startResearchTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is concurrency-safe', () => {
    expect(startResearchTool.isConcurrencySafe()).toBe(true)
  })

  it('appends researcher summary to session.prefetchContext', async () => {
    const session = stubSession()
    await startResearchTool.call({ researchGoals: ['transport', 'weather'] }, session, async () => {})
    expect(session.prefetchContext).toHaveLength(1)
    expect(session.prefetchContext[0]).toContain('Tokyo')
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator/start-research.tool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the tool**

```ts
import { z } from 'zod'
import type { Tool } from '../../runtime/tool-pool.js'
import { sendMessage } from '../../runtime/send-message.js'
import type { Trace } from '../../runtime/trace.js'

const InSchema = z.object({
  researchGoals: z.array(z.string()).min(1)
    .describe('Concrete research topics, e.g. ["transport", "weather", "hotels", "attractions"]'),
})

export const startResearchTool: Tool = {
  name: 'start_research',
  description: 'Spawn a Researcher subagent to gather real-world data. May be invoked multiple times in the same turn to research different goals in parallel.',
  parametersSchema: {
    type: 'object',
    properties: {
      researchGoals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete research topics, e.g. ["transport", "weather", "hotels", "attractions"]',
        minItems: 1,
      },
    },
    required: ['researchGoals'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  call: async (input, session, emit) => {
    const { researchGoals } = InSchema.parse(input)
    if (!session.brief) {
      return { type: 'ok', output: 'Cannot start research without a TripBrief. Call extract_brief first.' }
    }

    // The runtime injects __runtime__ on the session right before dispatching tool calls.
    const runtime = (session as { __runtime__?: { trace: Trace; runId: string; childCounter: { next(): number } } }).__runtime__
    if (!runtime) throw new Error('start_research called without runtime context')

    await emit({ type: 'agent_step', agent: 'researcher', status: 'start', input: { researchGoals } })
    const out = await sendMessage('researcher', {
      brief: session.brief,
      researchGoals,
    }, {
      session,
      parentRunId: runtime.runId,
      parentPersona: 'orchestrator',
      trace: runtime.trace,
      childIndex: runtime.childCounter.next(),
    })

    if (out.ok) {
      session.prefetchContext = [...(session.prefetchContext ?? []), out.summary]
      await emit({ type: 'agent_step', agent: 'researcher', status: 'done', output: { sources: out.sources } })
      return { type: 'ok', output: `Research summary appended to session. sources=${out.sources.join(', ')}` }
    } else {
      await emit({ type: 'agent_step', agent: 'researcher', status: 'error', output: { error: out.error } })
      return { type: 'ok', output: `Research failed: ${out.error}` }
    }
  },
}
```

- [ ] **Step 4: Register Researcher persona + populate Orchestrator pool**

Edit `apps/api/src/agents/personas/researcher.ts` — add at the bottom:

```ts
import { registerPersona } from '../runtime/send-message.js'

registerPersona({
  name: 'researcher',
  systemPrompt: SYSTEM_PROMPT,
  InputSchema,
  OutputSchema,
  buildMessages,
  tools: TOOLS,
})
```

Edit `apps/api/src/agents/personas/orchestrator.ts` — replace the empty TOOLS line with:

```ts
import { extractBriefTool } from '../tools/orchestrator/extract-brief.tool.js'
import { generatePlanTool } from '../tools/orchestrator/generate-plan.tool.js'
import { askClarificationTool } from '../tools/orchestrator/ask-clarification.tool.js'
import { startResearchTool } from '../tools/orchestrator/start-research.tool.js'

export const TOOLS = new ToolPool([
  extractBriefTool, startResearchTool, generatePlanTool, askClarificationTool,
])
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/orchestrator
pnpm --filter @travel-agent/api exec vitest run src/agents/personas
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/tools/orchestrator/start-research.tool.ts apps/api/src/agents/tools/orchestrator/start-research.tool.test.ts apps/api/src/agents/personas
git commit -m "feat(api): wire start_research bridge to Researcher subagent"
```

---

## Phase 6 — Integration

### Task 16: Rewrite `react-loop.ts` to use QueryEngine

**Files:**
- Modify: `apps/api/src/agents/personas/orchestrator.ts` (split state-context out)
- Modify: `apps/api/src/agents/react-loop.ts` (full rewrite)
- Modify: `apps/api/src/agents/react-loop.test.ts` (rewrite for new event flow)

**Responsibility:** `runReactLoop(session, runId, emit)` is the public API consumed by `routes/sessions.ts`. The orchestrator's `buildMessages` is split into a stable prefix (no state-context) and a separate `buildStateContextMessage` so the react-loop can append a fresh state-context before each LLM turn while preserving the accumulated assistant + tool-result history. Without this split the loop would either rebuild messages from scratch each turn (losing tool results) or never refresh state.

- [ ] **Step 1: Split `orchestrator.ts` to expose state-context separately**

Open `apps/api/src/agents/personas/orchestrator.ts`. The `buildStateContextMessage` helper inside it is currently private; export it. Also change `buildMessages` to NOT include the state-context at the tail — it should return the cache-friendly prefix only.

Replace the bottom half of the file (from `function buildStateContextMessage` to end) with:

```ts
export function buildStateContextMessage(session: SessionState): OpenAI.Chat.ChatCompletionMessageParam {
  let loopPhase: string
  if (session.currentPlan) loopPhase = 'planned'
  else if (session.brief) loopPhase = 'briefed'
  else loopPhase = 'draft'
  return {
    role: 'user',
    content: `Session state:\n${JSON.stringify({
      hasBrief: !!session.brief,
      brief: session.brief,
      hasCurrentPlan: !!session.currentPlan,
      language: session.language ?? 'zh',
      status: session.status,
      loopPhase,
      researchSummaries: (session.prefetchContext ?? []).length,
    })}`,
  }
}

/** Stable prefix: SYSTEM_PROMPT + (optional summary) + recent 20 turns. NO state-context. */
export async function buildMessages(
  session: SessionState,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const userAssistant = (session.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0,
  )
  const summary = await compactHistoryIfNeeded(userAssistant, session.compactedHistory ?? null)
  if (summary && !session.compactedHistory) {
    (session as unknown as { compactedHistory: string }).compactedHistory = summary
  }
  const recent = userAssistant.slice(-SLIDING_WINDOW).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (summary) out.push({ role: 'system', content: `Earlier-turn summary:\n${summary}` })
  out.push(...recent)
  return out
}
```

Now update the existing `orchestrator.test.ts` test that asserts "appends a Session state user message at the tail" — change it to import and call `buildStateContextMessage` directly:

```ts
it('buildStateContextMessage produces a user message starting with "Session state:"', () => {
  const m = buildStateContextMessage(stub())
  expect(m.role).toBe('user')
  expect(typeof m.content === 'string' && m.content.startsWith('Session state:')).toBe(true)
})
```

- [ ] **Step 2: Replace `react-loop.ts` body**

Open `apps/api/src/agents/react-loop.ts` and replace its full content with:

```ts
import { randomUUID } from 'crypto'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { QueryEngine } from './runtime/query-engine.js'
import { Trace } from './runtime/trace.js'
import {
  TOOLS as ORCHESTRATOR_POOL,
  buildMessages as buildOrchestratorMessages,
  buildStateContextMessage,
} from './personas/orchestrator.js'
import './personas/researcher.js'                              // side-effect: registers persona

const MAX_TURNS = 10
type EmitFn = (event: ChatStreamEvent) => Promise<void>

function makeChildCounter(): { next(): number } {
  let i = 0
  return { next() { return i++ } }
}

export async function* runReactLoop(
  session: SessionState,
  runId: string,
  emit: EmitFn,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const trace = new Trace(runId)
  ;(session as { __runtime__?: unknown }).__runtime__ = {
    trace, runId, childCounter: makeChildCounter(),
  }

  // Stable prefix is computed once: system prompt + optional summary + recent 20 turns.
  // State-context is appended FRESH before each engine.run() so the orchestrator sees
  // the latest brief/plan/research counts, while the prefix stays cache-friendly.
  const prefix = await buildOrchestratorMessages(session)
  let accumulated: typeof prefix = []                          // assistant + tool messages added each turn

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (session.lastRunId !== runId) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    const messages = [...prefix, ...accumulated, buildStateContextMessage(session)]

    const engine = new QueryEngine({
      persona: 'orchestrator',
      pool: ORCHESTRATOR_POOL,
      session, runId, messages, trace,
    })
    const r = await engine.run()
    if (r.cancelled) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    if (r.toolCalls.length === 0) {
      const trimmed = r.fullContent.trim()
      if (trimmed) yield { type: 'token', delta: r.fullContent }
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      await trace.close()
      return
    }

    const { toolResultMessages, halt } = await engine.dispatchToolCalls(r.toolCalls, emit)
    if (halt) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    accumulated = [...accumulated, r.assistantMessage, ...toolResultMessages]
  }

  session.status = 'converged'
  yield { type: 'done', messageId: randomUUID(), converged: true }
  await trace.close()
}
```

- [ ] **Step 3: Replace `react-loop.test.ts`**

Replace the file contents (keep any imports the existing file has for setup helpers):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { runReactLoop } from './react-loop.js'

vi.mock('../llm/logger.js', () => ({
  loggedStream: vi.fn(),
  loggedCompletion: vi.fn(async () => ({ choices: [{ message: { content: '' } }] })),
}))
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
```

(Tests for the full extract → research → generate path live in the corresponding tool tests; here we exercise only the loop control flow.)

- [ ] **Step 3: Build and run**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/react-loop.ts apps/api/src/agents/react-loop.test.ts
git commit -m "feat(api/agents): rewrite react-loop on QueryEngine runtime"
```

---

### Task 17: Verify `routes/sessions.ts` integration

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`

**Responsibility:** `routes/sessions.ts` already calls `runReactLoop`. Verify the signature is unchanged, all `event.type` branches it switches on are within the new 8-variant set, and any leftover `heartbeat`/`tool_reasoning` setup from Task 2 is gone.

- [ ] **Step 1: Search for remaining references**

```bash
grep -nE "tool_reasoning|assistant_say|item_options|heartbeat|followup" apps/api/src/routes/sessions.ts
```

Expected: no matches (Task 2 already cleaned this up). Fix any remaining hits.

- [ ] **Step 2: Run integration**

```bash
pnpm --filter @travel-agent/api test
```

Expected: PASS.

- [ ] **Step 3: Manual smoke (start the API and one user request)**

```bash
pnpm dev:api &
API_PID=$!
sleep 4
# Login (uses AUTH_USERNAME/AUTH_PASSWORD from apps/api/.env)
curl -s -c /tmp/c.jar -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AUTH_USERNAME\",\"password\":\"$AUTH_PASSWORD\"}"
# Create session and post message
SID=$(curl -s -b /tmp/c.jar -X POST http://localhost:3001/api/sessions -H 'Content-Type: application/json' -d '{}' | jq -r '.id')
curl -N -s -b /tmp/c.jar -X POST http://localhost:3001/api/sessions/$SID/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"我想去东京玩 5 天，2 个人，从北京出发"}' | head -50
kill $API_PID
```

Expected: a stream of SSE events ending with `data: {"type":"done","messageId":"...","converged":true}`. Confirm a `plan` event appears.

- [ ] **Step 4: If smoke passed, commit any sessions.ts adjustments; otherwise diagnose**

```bash
git status
git add -A
git commit -m "chore(api/routes): align sessions route with v2.0 event set" --allow-empty
```

---

### Task 18: Frontend smoke + final cleanup

**Files:**
- Modify: `apps/web/stores/chat.ts`, `apps/web/components/**` as needed

**Responsibility:** the web UI must continue to render. Specifically: when an `agent_step{agent:'researcher'}` arrives, the existing `agent_step` handler (Task 2 left it intact) should label it appropriately. If there is a hardcoded mapping `extractor|prefetch|generator → label`, extend it to include `researcher`.

- [ ] **Step 1: Locate the agent → label mapping**

```bash
grep -rEn "agent.*===.*'extractor'|agent.*===.*'prefetch'|agent.*===.*'generator'|extractor:|prefetch:|generator:" \
  apps/web/components apps/web/stores apps/web/composables --include='*.ts' --include='*.vue'
```

The mapping is most likely in `apps/web/components/react/ReactProgress.vue` (a switch on `event.agent`) or `apps/web/stores/chat.ts` (a label lookup table). Open whichever file the grep surfaces first.

- [ ] **Step 2: Add the `researcher` branch**

If the mapping is a switch:

```ts
// Find a block like:
switch (event.agent) {
  case 'extractor': return '正在理解你的需求…'
  case 'prefetch':  return '正在收集真实数据…'
  case 'generator': return '正在生成行程…'
  default:          return '正在思考…'
}
```

Add `case 'researcher': return '正在收集真实数据…'` before the `default` case. The `prefetch` case can be kept as a fallback or removed (the v2.0 loop emits `researcher` for this work; `prefetch` is no longer emitted but keeping the case does no harm).

If the mapping is an object table:

```ts
const AGENT_LABELS: Record<string, string> = {
  extractor: '正在理解你的需求…',
  prefetch:  '正在收集真实数据…',
  generator: '正在生成行程…',
}
```

Add the entry:

```ts
  researcher: '正在收集真实数据…',
```

If neither pattern matches the actual code shape, the spec's principle still applies: render `researcher` like the other phase labels — pick the location closest to where `extractor` is rendered and mirror its handling.

- [ ] **Step 3: Run full dev stack and click through one request**

```bash
pnpm dev
# In a browser, log in, send "我想去东京玩 5 天，2 个人"; confirm:
# - chat shows agent_step labels for extractor → researcher → generator
# - plan renders in the right panel
# - no console errors
```

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): label researcher subagent step + smoke test passing"
```

---

## Phase 7 — Dev Trace Endpoint

### Task 19: `GET /dev/traces/:runId`

**Files:**
- Create: `apps/api/src/routes/dev-traces.ts`
- Modify: `apps/api/src/index.ts` (mount route only when `NODE_ENV !== 'production'`)

**Responsibility:** read `apps/api/.traces/<runId>.jsonl`, render a minimal HTML timeline grouped by agent. Serves only when not in production. Auth required (mounted under the same auth middleware as session routes).

- [ ] **Step 1: Implement the route**

Create `apps/api/src/routes/dev-traces.ts`:

```ts
import { Hono } from 'hono'
import { promises as fs } from 'fs'
import path from 'path'

export const devTracesRouter = new Hono()

devTracesRouter.get('/:runId', async (c) => {
  const runId = c.req.param('runId').replace(/[^\w-]/g, '')
  if (!runId) return c.json({ error: 'invalid runId' }, 400)
  const file = path.join(process.cwd(), '.traces', `${runId}.jsonl`)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return c.json({ error: 'not found' }, 404)
  }
  const events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const html = `<!doctype html><html><head><title>trace ${runId}</title>
<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:1em;background:#0b0b0c;color:#e6e6e6}
.row{padding:2px 8px;border-left:3px solid #444;margin:1px 0}
.orchestrator{border-color:#7f7fff}.researcher{border-color:#7fff7f}
.event{color:#aaa}.ts{color:#666}</style></head><body>
<h1>Trace ${runId} (${events.length} events)</h1>
${events.map((e: { ts: string; agent: string; event: string }) =>
  `<div class="row ${e.agent.split('#')[0]}"><span class="ts">${e.ts}</span> <b>${e.agent}</b> <span class="event">${e.event}</span> <code>${JSON.stringify(e).replace(/</g, '&lt;')}</code></div>`,
).join('\n')}
</body></html>`
  return c.html(html)
})
```

- [ ] **Step 2: Mount in `index.ts` (dev only, behind auth)**

In `apps/api/src/index.ts`, after the existing `sessionsRouter` mount, add:

```ts
if (process.env.NODE_ENV !== 'production') {
  const { devTracesRouter } = await import('./routes/dev-traces.js')
  // Reuse the same auth middleware that protects sessionsRouter
  app.route('/dev/traces', devTracesRouter)
}
```

If `index.ts` uses synchronous mounting only, change to `await import` at top-level (Hono routes are pure objects — order doesn't matter for the request pipeline).

- [ ] **Step 3: Smoke**

```bash
pnpm dev:api &
API_PID=$!
sleep 4
# trigger one request first to generate a trace; copy runId from the trace folder
RUN=$(ls apps/api/.traces | head -1 | sed 's/\.jsonl$//')
curl -s -b /tmp/c.jar http://localhost:3001/dev/traces/$RUN | head -20
kill $API_PID
```

Expected: HTML output with rows.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/dev-traces.ts apps/api/src/index.ts
git commit -m "feat(api): add dev-only /dev/traces/:runId timeline endpoint"
```

---

## Phase 8 — Cleanup & Verify

### Task 20: Delete dead files

**Files (delete):**
- `apps/api/src/agents/extractor.ts` (logic moved to extract-brief.tool.ts via re-export — but extractor.ts itself stays since `extract-brief.tool.ts` imports from it; **only delete if you also inlined the logic**)
- `apps/api/src/agents/extractor.test.ts` (delete only if extractor.ts deleted)
- `apps/api/src/agents/generator.ts` / `generator.test.ts` (same caveat — keep if tools/orchestrator/generate-plan.tool.ts re-exports)
- `apps/api/src/agents/clarifier.ts` / `clarifier.test.ts` (same)
- `apps/api/src/agents/prefetch.ts` / `prefetch.test.ts` (same)
- `apps/api/src/agents/tool-execution.ts` and `tool-execution.test.ts` (replaced by query-engine)
- `apps/api/src/agents/tools/agent/` (entire directory)
- `apps/api/src/agents/tools/mcp/` (entire directory)
- `apps/api/src/agents/tools/types.ts` (replaced by runtime/tool-pool.ts types)
- `apps/api/src/agents/tools/index.ts` (replaced by personas/orchestrator.ts pool)
- `apps/api/src/agents/tools/index.test.ts`

**Approach:** The migrated tool files (Tasks 11–14) currently *import* from `extractor.ts`, `generator.ts`, `clarifier.ts`, `prefetch.ts`. So those four "agent backend" files **stay** — they hold the concrete LLM-call logic. Delete only:
- `tool-execution.ts` and its test (replaced by query-engine)
- `tools/agent/`, `tools/mcp/`, `tools/types.ts`, `tools/index.ts`, `tools/index.test.ts` (replaced by new structure)

- [ ] **Step 1: Delete the obsolete files**

```bash
git rm apps/api/src/agents/tool-execution.ts apps/api/src/agents/tool-execution.test.ts
git rm -r apps/api/src/agents/tools/agent apps/api/src/agents/tools/mcp
git rm apps/api/src/agents/tools/types.ts apps/api/src/agents/tools/index.ts apps/api/src/agents/tools/index.test.ts
```

- [ ] **Step 2: Hunt remaining imports**

```bash
grep -rn "agents/tool-execution\|agents/tools/agent\|agents/tools/mcp\|agents/tools/types\|agents/tools/index\|tools/index" apps/api/src --include='*.ts'
```

Expected: no matches. If any, fix imports to point at `runtime/` or `personas/orchestrator.ts`.

- [ ] **Step 3: Build + test**

```bash
pnpm --filter @travel-agent/api build
pnpm --filter @travel-agent/api test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(api/agents): delete pre-v2.0 tool-execution and tool dirs"
```

---

### Task 21: Final test suite + smoke

**Files:** none modified.

- [ ] **Step 1: Run the full monorepo test suite**

```bash
pnpm -r test
```

Expected: PASS.

- [ ] **Step 2: Build everything**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: HTTP auth smoke (no Playwright dependency)**

```bash
pnpm smoke:auth
```

Expected: smoke script output reports OK.

- [ ] **Step 4: Manual end-to-end via UI**

```bash
pnpm dev
```

Open the browser to the indicated port, log in, send three different prompts:
1. `我想去东京玩 5 天，2 个人，从北京出发` (full info → should converge to a plan)
2. `规划一次旅行` (missing destination + dates → should ask_clarification, halt)
3. `去广州深圳珠海玩 6 天，3 个人，从北京出发` (multi-destination → should issue ≥ 2 parallel `start_research` calls; verify in `/dev/traces/<runId>` that there are concurrent `researcher#0`, `researcher#1` entries with overlapping timestamps)

Confirm:
- Plans generate end-to-end.
- Researcher subagent appears in `agent_step` events.
- Trace file contains the expected event types.
- Cache hit rate is high after a 10+ turn conversation (check `loggedStream` token-usage logs; the prefix should reuse).

- [ ] **Step 5: Tag the version**

```bash
git tag -a v2.0.0 -m "Harness & multi-agent foundation"
```

- [ ] **Step 6: Final commit (if any cleanup needed)**

If smoke uncovered minor issues, fix them and commit. Otherwise just confirm `git status` is clean.

---

## Self-Review Checklist (run before handing off)

- **Spec coverage**:
  - §5 architecture → Tasks 5, 6, 7, 16
  - §6 runtime primitives → Tasks 5, 6, 7
  - §7 personas → Tasks 9, 10
  - §8 context engineering → Task 8 + Orchestrator buildMessages in Task 10
  - §9 SSE → Tasks 1, 2, 18
  - §10 trace → Tasks 3, 19
  - §11 error/retry → Task 6 (try/catch), Task 16 (cancellation), runtime relies on existing `logger.ts` retry
  - §12 migration → Tasks 11–14, 20
  - §13 testing plan → present in every task

- **Type consistency**: `Tool` interface from `runtime/tool-pool.ts` is used by every `*.tool.ts` file. `PersonaDef` from `runtime/send-message.ts` is what every persona module conforms to. `RawToolCall` and `RunOutput` types live in `runtime/query-engine.ts`. No name collisions noted.

- **Placeholder scan**: each task contains complete code blocks for new files. Migrated tools (Tasks 11–14) reference existing functions in `agents/{extractor,generator,clarifier,prefetch}.ts` by exact filename — these files stay in place; tools wrap them. No "implement later" or "similar to Task N" placeholders.

- **Open question on retry policy**: the spec calls for transport-layer retry max 2 with exponential backoff — implementation lives in existing `apps/api/src/llm/logger.ts`. If logger.ts does not currently implement retry, that needs a separate small task. Verify in Task 21 step 3 by reading logger.ts; if absent, add a Task 21.5.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-01-v2-harness-multi-agent.md`. Three execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks (uses `superpowers:subagent-driven-development`)

**2. Inline Execution** — Execute in this session via `superpowers:executing-plans`, with checkpoints for review

**3. Parallel Execution (no confirmation)** — Dispatch 2 independent tasks simultaneously, no mid-flight confirmation (uses `superpowers:fire-parallel-tasks`). Note: most tasks here have linear dependencies (runtime → personas → tools → integration), so parallelism is mostly limited to within-phase tasks. Best candidates for parallel pairs: Tasks 3+4, Tasks 9+10 (after `_compactor` from Task 8 lands), Tasks 12+13+14 (after the runtime+personas land).

**Which approach?**
