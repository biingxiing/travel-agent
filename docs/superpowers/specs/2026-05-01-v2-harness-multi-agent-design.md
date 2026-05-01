# v2.0 Design — Harness & Multi-Agent Foundation

- **Date**: 2026-05-01
- **Author**: brainstormed with Claude Opus 4.7
- **Status**: Draft, pending user review
- **Scope**: Architectural rebuild of `apps/api/src/agents/` to introduce a Claude-Code-style multi-agent runtime as the foundation for v2.1 (capability upgrades) and v2.2 (tool ecosystem & multimodal).

## 1. Summary

v2.0 replaces the single-loop ReAct orchestrator with a **star-topology multi-agent runtime**. A single `Orchestrator` main agent runs the user-facing loop and may spawn `LocalAgent` subagents (in v2.0 only one persona: `Researcher`) over a `SendMessage` primitive. Subagents have isolated context, isolated tool pools, and return strictly typed results.

This version ships **no new user-visible features**. Its goal is to establish the harness, prompt registry, context-engineering, observability, and error-handling primitives that v2.1 (Critic / Planner / Memory) and v2.2 (MCP / multimodal) will build on. The ratchet for "is v2.0 done" is behavioural parity with the current pipeline plus the new structural capabilities.

## 2. Motivation

The current `react-loop.ts` implements a flat tool-calling loop where every step (extract → prefetch → generate → clarify) is a sibling tool of the orchestrator. This has three concrete limitations that block the v2.x roadmap:

1. **No context isolation.** Adding a Critic in v2.1 means another tool reading from and writing into the same orchestrator context, which has been the historical reason refine/eval cycles drift and were removed (commits 5657f03 / b8ab1e6 / 94a6992).
2. **No tool-pool scoping.** When v2.2 adds 8–15 real-world data-source tools (transport, weather, hotel, attraction, map…), exposing them all to the orchestrator bloats its prompt and degrades tool-selection quality. They belong inside a research-scoped agent.
3. **No prompt / context discipline.** Prompts are inlined `const`s with ad-hoc state injection; chat history grows by `slice(-20)` and silently drops state; there is no trace beyond `logger.ts` console output. Each future feature has to reinvent this.

v2.0 rebuilds the harness to remove all three blockers in a single coherent step.

## 3. Goals

- **G1.** A `QueryEngine` runtime that owns the lifecycle of one agent session (main agent or subagent) — message thread, tool pool, cancellation, trace.
- **G2.** A `SendMessage` primitive for parent → child dispatch, supporting parallel spawn within one orchestrator turn.
- **G3.** Strict typed I/O at every spawn boundary (zod-validated payload in, zod-validated result out).
- **G4.** Persona-scoped prompt modules (TS `const` + builder) that satisfy the LLM cache invariant by construction.
- **G5.** Sliding-window + head-summary context compaction, locked once written.
- **G6.** Per-runId JSONL trace + dev-only inspection page.
- **G7.** Behavioural parity with current pipeline (same input → same plan quality).

## 4. Non-Goals (explicit, to prevent scope creep)

| Deferred to | Item |
|---|---|
| v2.1 | Critic / reflection loop |
| v2.1 | Long-term memory, user profile, Dream task |
| v2.1 | Explicit task planner / TODO decomposition |
| v2.2 | MCP integration, real-world data sources |
| v2.2+ | RemoteAgent, out-of-process execution |
| v2.2 | Multimodal input (image / voice) |
| — | Teammate, Bash, Workflow, MCP-Monitor task types |
| — | Subagent depth ≥ 2 (subagents may not spawn subagents in v2.0) |
| — | Prompt A/B testing or hot-reload |
| — | Trace export to OpenTelemetry / PG |

## 5. Architecture

### 5.1 Topology

```
                Main Agent (Orchestrator)
                    │
                    │ SendMessage (typed, parallel-capable)
                    │
              ┌─────┴─────┐
              ↓           ↓
        Researcher    Researcher    ← N concurrent LocalAgent instances per turn
        (LocalAgent)  (LocalAgent)     depth limit = 1
```

### 5.2 Tool vs Subagent — the load-bearing distinction

A **Tool** is a function the LLM can call within its own thread. It may wrap an LLM call (e.g. `extract_brief`), an event emission (`ask_clarification`), or a pure transform. It does **not** have an isolated context.

A **Subagent (LocalAgent)** is a dispatched agent with its own `QueryEngine`, its own message thread, its own tool pool, and a typed input/output. Spawning one is conceptually `await sendMessage('researcher', payload)`. To the orchestrator LLM, this is exposed as a regular `start_research` tool call so the OpenAI tool-calling protocol carries it; underneath, it instantiates a fresh QueryEngine.

### 5.3 Component map

```
apps/api/src/agents/
├── react-loop.ts                # main entry — keeps name, internals rebuilt
├── runtime/                     # NEW — agent harness
│   ├── query-engine.ts          # one agent's lifecycle + LLM stream + tool dispatch
│   ├── send-message.ts          # parent → child typed dispatch (parallel-capable)
│   ├── tool-pool.ts             # ToolPool abstraction + isolation
│   └── trace.ts                 # JSONL writer
├── personas/                    # NEW — per-agent prompt modules
│   ├── orchestrator.ts          # SYSTEM_PROMPT const + buildMessages + zod schemas
│   └── researcher.ts            # SYSTEM_PROMPT const + buildMessages + zod schemas
└── tools/
    ├── orchestrator/            # tools available to main agent
    │   ├── extract-brief.tool.ts
    │   ├── generate-plan.tool.ts
    │   ├── start-research.tool.ts   # NEW — triggers SendMessage to Researcher
    │   └── ask-clarification.tool.ts
    └── researcher/              # tools available inside Researcher's pool
        └── prefetch-context.tool.ts # migrated from current MCP tool
```

The current files `agents/{extractor,prefetch,generator,clarifier}.ts` and `agents/tools/{agent,mcp}/*` are deleted; their LLM call logic moves into the corresponding `tools/orchestrator/*` or `tools/researcher/*` files. `agents/tool-execution.ts` is replaced by `runtime/send-message.ts` + `runtime/query-engine.ts`.

## 6. Runtime Primitives

### 6.1 QueryEngine

One QueryEngine instance manages one agent session:

- Owns a typed `messages: ChatCompletionMessageParam[]`
- Owns a `ToolPool` (set of available tools for this agent)
- Owns a `runId` (root) or `parentRunId` + `childIndex` (subagent)
- Streams LLM completions through `loggedStream`, accumulates content + tool_calls
- On tool_calls, dispatches via the ToolPool; concurrency-safe tools run in `Promise.all`, others serially (preserved from current `tool-execution.ts`)
- Emits trace events through `runtime/trace.ts`
- Honors cancellation: every loop iteration checks `session.lastRunId === rootRunId`; if not, halts itself and all descendants

Lifecycle:
- **Construction**: `new QueryEngine({ persona, toolPool, parent?, runId })`
- **Run**: `await engine.run(input)` → returns typed result (or `{ ok: false, error }`)
- **Disposal**: implicit on `run()` return; flushes trace

### 6.2 SendMessage (parent → child)

```ts
function sendMessage<R>(
  target: 'researcher',
  payload: ResearcherInput,
  parent: QueryEngine,
): Promise<ResearcherOutput>
```

`sendMessage` instantiates a child QueryEngine seeded with `personas/researcher.ts`'s system prompt + the typed payload as a single user message. The child runs its own ReAct loop; on return its zod-validated output is the resolved value. Multiple `sendMessage` calls in the same orchestrator turn run in parallel via `Promise.all`.

### 6.3 ToolPool isolation

Each persona declares its own ToolPool:

- **Orchestrator pool**: `extract_brief`, `generate_plan`, `start_research`, `ask_clarification`
- **Researcher pool**: `prefetch_context` (in v2.0; later joined by `query_transport`, `query_weather`, etc. in v2.2)

The pools are physically separate `SubagentTool[]` arrays; there is no shared registry that leaks one pool into the other. `start_research` is the only bridge — it lives in the orchestrator pool but its execution constructs a Researcher QueryEngine.

### 6.4 LocalAgent lifecycle (v2.0 only type)

```
spawn → seed messages (system + typed user payload) → run ReAct loop
      → return typed output OR { ok: false, error }
      → dispose
```

No persistence between spawns. No state shared with siblings. Cancellation propagates from parent.

## 7. Persona Definitions

### 7.1 Shape

Each persona module exports exactly:

```ts
export const SYSTEM_PROMPT = `…` as const                  // messages[0], static
export const InputSchema = z.object({ … })
export const OutputSchema = z.object({ … })
export type Input  = z.infer<typeof InputSchema>
export type Output = z.infer<typeof OutputSchema>

export function buildMessages(input: Input, /* + history for orchestrator */):
  ChatCompletionMessageParam[]

export const TOOLS: SubagentTool[]                         // this persona's tool pool
```

The `SYSTEM_PROMPT` `as const` is what guarantees cache-invariant compliance. `buildMessages` returns `[{role:'system', content: SYSTEM_PROMPT}, …dynamic…]`.

### 7.2 Orchestrator

- **Inputs to `buildMessages`**: `SessionState` (brief, plan, status, language, compactedHistory).
- **Returned messages**:
  1. `{role:'system', content: SYSTEM_PROMPT}`
  2. (optional) `{role:'system', content: session.compactedHistory}` if present
  3. The last 20 user/assistant turns (sliding window)
  4. `{role:'user', content: 'Session state: …'}` — current state JSON snapshot, refreshed every turn (cache invalidates only at the tail)
- **TOOLS**: `extract_brief`, `generate_plan`, `start_research`, `ask_clarification`.

### 7.3 Researcher

- **InputSchema**: `{ brief: BriefSchema, researchGoals: string[], depth?: 'fast' | 'standard' }`
- **OutputSchema**: `{ ok: true, summary: string, sources: string[] } | { ok: false, error: string }` (initial v2.0 shape; expanded in v2.2 with structured transport/weather/hotel sub-fields)
- **buildMessages**: exactly two — `[system, user(JSON.stringify(input))]`. No chat history, no other session fields.
- **TOOLS**: `prefetch_context` (in v2.0).

## 8. Context Engineering

### 8.1 Sliding window + head summarization

- **Window**: orchestrator's `buildMessages` includes the last 20 user/assistant turns verbatim.
- **Head summary**: when total user/assistant turn count > **10**, the earliest turns falling outside the window get summarized once by `LLM_MODEL_FAST` (one call, structured prompt). The result is stored in `session.compactedHistory: string` and **never modified again**.
- After threshold is crossed: prompt prefix becomes `[system, system(compactedHistory), …last 20…, stateContext]`. Both the SYSTEM_PROMPT and compactedHistory are static once written, preserving cache-prefix hits.

### 8.2 Researcher context

Strictly typed payload. No history. No session-state passthrough. This is what "context isolation" means in practice.

### 8.3 LLM cache invariant — formal restatement

Every persona's `messages[0]` must be a static `const` string. Dynamic content (state, tool results, user input) lives in `messages[1..]`. `buildMessages` enforces this structurally; tests assert `messages[0].content === SYSTEM_PROMPT`.

## 9. SSE Event Contract (v2.0)

The current 14-variant `ChatStreamEventSchema` is reduced to 8. Frontend updated in lockstep. **DB has no preserved data**, so schema breakage is acceptable.

**Kept (8):**

| Variant | Purpose | Notes |
|---|---|---|
| `session` | Session ID handshake | Unchanged |
| `agent_step` | Agent lifecycle: `{ agent, status }` | `agent` enum extended with `'researcher'`. Reused for subagent spawn/done — no new event type needed |
| `token` | Streaming text tokens | Unchanged |
| `plan_partial` | Incremental plan during generation | Kept for UX |
| `plan` | Final plan delivery | Unchanged |
| `clarify_needed` | Clarification request | Unchanged |
| `done` | Stream end + convergence flag | Unchanged |
| `error` | Terminal error | Unchanged |

**Deleted (≥5):** `tool_reasoning`, `assistant_say`, `followup`, `item_options`, `heartbeat`. The exact count depends on whether `tool_running` (mentioned in CLAUDE.md but not surfaced by the audit pass) is present in `events.ts`; if so it is also deleted as opaque-subagent policy obviates it. Final delete list confirmed during implementation by enumerating `events.ts` against this kept set.

**Subagent transparency**: deliberately opaque. Researcher's internal tool calls do not surface to the UI. Frontend sees `agent_step{agent:'researcher', status:'start'}` and later `…status:'done'`. Nothing in between.

## 10. Observability / Trace

- Per-`runId` file at `apps/api/.traces/<runId>.jsonl`.
- One JSON object per line; common fields: `ts`, `agent` (`orchestrator` / `researcher#N`), `event`, persona, model, tokens, etc.
- Event types include: `llm_call_start`, `llm_call_chunk` (sampled), `llm_call_end`, `tool_call`, `tool_result`, `subagent_spawn`, `subagent_return`, `cancelled`.
- New endpoint `GET /dev/traces/:runId` — returns rendered timeline (tree by parent/child agent). **Mounted only when `NODE_ENV !== 'production'` AND user is authenticated.** Does not leak prompts in production.
- Trace files are gitignored; rotation/cleanup deferred (manual `rm -rf .traces` for now).

## 11. Error & Retry Policy

- **Transport-layer retry** (HTTP 5xx / network / timeout): handled in `llm/logger.ts`, exponential backoff, max 2 retries. Already partially present; standardize.
- **Business-layer zero retry**:
  - LocalAgent that fails returns `{ ok: false, error }` as its typed output. The orchestrator LLM sees this in the next turn and decides: retry with different goals, ask user, or proceed degraded. The framework does not silently retry.
  - Schema parse failures (zod rejects payload or output) → emit `error` SSE event, halt run. No silent retry.
- **Cancellation propagation**: every QueryEngine checks `session.lastRunId === rootRunId` before each LLM call. If false, halts and recursively cancels child engines. Existing `lastRunId` mechanism preserved.

## 12. Migration Plan (sketch — full plan in writing-plans phase)

1. Build `runtime/` (QueryEngine, SendMessage, ToolPool, trace) with unit tests, no integration yet.
2. Build `personas/orchestrator.ts` and `personas/researcher.ts` (just SYSTEM_PROMPT + schemas, no integration).
3. Migrate logic: `extractor.ts → tools/orchestrator/extract-brief.tool.ts`, `generator.ts → tools/orchestrator/generate-plan.tool.ts`, `clarifier.ts → tools/orchestrator/ask-clarification.tool.ts`, `prefetch.ts → tools/researcher/prefetch-context.tool.ts`.
4. Implement `tools/orchestrator/start-research.tool.ts` calling `sendMessage`.
5. Rewrite `react-loop.ts` to instantiate the orchestrator QueryEngine.
6. Update `routes/sessions.ts` to reflect 8-variant SSE schema.
7. Update `packages/shared/src/events.ts` to the 8-variant union; update frontend (`useChatStream.ts`, `stores/chat.ts`, components consuming deleted variants).
8. Add head-summarization to context builder.
9. Add trace JSONL + dev endpoint.
10. Delete dead files (`agents/tools/{agent,mcp}/*`, `tool-execution.ts`, the four `agents/{extractor,prefetch,generator,clarifier}.ts` after migration).
11. Run full test suite, smoke `pnpm smoke:auth`, manual UX check.

DB migration: schema may be regenerated since "数据库没有要保留的内容" — we are free to drop and recreate session/message tables if convenient.

## 13. Testing Plan

- `runtime/query-engine.test.ts` — spawn, run, cancel, error, trace emission
- `runtime/send-message.test.ts` — parallel dispatch, typed I/O validation, cancellation propagation
- `runtime/tool-pool.test.ts` — pool isolation (orchestrator pool ≠ researcher pool)
- `runtime/trace.test.ts` — JSONL format, file lifecycle
- `personas/orchestrator.test.ts` — buildMessages cache invariant: `messages[0].content === SYSTEM_PROMPT`
- `personas/researcher.test.ts` — same; mock LLM, assert OutputSchema parses
- `tools/orchestrator/start-research.tool.test.ts` — verifies it produces a valid SendMessage call
- `react-loop.test.ts` — keep as integration test; rewrite assertions to new event set
- Behavioural parity check: a corpus of 5 representative trips (Beijing 3-day, Tokyo 5-day, Guangdong multi-city, etc.) is run through both old and new pipeline; outputs compared for plan completeness (not byte equality).

## 14. Success Criteria

1. All existing E2E behaviour preserved: same query → plan of equivalent quality (manual rubric).
2. Researcher is a true LocalAgent: independent QueryEngine, independent ToolPool, typed I/O, no shared mutable state with parent.
3. Orchestrator can issue ≥2 concurrent `start_research` tool calls in a single turn (verified in test with multi-destination input).
4. JSONL trace covers every LLM call and SendMessage of a single runId end-to-end.
5. After 10+ user turns, head summarization fires once, prompt prefix stabilizes, cache hit rate stays high (verified via `loggedStream` token-usage logs).
6. SSE event count reduced from 14 → 8; no orphaned variants in `events.ts`.

## 15. Open Questions for v2.0 Implementation Phase

- Exact summarization prompt for head summary — needs iteration; will live in `personas/_compactor.ts` (lowercase prefix marks it as runtime helper, not a persona persona).
- Trace file size limit / rotation — defer; revisit if a single runId routinely exceeds 5MB.
- Whether `ask_clarification` deserves to remain a tool or collapse into a structured assistant message — leave as tool for v2.0 to minimize migration churn.

## 16. Hooks for v2.1 / v2.2

The runtime primitives are designed so v2.1 / v2.2 add new files, not rewrite existing ones:

- v2.1 adds `personas/critic.ts` + `tools/orchestrator/start-critique.tool.ts`. No runtime change.
- v2.1 adds `personas/profile-keeper.ts` as a Teammate. Requires extending `runtime/` with the Teammate type — known scope.
- v2.2 adds new tools to `tools/researcher/` for real data sources. Researcher's persona prompt updated, schema extended. No runtime change.
- v2.2 adds `dream` TaskType for memory consolidation. Requires extending `runtime/`.

These are the v2.0 design's acceptance test for being foundation-grade: each future feature should be additive.
