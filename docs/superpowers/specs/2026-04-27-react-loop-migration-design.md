# Design: Pure ReAct Architecture Migration

**Date**: 2026-04-27  
**Status**: Approved

---

## Context

The travel-agent currently uses a **hardcoded scripted pipeline**: code unconditionally sequences extractor → prefetch → generator → evaluator → refine. The LLM executes *within* each step but has no role in orchestrating them.

**Goal**: Transform this into a **true ReAct loop** (mirroring claude-code-haha's `query.ts` pattern) — a main Orchestrator LLM reasons about what to do next, dynamically calls subagents as tools, receives their results, and decides when the plan is good enough.

**Key constraint**: Each planning step runs as an **isolated subagent** — receiving only what the orchestrator explicitly passes, with no shared conversation history.

---

## Architecture

### Before (scripted pipeline)
```
Code → extractor → prefetch → generator → evaluator → refine
         └── LLM only executes inside each step, code controls order
```

### After (LLM-orchestrated ReAct)
```
Orchestrator LLM ←→ while(true) loop
  ↳ call_extractor subagent    (isolated: user messages only)
  ↳ call_prefetch subagent     (isolated: TripBrief only)
  ↳ call_generator subagent    (isolated: brief + prefetch context)
  ↳ call_evaluator subagent    (isolated: Plan only)
  ↳ call_refiner subagent      (isolated: Plan + issues list)
  ↳ call_clarifier subagent    (isolated: missing-info reason → halts loop)
```

---

## Core Loop

```typescript
async function* runReactLoop(session, runId): AsyncGenerator<ChatStreamEvent> {
  let state: LoopState = {
    messages: buildOrchestratorSystemPrompt() + buildUserMessages(session),
    tools: buildSubagentTools(session, runId, emit),
    turnCount: 0,
    runId,
  }

  while (true) {
    if (isCancelled(session, runId)) return

    const { assistantMessages, toolUseBlocks } = yield* streamOrchestratorResponse(state)
    yield* emitReasoningTokens(assistantMessages)   // → tool_reasoning events

    if (toolUseBlocks.length === 0) {
      yield { type: 'done', converged: true, messageId: runId }
      return
    }

    const { toolResults, shouldHalt } = yield* executeSubagents(toolUseBlocks, state)
    if (shouldHalt) return   // call_clarifier was invoked

    state = {
      ...state,
      messages: [...state.messages, ...assistantMessages, ...toolResults],
      turnCount: state.turnCount + 1,
    }
  }
}
```

---

## SubagentTool Interface

```typescript
interface SubagentTool {
  name: string
  description: string                  // Fed to orchestrator LLM
  inputSchema: ZodType                 // What orchestrator must pass
  isConcurrencySafe(): boolean         // Read-only → true; writes session → false
  runSubagent(
    input: unknown,
    session: SessionState,
    emit: EmitFn
  ): Promise<SubagentResult>
}

type SubagentResult =
  | { type: 'ok'; output: string }
  | { type: 'halt'; reason: 'clarification_requested' }
```

---

## Subagent Definitions

| Tool | Concurrent-safe | Input | Wraps | Emits |
|---|---|---|---|---|
| `call_extractor` | ✅ | user message strings | `extractor.ts` | — |
| `call_prefetch` | ✅ | TripBrief JSON | `prefetch.ts` | `agent_step` |
| `call_generator` | ❌ | brief + context + language | `generator.runInitial` | `token`, `plan`, `agent_step` |
| `call_evaluator` | ✅ | Plan JSON | `evaluator.ts` | `score`, `agent_step` |
| `call_refiner` | ❌ | Plan JSON + issues array | `generator.runRefine` | `agent_step` |
| `call_clarifier` | ❌ | missing-info reason | `clarifier.ts` | `clarify_needed` → halts |

Existing agent files (`extractor.ts`, `prefetch.ts`, `generator.ts`, `evaluator.ts`, `critic.ts`, `clarifier.ts`) are **preserved unchanged**. Each subagent tool is a thin wrapper.

---

## Tool Execution (from claude-code-haha `toolOrchestration.ts`)

- Consecutive read-only tools → run concurrently with `Promise.all`
- Write tools → flush any pending concurrent batch first, then run serially
- `call_clarifier` result `{ type: 'halt' }` → loop exits after current turn

---

## Orchestrator System Prompt

Describes the goal (excellent travel itinerary) and available tools. Does **not** prescribe call order — the LLM reasons freely. Uses `LLM_MODEL_PLANNER` (same model as current generator).

---

## SSE Events

**New event**:
```typescript
{ type: 'tool_reasoning', delta: string }
```
Orchestrator's streaming reasoning text between tool calls. Frontend displays in distinct style (gray/italic) vs `token` events (plan narrative).

**Unchanged**: `agent_step`, `token`, `plan`, `score`, `clarify_needed`, `done`, `error`

---

## Files

### New
```
apps/api/src/agents/tools/
  types.ts, extract-brief.tool.ts, prefetch-context.tool.ts,
  generate-plan.tool.ts, evaluate-plan.tool.ts, refine-plan.tool.ts,
  ask-clarification.tool.ts, index.ts
apps/api/src/agents/tool-execution.ts
```

### Rewritten
```
apps/api/src/agents/react-loop.ts
```

### Modified
```
packages/shared/src/events.ts             — add tool_reasoning
apps/web/composables/useChatStream.ts     — handle tool_reasoning
apps/web/stores/chat.ts                   — optional: separate reasoning tokens
```

### Preserved (wrapped, not modified)
```
apps/api/src/agents/{extractor,prefetch,generator,evaluator,critic,clarifier}.ts
apps/api/src/session/store.ts
apps/api/src/routes/sessions.ts
```

---

## Verification

1. `pnpm -r test` — all unit tests pass
2. Happy path: complete trip request → orchestrator reasons, calls subagents, `plan` + `done` events fire
3. Clarification path: vague request → `call_clarifier` invoked, `clarify_needed` fires, loop halts
4. Refine path: continue session → `call_evaluator` then conditional `call_refiner`
5. Frontend: ReAct cards show subagent steps; `tool_reasoning` in distinct style
6. Cancellation: new message mid-loop → old loop exits cleanly via `isCancelled()`
