# LLM Call Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every LLM call (console + Postgres) via a thin wrapper in `apps/api/src/llm/logger.ts`, with zero impact on business logic when DB is unavailable.

**Architecture:** A new `logger.ts` exports `loggedCompletion`, `loggedStream`, and `withSessionContext`. Session/run context is propagated via `AsyncLocalStorage` (set once in `sessions.ts`); agent names are passed explicitly at each call site. All four existing `llm.chat.completions.create` call sites are replaced. DB writes are fire-and-forget; a new `insertLLMCall` function is added to `persistence/pg.ts`.

**Tech Stack:** Node.js `AsyncLocalStorage` (`node:async_hooks`), `pg` pool (existing), Vitest, TypeScript

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/memory-pg/travel-memory-pg.sql` | Add `llm_calls` table + indexes |
| Create | `packages/memory-pg/scripts/purge-llm-calls.sql` | Manual cleanup template |
| Modify | `apps/api/src/persistence/pg.ts` | Export `insertLLMCall` |
| Create | `apps/api/src/llm/logger.ts` | `withSessionContext`, `loggedCompletion`, `loggedStream` |
| Create | `apps/api/src/llm/logger.test.ts` | Unit tests (3 scenarios) |
| Modify | `apps/api/src/agents/extractor.ts` | Swap LLM call |
| Modify | `apps/api/src/agents/critic.ts` | Swap LLM call |
| Modify | `apps/api/src/agents/generator.ts` | Swap 2 LLM calls |
| Modify | `apps/api/src/routes/sessions.ts` | Wrap SSE loops with `withSessionContext` |
| Modify | `apps/api/src/agents/extractor.test.ts` | Update mock target |
| Modify | `apps/api/src/agents/critic.test.ts` | Update mock target |

---

### Task 1: SQL — add `llm_calls` table

**Files:**
- Modify: `packages/memory-pg/travel-memory-pg.sql`
- Create: `packages/memory-pg/scripts/purge-llm-calls.sql`

- [ ] **Step 1: Append table definition to SQL migration**

Open `packages/memory-pg/travel-memory-pg.sql` and append at the end (after the DROP TABLE statements):

```sql
CREATE TABLE IF NOT EXISTS llm_calls (
  id                uuid        PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  session_id        uuid,
  run_id            text,
  agent             text        NOT NULL,
  model             text        NOT NULL,
  stream            boolean     NOT NULL DEFAULT false,
  request           jsonb       NOT NULL,
  response          jsonb,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  latency_ms        integer     NOT NULL,
  ok                boolean     NOT NULL,
  error_message     text,
  error_code        text
);

CREATE INDEX IF NOT EXISTS llm_calls_session_idx ON llm_calls (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_created_idx ON llm_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_agent_idx   ON llm_calls (agent, created_at DESC);
```

- [ ] **Step 2: Create purge script**

Create `packages/memory-pg/scripts/purge-llm-calls.sql`:

```sql
-- Manual cleanup: delete rows older than 30 days.
-- Edit the INTERVAL before running.
-- DELETE FROM llm_calls WHERE created_at < NOW() - INTERVAL '30 days';
```

- [ ] **Step 3: Commit**

```bash
git add packages/memory-pg/travel-memory-pg.sql packages/memory-pg/scripts/purge-llm-calls.sql
git commit -m "feat(db): add llm_calls table and purge script"
```

---

### Task 2: Add `insertLLMCall` to `persistence/pg.ts`

**Files:**
- Modify: `apps/api/src/persistence/pg.ts`

- [ ] **Step 1: Add the export at the end of the file**

Open `apps/api/src/persistence/pg.ts` and append after the `deleteSession` function:

```ts
export interface LLMCallRow {
  id: string
  sessionId: string | null
  runId: string | null
  agent: string
  model: string
  stream: boolean
  request: unknown
  response: unknown
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  latencyMs: number
  ok: boolean
  errorMessage: string | null
  errorCode: string | null
}

export async function insertLLMCall(row: LLMCallRow): Promise<void> {
  if (!isDatabaseEnabled()) return
  await getPool().query(
    `INSERT INTO llm_calls (
       id, session_id, run_id, agent, model, stream,
       request, response,
       prompt_tokens, completion_tokens, total_tokens,
       latency_ms, ok, error_message, error_code
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb,
       $9, $10, $11,
       $12, $13, $14, $15
     )`,
    [
      row.id, row.sessionId, row.runId, row.agent, row.model, row.stream,
      JSON.stringify(row.request), row.response === null ? null : JSON.stringify(row.response),
      row.promptTokens, row.completionTokens, row.totalTokens,
      row.latencyMs, row.ok, row.errorMessage, row.errorCode,
    ],
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/persistence/pg.ts
git commit -m "feat(db): export insertLLMCall for fire-and-forget logging"
```

---

### Task 3: Create `logger.ts` — write failing tests first

**Files:**
- Create: `apps/api/src/llm/logger.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/api/src/llm/logger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests — verify they FAIL with "Cannot find module"**

```bash
cd apps/api && pnpm test --run logger
```

Expected: `Error: Cannot find module './logger.js'`

---

### Task 4: Implement `logger.ts`

**Files:**
- Create: `apps/api/src/llm/logger.ts`

- [ ] **Step 1: Create the file**

Create `apps/api/src/llm/logger.ts`:

```ts
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { llm } from './client.js'
import { insertLLMCall } from '../persistence/pg.js'
import type OpenAI from 'openai'

interface SessionCtx {
  sessionId: string | null
  runId: string | null
}

const storage = new AsyncLocalStorage<SessionCtx>()

export function withSessionContext<T>(
  sessionId: string,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ sessionId, runId }, fn)
}

function getCtx(): SessionCtx {
  return storage.getStore() ?? { sessionId: null, runId: null }
}

const MAX_REQUEST_BYTES = 256 * 1024

function truncateRequest(req: unknown): unknown {
  const s = JSON.stringify(req)
  if (s.length <= MAX_REQUEST_BYTES) return req
  const r = req as Record<string, unknown>
  if (!Array.isArray(r?.messages)) return req
  return {
    ...r,
    messages: (r.messages as Array<{ content?: unknown }>).map((m) => {
      if (typeof m?.content !== 'string' || m.content.length <= 2000) return m
      return { ...m, content: m.content.slice(0, 2000) + `…[truncated ${m.content.length - 2000} chars]` }
    }),
  }
}

function logLine(
  agent: string,
  model: string,
  latencyMs: number,
  ctx: SessionCtx,
  ok: boolean,
  usage: { prompt?: number | null; completion?: number | null; total?: number | null },
  errorMsg?: string,
): void {
  const sess = ctx.sessionId ? ` session=${ctx.sessionId.slice(0, 8)}` : ''
  const run = ctx.runId ? ` run=${ctx.runId.slice(0, 8)}` : ''
  if (ok) {
    console.log(
      `[llm] agent=${agent} model=${model} ${latencyMs}ms in=${usage.prompt ?? '?'} out=${usage.completion ?? '?'} total=${usage.total ?? '?'}${sess}${run}`,
    )
  } else {
    console.log(`[llm] agent=${agent} model=${model} ${latencyMs}ms ERR msg="${errorMsg ?? 'unknown'}"${sess}${run}`)
  }
}

export async function loggedCompletion(
  agent: string,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const ctx = getCtx()
  const start = Date.now()
  try {
    const resp = await llm.chat.completions.create(params)
    const ms = Date.now() - start
    const u = resp.usage
    logLine(agent, params.model, ms, ctx, true, {
      prompt: u?.prompt_tokens, completion: u?.completion_tokens, total: u?.total_tokens,
    })
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: false,
      request: truncateRequest(params),
      response: { content: resp.choices[0]?.message?.content ?? '', finish_reason: resp.choices[0]?.finish_reason ?? null },
      promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, totalTokens: u?.total_tokens ?? null,
      latencyMs: ms, ok: true, errorMessage: null, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
    return resp
  } catch (err) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as Record<string, unknown>)?.code as string | null ?? null
    logLine(agent, params.model, ms, ctx, false, {}, msg)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: false,
      request: truncateRequest(params), response: null,
      promptTokens: null, completionTokens: null, totalTokens: null,
      latencyMs: ms, ok: false, errorMessage: msg, errorCode: code,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
    throw err
  }
}

export async function* loggedStream(
  agent: string,
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
  const ctx = getCtx()
  const start = Date.now()
  const paramsWithUsage = {
    ...params,
    stream_options: { include_usage: true, ...(params as Record<string, unknown>).stream_options },
  }
  let content = ''
  let ok = true
  let errorMsg: string | null = null
  let promptTokens: number | null = null
  let completionTokens: number | null = null
  let totalTokens: number | null = null
  try {
    const stream = await llm.chat.completions.create({ ...paramsWithUsage, stream: true })
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
      }
      yield chunk
    }
  } catch (err) {
    ok = false
    errorMsg = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const ms = Date.now() - start
    logLine(agent, params.model, ms, ctx, ok, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, errorMsg ?? undefined)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(paramsWithUsage),
      response: ok ? { content, finish_reason: 'stop' } : null,
      promptTokens, completionTokens, totalTokens,
      latencyMs: ms, ok, errorMessage: errorMsg, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
  }
}
```

- [ ] **Step 2: Run tests — verify they PASS**

```bash
cd apps/api && pnpm test --run logger
```

Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/llm/logger.ts apps/api/src/llm/logger.test.ts
git commit -m "feat(llm): add loggedCompletion/loggedStream with async fire-and-forget DB logging"
```

---

### Task 5: Update `extractor.ts` call site

**Files:**
- Modify: `apps/api/src/agents/extractor.ts`

- [ ] **Step 1: Replace import and call site**

In `apps/api/src/agents/extractor.ts`:

Replace line 2:
```ts
import { llm, FAST_MODEL } from '../llm/client.js'
```
with:
```ts
import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
```

Replace lines 87–92 (`llm.chat.completions.create(...)` call):
```ts
// before:
    const resp = await llm.chat.completions.create({
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0,
      response_format: { type: 'json_object' },
    })
```
```ts
// after:
    const resp = await loggedCompletion('extractor', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0,
      response_format: { type: 'json_object' },
    })
```

- [ ] **Step 2: Build to check types**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no TypeScript errors

---

### Task 6: Update `critic.ts` call site

**Files:**
- Modify: `apps/api/src/agents/critic.ts`

- [ ] **Step 1: Replace import and call site**

In `apps/api/src/agents/critic.ts`:

Replace line 1:
```ts
import { llm, FAST_MODEL } from '../llm/client.js'
```
with:
```ts
import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
```

Replace the `llm.chat.completions.create(...)` call (lines 52–57):
```ts
// before:
    resp = await llm.chat.completions.create({
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
```
```ts
// after:
    resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
```

- [ ] **Step 2: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

---

### Task 7: Update `generator.ts` — two call sites

**Files:**
- Modify: `apps/api/src/agents/generator.ts`

- [ ] **Step 1: Replace import**

Replace line 2:
```ts
import { llm, PLANNER_MODEL } from '../llm/client.js'
```
with:
```ts
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedCompletion, loggedStream } from '../llm/logger.js'
```

- [ ] **Step 2: Replace call in `runWithToolLoop` (line ~156)**

```ts
// before:
    const resp = await llm.chat.completions.create({
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3, stream: false,
    })
```
```ts
// after:
    const resp = await loggedCompletion('generator', {
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3,
    })
```

Note: remove `stream: false` — `loggedCompletion` types only accept non-streaming params.

- [ ] **Step 3: Replace streaming call in `runInitial` (line ~201)**

```ts
// before:
  const stream = await llm.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [...prepared.messages, { role: 'system', content: '现在请基于上述 tool 结果生成最终行程，输出 NL + ```json 代码块。' }],
    tools, tool_choice: 'none',
    stream: true, stream_options: { include_usage: true }, temperature: 0.7,
  })

  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of stream) {
```
```ts
// after:
  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of loggedStream('generator', {
    model: PLANNER_MODEL,
    messages: [...prepared.messages, { role: 'system', content: '现在请基于上述 tool 结果生成最终行程，输出 NL + ```json 代码块。' }],
    tools, tool_choice: 'none',
    temperature: 0.7,
  })) {
```

Close the `for await` block at the same point as the original (end of the stream loop, before `if (!inJson && nlBuf.trim())`).

- [ ] **Step 4: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no TypeScript errors

---

### Task 8: Wrap SSE loops in `sessions.ts`

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`

- [ ] **Step 1: Add import**

At the top of `apps/api/src/routes/sessions.ts`, add after the existing imports:

```ts
import { withSessionContext } from '../llm/logger.js'
```

- [ ] **Step 2: Wrap the `POST /:id/messages` SSE loop**

Find the `streamSSE` callback in the `/:id/messages` handler. Wrap the inner loop:

```ts
// before:
  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      for await (const ev of runReactLoop(fresh, runId)) {
        await send(ev)
        if (ev.type === 'token') assistantContent += ev.delta
      }
    } catch (err) {
```
```ts
// after:
  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId)) {
          await send(ev)
          if (ev.type === 'token') assistantContent += ev.delta
        }
      })
    } catch (err) {
```

- [ ] **Step 3: Wrap the `POST /:id/continue` SSE loop similarly**

```ts
// before:
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      for await (const ev of runReactLoop(fresh, runId)) await send(ev)
    } catch (err) {
```
```ts
// after:
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId)) await send(ev)
      })
    } catch (err) {
```

- [ ] **Step 4: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

---

### Task 9: Fix existing tests

**Files:**
- Modify: `apps/api/src/agents/extractor.test.ts`
- Modify: `apps/api/src/agents/critic.test.ts`

- [ ] **Step 1: Update `extractor.test.ts` mock target**

Replace the entire `vi.mock('../llm/client.js', ...)` block:

```ts
// before:
vi.mock('../llm/client.js', () => ({
  llm: {
    chat: { completions: { create: vi.fn() } },
  },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
```
```ts
// after:
vi.mock('../llm/logger.js', () => ({
  loggedCompletion: vi.fn(),
}))

import { loggedCompletion } from '../llm/logger.js'
```

Replace all `(llm.chat.completions.create as any).mockResolvedValue(...)` with `(loggedCompletion as any).mockResolvedValue(...)`.

- [ ] **Step 2: Update `critic.test.ts` mock target**

Same pattern:

```ts
// before:
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
```
```ts
// after:
vi.mock('../llm/logger.js', () => ({
  loggedCompletion: vi.fn(),
}))

import { loggedCompletion } from '../llm/logger.js'
```

Replace `(llm.chat.completions.create as any)` with `(loggedCompletion as any)` throughout.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/bill/travel-agent && pnpm -r test --run
```

Expected: all suites PASS

- [ ] **Step 4: Final commit**

```bash
git add apps/api/src/agents/extractor.ts apps/api/src/agents/critic.ts apps/api/src/agents/generator.ts apps/api/src/routes/sessions.ts apps/api/src/agents/extractor.test.ts apps/api/src/agents/critic.test.ts
git commit -m "feat(llm): wire loggedCompletion/loggedStream at all call sites"
```
