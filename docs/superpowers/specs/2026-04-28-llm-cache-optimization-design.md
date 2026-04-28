# LLM Prompt Cache Optimization Design

**Date**: 2026-04-28  
**Status**: Approved  
**Scope**: `apps/api/src/agents/`, `apps/api/src/llm/`, `apps/api/src/persistence/pg.ts`

---

## Context & Problem

The travel-agent backend makes 5–7 LLM calls per planning run (extractor → clarifier → generator-initial → critic → generator-refine). Each call is billed by prompt tokens. OpenAI's Responses API caches identical prompt **prefixes** (≥1024 tokens, in 128-token blocks) and returns `cached_tokens` in usage — but only if the prefix is byte-for-byte identical across requests.

Observation source: sub2api admin dashboard (shows `cache_read_input_tokens` per request in usage_logs). Current cache reads are very low.

**Root cause diagnosis** — two categories of problem:

1. **Dynamic content injected into system prompts** breaks prefix identity across calls. Any template substitution in the first message = 100% cache miss.
2. **No client-side observability** of cached_tokens: sub2api conditionally includes `prompt_tokens_details.cached_tokens` in Chat Completions responses only when the upstream value > 0. The app currently never reads this field.

---

## Findings: Per-Agent Audit

| Agent | First system message source | Dynamic substitution | Status |
|---|---|---|---|
| `extractor` | `const SYSTEM_PROMPT` | None | ✅ Compliant |
| `generator-initial` | `SYSTEM_PROMPT_INITIAL.replace('OUTPUT_LANGUAGE', label)` | Language label (stable within session) | ✅ Stable for single-language deploys |
| `generator-refine` | `SYSTEM_PROMPT_REFINE.replace('OUTPUT_LANGUAGE', label)` | Same | ✅ Same |
| `critic` | `SYSTEM_PROMPT_BASE.replace('OUTPUT_LANGUAGE', ...)` | Same | ✅ Same |
| `orchestrator` | `const ORCHESTRATOR_SYSTEM_PROMPT` (static first message) | Second `system` message contains `stateContext` (dynamic) | ✅ Static prefix comes first; dynamic second message is expected |
| **`clarifier`** | String concatenation with `${briefSummary(brief)}`, `${fieldLabel}`, `${language}` | **Three dynamic values in system prompt** | ❌ Fix required |

**Key finding**: only `clarifier` violates the invariant. All other agents are already structured correctly.

**Secondary finding**: clarifier's total prompt is < 1024 tokens, so it would not cache even after the fix. However, fixing it enforces the invariant and prevents the pattern from spreading.

---

## Invariant (to add to CLAUDE.md)

> Every agent's first `messages[0]` must be a **static string literal** (module-scope `const` or `as const`). Dynamic data belongs in subsequent `user` or `system` messages. No template substitution in `messages[0]`.

---

## Design

### Section A — CLAUDE.md Invariant Rule

Add to the **Working Guidelines** section of `CLAUDE.md`:

```
- **LLM cache invariant**: Every agent's first message (`messages[0]`) must be a static `const` string with no runtime interpolation. Dynamic trip data, user state, and session context belong in subsequent `user` or `system` messages. Violating this prevents OpenAI prefix cache hits.
```

No code changes. Doc-only.

---

### Section B — Fix Clarifier

**File**: `apps/api/src/agents/clarifier.ts`

**Before** (lines 61–76):
```typescript
const systemPrompt =
  `You are a travel planning assistant. Known trip info: ${briefSummary(brief)}. ` +
  `Missing field: ${fieldLabel}. ` +
  `Ask for this field in a warm, conversational single sentence (max 20 words). ` +
  `Do not repeat information the user already provided. Output only the question. ` +
  `IMPORTANT: Write the question in this language: ${language}.`

const resp = await loggedCompletion('clarifier', {
  model: FAST_MODEL,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the clarification question.' },
  ],
  ...
})
```

**After**:
```typescript
// Module-scope constant — stable prefix for all clarifier calls
const SYSTEM_PROMPT_CLARIFIER = `You are a travel planning assistant. Ask the user about a missing field of their trip plan.
Constraints:
- One warm, conversational sentence, max 20 words
- Do NOT repeat information the user already provided
- Output only the question, no preamble or explanation
- Write the question in the requested output language`

// Inside generateClarification():
const userMessage =
  `Known trip info: ${briefSummary(brief)}\n` +
  `Missing field: ${fieldLabel}\n` +
  `Output language: ${language}\n` +
  `Generate the clarification question.`

const resp = await loggedCompletion('clarifier', {
  model: FAST_MODEL,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT_CLARIFIER },
    { role: 'user', content: userMessage },
  ],
  ...
})
```

**Impact**:
- System prompt becomes a static module-level constant
- Dynamic data (`briefSummary`, `fieldLabel`, `language`) moves to user message
- Semantic information delivered to the model is identical
- Cache benefit: none immediate (prompt too short), but invariant is enforced

**Risk**:
- Model may weight context slightly differently when constraints come from `system` vs context from `user`. In practice negligible for instruction-following tasks.
- Mitigation: run existing `clarifier.test.ts` (4 cases) before merging.

**Verification**:
```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/clarifier.test.ts
```

---

### Section C — Observability

#### C1: Logger — defensive cached_tokens read

**File**: `apps/api/src/llm/logger.ts`

In both `loggedCompletion` and `loggedStream`, extend the chunk accumulator:

```typescript
let cachedTokens: number | null = null

// inside chunk loop:
if (chunk.usage) {
  promptTokens    = chunk.usage.prompt_tokens    ?? null
  completionTokens = chunk.usage.completion_tokens ?? null
  totalTokens     = chunk.usage.total_tokens     ?? null
  const details   = (chunk.usage as Record<string, unknown>).prompt_tokens_details
  if (details && typeof details === 'object') {
    const c = (details as Record<string, unknown>).cached_tokens
    if (typeof c === 'number' && c > 0) cachedTokens = c
  }
}
```

Extend `logLine` signature — insert `cached` between `usage` and `effort` (so the existing `effort` and `errorMsg` positions shift by one):

```typescript
function logLine(
  agent: string, model: string, latencyMs: number,
  ctx: SessionCtx, ok: boolean,
  usage: { prompt?: number | null; completion?: number | null; total?: number | null },
  cached: number | null,   // ← new, only logged when > 0
  effort: string | undefined,
  errorMsg?: string,
): void
```

Updated log line format:
```
// with cache hit:
[llm] agent=extractor model=gpt-5.4 effort=xhigh cached=2048 1234ms in=2543 out=216 total=2759

// without (most current calls):
[llm] agent=extractor model=gpt-5.4 effort=xhigh 1234ms in=2543 out=216 total=2759
```

The `cached=N` token appears **only when > 0** (no noise when sub2api doesn't return the field).

Pass `cachedTokens` through to `insertLLMCall`.

#### C2: PG migration — add cached_tokens column

**File**: `apps/api/src/persistence/pg.ts` (migration runner)

Add to the migrations array (idempotent):
```sql
ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS cached_tokens INTEGER;
```

Update `insertLLMCall` signature and INSERT to include `cached_tokens`.

**Caveat**: Sub2api currently returns no `cached_tokens` in Chat Completions responses unless upstream explicitly sets it > 0. The column will be mostly `NULL` until prompt-cache hits start occurring. This is expected — it becomes meaningful if/when the backend changes or the prompt structure improvements result in cache hits visible from the upstream.

**Verification**:
- Unit test: mock chunk with `prompt_tokens_details: { cached_tokens: 500 }` → assert log contains `cached=500`, `insertLLMCall` called with `cachedTokens: 500`
- Unit test: mock chunk without `prompt_tokens_details` → assert no `cached=` in log, `insertLLMCall` called with `cachedTokens: null`

---

## What Is Explicitly NOT in Scope

- `prompt_cache_key` injection: sub2api translates this to HTTP routing headers (session_id/conversation_id for ChatGPT upstream), not OpenAI prompt cache keys. No direct benefit for this deployment.
- Padding system prompts to 1024+ tokens artificially.
- Changing generator/critic/orchestrator prompt structure (already compliant).
- Database migration runner script changes (idempotent ALTER TABLE is safe to add inline).

---

## Files Changed

| File | Change |
|---|---|
| `CLAUDE.md` | Add cache invariant rule to Working Guidelines |
| `apps/api/src/agents/clarifier.ts` | Extract static `SYSTEM_PROMPT_CLARIFIER`; move dynamic content to user message |
| `apps/api/src/llm/logger.ts` | Read `prompt_tokens_details.cached_tokens` defensively; extend `logLine` and `loggedStream` |
| `apps/api/src/persistence/pg.ts` | Add migration `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS cached_tokens INTEGER`; update `insertLLMCall` |
| `apps/api/src/llm/logger.test.ts` | Add 2 test cases for cached_tokens logging |

---

## Verification Checklist

1. `pnpm --filter @travel-agent/api exec vitest run src/agents/clarifier.test.ts` — all pass
2. `pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts` — all pass (including 2 new cached_tokens cases)
3. `pnpm -r test` — full suite green
4. After deploy: check sub2api admin dashboard — if any `cache_read_input_tokens > 0` appear, cross-reference `llm_calls.cached_tokens` in PG matches
