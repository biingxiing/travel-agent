# LLM Call Logging — Design Spec

**Date:** 2026-04-25
**Scope:** `apps/api` + `packages/memory-pg`
**Status:** Approved

---

## Overview

Every LLM call (extractor, generator-initial, generator-refine, evaluator, critic) is logged to the console and, when `DATABASE_URL` is configured, persisted to a new `llm_calls` PG table. Logging is async fire-and-forget: a failed DB write never blocks or errors the business path.

---

## Architecture

### New file: `apps/api/src/llm/logger.ts`

Exports three things:

| Export | Purpose |
|---|---|
| `loggedCompletion(params)` | Wraps `llm.chat.completions.create` (non-streaming). Same signature & return type as the SDK call. |
| `loggedStream(params)` | Wraps `llm.chat.completions.create({ stream: true })`. Returns an AsyncIterable transparent to the caller; accumulates deltas internally. |
| `withLLMContext(meta, fn)` | Sets `{ sessionId, runId, agent }` into `AsyncLocalStorage` for the duration of `fn`. |

`logger.ts` internally reads the current context via `AsyncLocalStorage`. If context is missing (e.g., a future background job) it falls back to `{ sessionId: null, runId: null, agent: 'unknown' }`.

### Call-site changes (4 files)

| File | Line | Change |
|---|---|---|
| `apps/api/src/agents/extractor.ts` | 87 | `llm.chat.completions.create` → `loggedCompletion` |
| `apps/api/src/agents/generator.ts` | 156 | `llm.chat.completions.create` → `loggedCompletion` |
| `apps/api/src/agents/generator.ts` | 201 | `llm.chat.completions.create` (stream) → `loggedStream` |
| `apps/api/src/agents/critic.ts` | 52 | `llm.chat.completions.create` → `loggedCompletion` |

Agent function signatures are **unchanged** — context is threaded via `AsyncLocalStorage`.

### Context injection in `react-loop.ts`

Wrap each agent invocation with `withLLMContext`:

```ts
yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
const ext = await withLLMContext(
  { sessionId: session.id, runId, agent: 'extractor' },
  () => extractBrief(session.messages, session.brief),
)
```

The evaluator internally calls `critic.ts`. To ensure the critic's LLM call is logged under `agent: 'critic'` rather than `agent: 'evaluator'`, `evaluator.ts` wraps the `criticReview()` call with its own `withLLMContext({ agent: 'critic' })` — overriding the outer context for that nested call only.

---

## Database Schema

Added to `packages/memory-pg/travel-memory-pg.sql` (appended, idempotent):

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

**Field notes:**
- `session_id` — nullable UUID, no FK constraint (avoids cascade deletes and circular deps with `sessions` table).
- `request` — full params object (`messages`, `temperature`, `response_format`, etc.). Serialized to jsonb. If the serialized JSON string exceeds 256 KB, the `messages` array's content strings are truncated and the final chars replaced with `…[truncated N chars]`.
- `response` — `{ content: string, finish_reason: string }`. For streams: assembled from all deltas after iteration ends.
- Token fields — read from `resp.usage`; null if provider doesn't return them. For streaming, `stream_options: { include_usage: true }` is appended automatically; gracefully falls back to null if unsupported.
- `error_code` — e.g. `rate_limit_exceeded`, taken from OpenAI SDK error type when available.
- No `user_id` — derivable via `JOIN sessions ON sessions.id = llm_calls.session_id`.

**Retention:** Permanent. Manual cleanup script provided at `packages/memory-pg/scripts/purge-llm-calls.sql` (template with configurable interval, commented by default).

---

## Console Log Format

One line per call, emitted after the call resolves or rejects:

```
[llm] agent=extractor model=codex-mini-latest 1842ms in=234 out=89 total=323 ok session=ab12 run=run-9f
[llm] agent=generator model=gpt-5.4 4501ms ERR session=ab12 run=run-9f msg="rate_limit_exceeded"
```

---

## Stream Handling

`loggedStream(params)` does the following:

1. Appends `stream_options: { include_usage: true }` to params.
2. Calls `llm.chat.completions.create({ ...params, stream: true })`.
3. Returns a new `AsyncGenerator` that:
   - Yields each chunk to the caller (transparent pass-through).
   - Accumulates `chunk.choices[0]?.delta?.content ?? ''` internally.
   - On the final chunk (or after the generator exhausts), triggers the async DB insert with the assembled content.
4. If the caller breaks early (e.g., cancellation via `lastRunId`), the accumulated partial content is still persisted with `finish_reason: 'cancelled'`.

---

## Error Handling

```
LLM call throws
  └─ loggedCompletion/loggedStream catches
       ├─ records ok=false row (fire-and-forget)
       └─ re-throws original error
            └─ agent's existing catch handles it (no behavior change)

insertLLMCall throws (DB unavailable)
  └─ console.warn only — never propagates
```

When `DATABASE_URL` is not set, `insertLLMCall` is a no-op (returns immediately).

---

## Testing

**New:** `apps/api/src/llm/logger.test.ts`

| Test | What it verifies |
|---|---|
| Non-streaming success | `insertLLMCall` called with correct fields: `ok=true`, `agent`, `model`, `latency > 0`, token counts |
| Streaming success | Caller receives all deltas; `insertLLMCall` called after iteration with assembled `response.content` |
| LLM error | `insertLLMCall` called with `ok=false` + `error_message`; original error is re-thrown |

**Existing tests:** `extractor.test.ts` and `critic.test.ts` mock `llm.chat.completions.create`. After the change they need to mock `loggedCompletion` from `../llm/logger` instead — assertion behavior unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/llm/logger.ts` | New: `loggedCompletion`, `loggedStream`, `withLLMContext`, `insertLLMCall` |
| `apps/api/src/agents/react-loop.ts` | Wrap each agent call with `withLLMContext` |
| `apps/api/src/agents/extractor.ts` | `llm.chat.completions.create` → `loggedCompletion` |
| `apps/api/src/agents/generator.ts` | Same (×2, one stream) |
| `apps/api/src/agents/critic.ts` | Same |
| `apps/api/src/agents/extractor.test.ts` | Update mock target |
| `apps/api/src/agents/critic.test.ts` | Update mock target |
| `packages/memory-pg/travel-memory-pg.sql` | Append `llm_calls` table + indexes |
| `packages/memory-pg/scripts/purge-llm-calls.sql` | New: manual cleanup template |
| `apps/api/src/llm/logger.test.ts` | New: 3 unit tests |
