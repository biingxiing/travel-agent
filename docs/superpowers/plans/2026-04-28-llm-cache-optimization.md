# LLM Prompt Cache Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one agent that breaks prompt-cache prefix invariant (Clarifier), add `cached_tokens` PG column, and wire defensive cached-token logging so cache hits become observable.

**Architecture:** Four self-contained tasks in dependency order: (A) doc-only invariant rule → (B) Clarifier refactor → (C-pg) PG schema + interface → (C-log) Logger wires `cachedTokens` through. C-pg before C-log because `logger.ts` must import `LLMCallRow` which gains a new field.

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg` pool), OpenAI SDK, pnpm monorepo.

---

## File Map

| File | Task | Change |
|---|---|---|
| `CLAUDE.md` | A | Add one bullet to Working Guidelines |
| `apps/api/src/agents/clarifier.ts` | B | Extract static `SYSTEM_PROMPT_CLARIFIER`; move dynamic vars to user message |
| `apps/api/src/agents/clarifier.test.ts` | B | Add `REASONING_EFFORT: undefined` to mock (matches logger.test.ts fix) |
| `packages/memory-pg/travel-memory-pg.sql` | C-pg | Add `cached_tokens integer` to CREATE TABLE + idempotent ALTER TABLE |
| `apps/api/src/persistence/pg.ts` | C-pg | Add `cachedTokens` to `LLMCallRow`; add `$16` to INSERT |
| `apps/api/src/llm/logger.ts` | C-log | `cachedTokens` variable in both loops; new `logLine` param; wire to `insertLLMCall` |
| `apps/api/src/llm/logger.test.ts` | C-log | Add 2 test cases for `cached_tokens` |

---

## Task A: Add cache invariant rule to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Working Guidelines section)

- [ ] **Step 1: Add one bullet to Working Guidelines**

Open `CLAUDE.md`. In the `## Working Guidelines` section, add after the existing `stream: true` bullet:

```markdown
- **LLM cache invariant**: Every agent's first `messages[0]` must be a static `const` string with no runtime interpolation. Dynamic trip data, user state, and session context belong in subsequent `user` or `system` messages. Violating this prevents OpenAI prefix cache hits.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add LLM cache invariant to working guidelines"
```

---

## Task B: Fix Clarifier — static system prompt

**Files:**
- Modify: `apps/api/src/agents/clarifier.ts`
- Modify: `apps/api/src/agents/clarifier.test.ts`

- [ ] **Step 1: Add REASONING_EFFORT to test mock**

In `apps/api/src/agents/clarifier.test.ts`, update the `vi.mock('../llm/client.js', ...)` factory to include `REASONING_EFFORT: undefined` (same fix already applied to `logger.test.ts`):

```typescript
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
  REASONING_EFFORT: undefined,
}))
```

- [ ] **Step 2: Run existing tests to confirm current state**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/clarifier.test.ts
```

Expected: all 4 tests pass (if any fail, fix before proceeding).

- [ ] **Step 3: Extract static SYSTEM_PROMPT_CLARIFIER**

In `apps/api/src/agents/clarifier.ts`, add a module-scope constant after the `FALLBACKS` declaration (around line 26):

```typescript
const SYSTEM_PROMPT_CLARIFIER = `You are a travel planning assistant. Ask the user about a missing field of their trip plan.
Constraints:
- One warm, conversational sentence, max 20 words
- Do NOT repeat information the user already provided
- Output only the question, no preamble or explanation
- Write the question in the requested output language`
```

- [ ] **Step 4: Replace dynamic systemPrompt with static constant + dynamic user message**

Inside `generateClarification`, replace lines 61–66 (the `const systemPrompt = ...` block) and lines 73–76 (the messages array) with:

```typescript
  const userMessage =
    `Known trip info: ${briefSummary(brief)}\n` +
    `Missing field: ${fieldLabel}\n` +
    `Output language: ${language}\n` +
    `Generate the clarification question.`

  const fallback = getFallback(reason, language)
  let question: string = fallback.question
  try {
    const resp = await loggedCompletion('clarifier', {
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_CLARIFIER },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 60,
    })
```

The rest of the function (from `const raw = resp.choices[0]...`) is unchanged.

- [ ] **Step 5: Run tests to verify no regression**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/clarifier.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/clarifier.ts apps/api/src/agents/clarifier.test.ts
git commit -m "refactor(clarifier): extract static SYSTEM_PROMPT_CLARIFIER, move dynamic context to user message"
```

---

## Task C-pg: Add cached_tokens to PG schema and LLMCallRow

**Files:**
- Modify: `packages/memory-pg/travel-memory-pg.sql`
- Modify: `apps/api/src/persistence/pg.ts`

- [ ] **Step 1: Add column to CREATE TABLE in travel-memory-pg.sql**

In `packages/memory-pg/travel-memory-pg.sql`, inside the `CREATE TABLE IF NOT EXISTS llm_calls (...)` block, add `cached_tokens` after `total_tokens`:

```sql
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cached_tokens     integer,
  latency_ms        integer     NOT NULL,
```

- [ ] **Step 2: Add idempotent ALTER TABLE at end of file**

Append to the end of `packages/memory-pg/travel-memory-pg.sql` (after the existing CREATE INDEX lines):

```sql
-- Add cached_tokens column to existing databases (idempotent)
ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS cached_tokens INTEGER;
```

- [ ] **Step 3: Update LLMCallRow interface in pg.ts**

In `apps/api/src/persistence/pg.ts`, add `cachedTokens` to the `LLMCallRow` interface (after `totalTokens`):

```typescript
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
  cachedTokens: number | null        // ← new
  latencyMs: number
  ok: boolean
  errorMessage: string | null
  errorCode: string | null
}
```

- [ ] **Step 4: Update insertLLMCall to include cached_tokens**

In `apps/api/src/persistence/pg.ts`, update `insertLLMCall` to insert `cached_tokens` as `$16`:

```typescript
export async function insertLLMCall(row: LLMCallRow): Promise<void> {
  if (!isDatabaseEnabled()) return
  await getPool().query(
    `INSERT INTO llm_calls (
       id, session_id, run_id, agent, model, stream,
       request, response,
       prompt_tokens, completion_tokens, total_tokens, cached_tokens,
       latency_ms, ok, error_message, error_code
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb,
       $9, $10, $11, $12,
       $13, $14, $15, $16
     )`,
    [
      row.id, row.sessionId, row.runId, row.agent, row.model, row.stream,
      JSON.stringify(row.request), row.response === null ? null : JSON.stringify(row.response),
      row.promptTokens, row.completionTokens, row.totalTokens, row.cachedTokens,
      row.latencyMs, row.ok, row.errorMessage, row.errorCode,
    ],
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/memory-pg/travel-memory-pg.sql apps/api/src/persistence/pg.ts
git commit -m "feat(pg): add cached_tokens column to llm_calls table"
```

---

## Task C-log: Wire cached_tokens through logger

**Files:**
- Modify: `apps/api/src/llm/logger.ts`
- Modify: `apps/api/src/llm/logger.test.ts`

- [ ] **Step 1: Write the two failing tests first**

In `apps/api/src/llm/logger.test.ts`, add a new `describe('cached_tokens observability', ...)` block after the existing `describe('reasoning_effort injection', ...)` block:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts
```

Expected: the 2 new tests FAIL (cachedTokens not yet in logger or insertLLMCall call).

- [ ] **Step 3: Update logLine signature**

In `apps/api/src/llm/logger.ts`, replace the `logLine` function (lines 44–64) with the new version that accepts `cached` between `usage` and `effort`:

```typescript
function logLine(
  agent: string,
  model: string,
  latencyMs: number,
  ctx: SessionCtx,
  ok: boolean,
  usage: { prompt?: number | null; completion?: number | null; total?: number | null },
  cached: number | null,
  effort: string | undefined,
  errorMsg?: string,
): void {
  const sess = ctx.sessionId ? ` session=${ctx.sessionId.slice(0, 8)}` : ''
  const run = ctx.runId ? ` run=${ctx.runId.slice(0, 8)}` : ''
  const eff = effort ? ` effort=${effort}` : ''
  const cach = cached && cached > 0 ? ` cached=${cached}` : ''
  if (ok) {
    console.log(
      `[llm] agent=${agent} model=${model}${eff}${cach} ${latencyMs}ms in=${usage.prompt ?? '?'} out=${usage.completion ?? '?'} total=${usage.total ?? '?'}${sess}${run}`,
    )
  } else {
    console.log(`[llm] agent=${agent} model=${model}${eff}${cach} ${latencyMs}ms ERR msg="${errorMsg ?? 'unknown'}"${sess}${run}`)
  }
}
```

- [ ] **Step 4: Add cachedTokens variable and chunk reader in loggedCompletion**

In `loggedCompletion`, after the existing token variables (around line 81), add:

```typescript
  let cachedTokens: number | null = null
```

Inside the `for await (const chunk of stream)` loop, after the existing `if (chunk.usage)` block, extend it to read `prompt_tokens_details`:

```typescript
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
        const details = (chunk.usage as Record<string, unknown>).prompt_tokens_details
        if (details && typeof details === 'object') {
          const c = (details as Record<string, unknown>).cached_tokens
          if (typeof c === 'number' && c > 0) cachedTokens = c
        }
      }
    }
```

- [ ] **Step 5: Update logLine and insertLLMCall calls in loggedCompletion**

In the success path of `loggedCompletion` (after the loop, around line 99), pass `cachedTokens` as the new 7th argument to `logLine`:

```typescript
    logLine(agent, params.model, ms, ctx, true, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, cachedTokens, resolveEffort(params as Record<string, unknown>))
```

In the `insertLLMCall` call in the success path, add `cachedTokens`:

```typescript
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(params),
      response: { content, finish_reason: finishReason ?? 'stop' },
      promptTokens, completionTokens, totalTokens, cachedTokens,
      latencyMs: ms, ok: true, errorMessage: null, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
```

In the error path, pass `null` for `cachedTokens` to both `logLine` and `insertLLMCall`:

```typescript
    logLine(agent, params.model, ms, ctx, false, {}, null, resolveEffort(params as Record<string, unknown>), msg)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(params), response: null,
      promptTokens: null, completionTokens: null, totalTokens: null, cachedTokens: null,
      latencyMs: ms, ok: false, errorMessage: msg, errorCode: code,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
```

- [ ] **Step 6: Add cachedTokens variable and chunk reader in loggedStream**

In `loggedStream`, after the existing token variables (around line 164), add:

```typescript
  let cachedTokens: number | null = null
```

Inside the `for await (const chunk of stream)` loop, extend the `if (chunk.usage)` block:

```typescript
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
        const details = (chunk.usage as Record<string, unknown>).prompt_tokens_details
        if (details && typeof details === 'object') {
          const c = (details as Record<string, unknown>).cached_tokens
          if (typeof c === 'number' && c > 0) cachedTokens = c
        }
      }
      yield chunk
    }
```

- [ ] **Step 7: Update logLine and insertLLMCall calls in loggedStream finally block**

In the `finally` block of `loggedStream` (around line 186), pass `cachedTokens`:

```typescript
    logLine(agent, params.model, ms, ctx, ok, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, cachedTokens, resolveEffort(params as Record<string, unknown>), errorMsg ?? undefined)
```

And in the `insertLLMCall` call:

```typescript
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(paramsWithUsage),
      response: ok ? { content, finish_reason: 'stop' } : null,
      promptTokens, completionTokens, totalTokens, cachedTokens,
      latencyMs: ms, ok, errorMessage: errorMsg, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
```

- [ ] **Step 8: Run logger tests to verify all pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts
```

Expected: all tests pass (was 9, now 11).

- [ ] **Step 9: Run full test suite**

```bash
pnpm -r test
```

Expected: all tests pass across all packages.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/llm/logger.ts apps/api/src/llm/logger.test.ts
git commit -m "feat(logger): add defensive cached_tokens logging and DB persistence"
```

---

## Verification Checklist

- [ ] `pnpm --filter @travel-agent/api exec vitest run src/agents/clarifier.test.ts` — 4/4 pass
- [ ] `pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts` — 11/11 pass
- [ ] `pnpm -r test` — full suite green
- [ ] After deploy: run a planning session, open sub2api admin dashboard, check `cache_read_input_tokens` column in usage_logs — any increase confirms upstream cache is being observed
- [ ] If `cache_read_input_tokens > 0` in dashboard, query PG: `SELECT agent, cached_tokens, prompt_tokens FROM llm_calls ORDER BY created_at DESC LIMIT 20` — the `cached_tokens` column should match
