# LLM Output Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every LLM streaming turn produce a deterministic UI outcome — orchestrator narrative is shown, JSON outputs from generator/critic recover from malformed responses, network stalls fail loudly, and every code path emits `done` so the frontend never hangs.

**Architecture:**
- Promote orchestrator narrative (the `delta.content` that arrives alongside `tool_calls`) from a hidden "thinking" event to a first-class `assistant_say` event, rendered as a lighter-styled bubble in `ChatPanel.vue`.
- Surface tool-arg JSON parse failures back to the LLM as explicit `tool_result` errors so it can self-correct, instead of silently calling tools with `{}`.
- Add a small `parseLLMJson` helper used by `critic.ts` and `generator.runRefine` to retry once with a "valid JSON only" reminder before falling back.
- Wrap `loggedStream` with a per-chunk idle watchdog so a stalled sub2api SSE connection becomes a thrown error, not a frozen UI.
- Guarantee `done` (or `error` + `done`) on every loop exit (MAX_TURNS, cancellation, top-level catch).

**Tech Stack:** TypeScript, Vitest, Hono SSE, OpenAI SDK (Chat Completions streaming), Vue 3 + Pinia, Zod schemas in `@travel-agent/shared`.

**Reference docs:**
- sub2api specifics: `docs/sub2api.md` (`finish_reason` is always `"stop"`, `response_format` ignored, `stream:false` broken)
- Existing event contract: `packages/shared/src/events.ts`
- Orchestrator entry: `apps/api/src/agents/react-loop.ts`

---

## File Structure

**Created:**
- `apps/api/src/llm/json-retry.ts` — `parseLLMJson(content, schema, retry)` helper.
- `apps/api/src/llm/json-retry.test.ts` — unit tests for the helper.

**Modified:**
- `packages/shared/src/events.ts` — add `assistant_say` variant to `ChatStreamEventSchema`.
- `packages/shared/src/events.test.ts` — cover the new variant.
- `apps/api/src/agents/react-loop.ts` — emit `assistant_say` / `token` based on whether tool calls follow; always emit `done`; carry tool-arg parse errors.
- `apps/api/src/agents/react-loop.test.ts` — extend tests for new behaviors.
- `apps/api/src/agents/tool-execution.ts` — accept optional `parseError` on `ToolCallBlock`, return it as the tool_result content.
- `apps/api/src/agents/tool-execution.test.ts` — cover the parse-error path.
- `apps/api/src/agents/critic.ts` — use `parseLLMJson`; drop the dead `response_format` arg.
- `apps/api/src/agents/critic.test.ts` — cover retry path.
- `apps/api/src/agents/generator.ts` — use `parseLLMJson` in `runRefine`.
- `apps/api/src/agents/generator.test.ts` — cover retry path in refine.
- `apps/api/src/llm/logger.ts` — add per-chunk idle watchdog to `loggedStream`.
- `apps/api/src/llm/logger.test.ts` — cover idle timeout.
- `apps/api/src/routes/sessions.ts` — emit `done` after error.
- `apps/web/stores/chat.ts` — handle `assistant_say` event.
- `apps/web/components/ChatPanel.vue` — render narration bubbles.
- `apps/web/types/itinerary.ts` *(or wherever `ChatMessage` lives — locate during Task 8)* — add `'narration'` role variant.

---

## Task 1: Add `assistant_say` event to the shared schema

**Files:**
- Modify: `packages/shared/src/events.ts:47-101`
- Test: `packages/shared/src/events.test.ts`

The new event is emitted once per orchestrator turn that produces narrative text BEFORE a tool call. It carries the full assembled text (not per-chunk deltas) so the frontend renders it as a finalized lighter-styled bubble.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/events.test.ts` inside the `ChatStreamEventSchema · variant coverage` describe block (insert before the `parses max_iter_reached` test at line 136):

```typescript
  it('parses assistant_say', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'assistant_say', content: '正在为你查询酒店…',
    })
    expect(e.type).toBe('assistant_say')
  })

  it('rejects assistant_say with empty content', () => {
    expect(() => ChatStreamEventSchema.parse({
      type: 'assistant_say', content: '',
    })).toThrow()
  })
```

Also add to the round-trip variants array at line 166 (insert before the closing `]`):

```typescript
      { type: 'assistant_say', content: '思考一下…' },
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/shared exec vitest run src/events.test.ts
```

Expected: 2 failing tests with "Invalid discriminator value" or similar.

- [ ] **Step 3: Add the variant**

In `packages/shared/src/events.ts`, inside the `z.discriminatedUnion('type', [...])` array (insert after the `tool_reasoning` entry at line 61):

```typescript
  z.object({ type: z.literal('assistant_say'), content: z.string().min(1) }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/shared exec vitest run src/events.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "feat(shared): add assistant_say event for orchestrator narrative"
```

---

## Task 2: Carry tool-arg parse errors through `ToolCallBlock`

**Files:**
- Modify: `apps/api/src/agents/tool-execution.ts:1-58`
- Test: `apps/api/src/agents/tool-execution.test.ts`

Today, `react-loop.ts` silently swallows malformed tool-call JSON and runs the tool with `{}`. We add an optional `parseError` field on `ToolCallBlock`; when set, `runOne` skips tool invocation and returns the error to the LLM as the tool_result so it can retry the call with corrected arguments.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/agents/tool-execution.test.ts` inside the `executeSubagents` describe block:

```typescript
  it('returns parseError as tool_result without invoking the tool', async () => {
    const tool = readTool('a')
    const blocks = [{ id: '1', name: 'a', input: {}, parseError: 'Unexpected token } at position 5' }]
    const { toolResults } = await executeSubagents(blocks, [tool], fakeSession, fakeEmit)
    expect(toolResults[0].content).toContain('invalid JSON arguments')
    expect(toolResults[0].content).toContain('Unexpected token')
    expect(tool.call).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tool-execution.test.ts
```

Expected: FAIL — `parseError` is not yet a known field; tool is still invoked.

- [ ] **Step 3: Add `parseError` to `ToolCallBlock` and handle it in `runOne`**

In `apps/api/src/agents/tool-execution.ts`, replace the `ToolCallBlock` interface (lines 5-9) with:

```typescript
export interface ToolCallBlock {
  id: string
  name: string
  input: Record<string, unknown>
  /** Set when the LLM emitted malformed JSON for tool arguments — surfaced back to the LLM via tool_result. */
  parseError?: string
}
```

Then update `runOne` (lines 38-58) to return the error early:

```typescript
async function runOne(
  block: ToolCallBlock,
  tools: SubagentTool[],
  session: SessionState,
  emit: EmitFn,
): Promise<{ id: string; output: string; shouldHalt: boolean }> {
  if (block.parseError) {
    return {
      id: block.id,
      output: `Error: invalid JSON arguments — ${block.parseError}. Please retry the call with valid JSON matching the tool's parametersSchema.`,
      shouldHalt: false,
    }
  }
  const tool = tools.find(t => t.name === block.name)
  if (!tool) {
    return { id: block.id, output: `Error: unknown tool "${block.name}"`, shouldHalt: false }
  }
  try {
    const result = await tool.call(block.input, session, emit)
    if (result.type === 'halt') {
      return { id: block.id, output: 'Clarification requested from user.', shouldHalt: true }
    }
    return { id: block.id, output: result.output, shouldHalt: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { id: block.id, output: `Tool error: ${msg}`, shouldHalt: false }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tool-execution.test.ts
```

Expected: all tests pass (existing 7 + new 1).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tool-execution.ts apps/api/src/agents/tool-execution.test.ts
git commit -m "feat(tools): surface malformed tool-arg JSON to LLM as tool_result error"
```

---

## Task 3: Fix orchestrator output emission and guarantee `done`

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts:14-151`
- Test: `apps/api/src/agents/react-loop.test.ts`

Three behavioral changes in `streamOrchestrator` + `runReactLoop`:
1. After the stream ends, emit `assistant_say { content: fullContent }` if there are tool calls AND non-empty content; emit `token { delta: fullContent }` if no tool calls AND non-empty content (existing behavior). Keep the per-chunk `tool_reasoning` for live preview.
2. Carry tool-arg parse errors via the new `parseError` field on `ToolCallBlock`.
3. Always emit `done` when the loop exits — including the MAX_TURNS branch and the cancellation branch.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/agents/react-loop.test.ts` inside the `runReactLoop (ReAct)` describe block:

```typescript
  it('emits assistant_say when orchestrator narrates AND calls a tool', async () => {
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

    const sayEvents = emitted.filter(e => e.type === 'assistant_say')
    expect(sayEvents).toHaveLength(1)
    expect(sayEvents[0].content).toBe('让我先理解一下你的需求…')
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
```

Also update the existing `aborts when runId mismatches mid-loop` test (lines 178-199) — flip the assertion: a `done` event IS now expected. Change line 198 from:

```typescript
    expect(events.some(e => e.type === 'done')).toBe(false)
```

to:

```typescript
    expect(events.some(e => e.type === 'done')).toBe(true)
```

And update the existing `emits max_iter_reached when MAX_TURNS exceeded` test (lines 201-217) — assert `done` is also emitted. After the `expect(events.some(e => e.type === 'max_iter_reached')).toBe(true)` line add:

```typescript
    expect(events.some(e => e.type === 'done')).toBe(true)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```

Expected: 5 new tests + 2 modified tests fail.

- [ ] **Step 3: Update `streamOrchestrator` and `runReactLoop`**

Replace the entire content of `apps/api/src/agents/react-loop.ts` with:

```typescript
// apps/api/src/agents/react-loop.ts
import { randomUUID } from 'crypto'
import type OpenAI from 'openai'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedStream } from '../llm/logger.js'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { ALL_TOOLS, toOpenAITools, buildOrchestratorMessages, buildStateContextMessage } from './tools/index.js'
import type { EmitFn, LoopState } from './tools/types.js'
import { executeSubagents } from './tool-execution.js'
import type { ToolCallBlock } from './tool-execution.js'

const MAX_TURNS = 10

async function streamOrchestrator(
  state: LoopState,
  session: SessionState,
  emit: EmitFn,
): Promise<{
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  toolCalls: ToolCallBlock[]
  fullContent: string
}> {
  let fullContent = ''
  const rawToolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  const openAITools = toOpenAITools(state.tools)

  const msgs = state.messages
  const freshCtx = buildStateContextMessage(session)
  const last = msgs[msgs.length - 1]
  const messages = (last?.role === 'system' && typeof last.content === 'string' && last.content.startsWith('Session state:'))
    ? [...msgs.slice(0, -1), freshCtx]
    : [...msgs, freshCtx]

  for await (const chunk of loggedStream('orchestrator', {
    model: PLANNER_MODEL,
    messages,
    tools: openAITools,
    tool_choice: 'auto',
    temperature: 0.3,
  })) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) {
      fullContent += delta.content
      // Per-chunk live preview (kept for future foldable "thinking" UI).
      // Final user-visible emission happens after the stream ends, based on
      // whether tool calls follow.
      await emit({ type: 'tool_reasoning', delta: delta.content } as ChatStreamEvent)
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const existing = rawToolCalls.get(idx) ?? { id: '', name: '', arguments: '' }
        rawToolCalls.set(idx, {
          id: tc.id ? tc.id : existing.id,
          name: tc.function?.name ? tc.function.name : existing.name,
          arguments: existing.arguments + (tc.function?.arguments ?? ''),
        })
      }
    }
  }

  const toolCallsList = Array.from(rawToolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => tc)

  const toolCalls: ToolCallBlock[] = toolCallsList.map(tc => {
    let input: Record<string, unknown> = {}
    let parseError: string | undefined
    try {
      input = tc.arguments ? JSON.parse(tc.arguments) : {}
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }
    return parseError
      ? { id: tc.id, name: tc.name, input, parseError }
      : { id: tc.id, name: tc.name, input }
  })

  const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = toolCalls.length > 0
    ? {
      role: 'assistant',
      content: fullContent || null,
      tool_calls: toolCallsList.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    }
    : { role: 'assistant', content: fullContent }

  return { assistantMessage, toolCalls, fullContent }
}

function isCancelled(session: SessionState, runId: string): boolean {
  return session.lastRunId !== runId
}

export async function* runReactLoop(
  session: SessionState,
  runId: string,
  emit: EmitFn,
): AsyncGenerator<ChatStreamEvent, void, void> {
  let state: LoopState = {
    messages: buildOrchestratorMessages(session),
    tools: ALL_TOOLS,
    turnCount: 0,
    runId,
  }

  while (state.turnCount < MAX_TURNS) {
    if (isCancelled(session, runId)) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const { assistantMessage, toolCalls, fullContent } = await streamOrchestrator(state, session, emit)
    const trimmed = fullContent.trim()

    // No tool calls → orchestrator responded directly with text → final answer.
    if (toolCalls.length === 0) {
      if (trimmed) {
        await emit({ type: 'token', delta: fullContent })
      }
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    // Tool calls present → narrative is a separate user-visible message.
    if (trimmed) {
      await emit({ type: 'assistant_say', content: fullContent })
    }

    if (isCancelled(session, runId)) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const { toolResults, shouldHalt } = await executeSubagents(
      toolCalls, state.tools, session, emit,
    )

    if (shouldHalt) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const toolResultMessages: OpenAI.Chat.ChatCompletionMessageParam[] = toolResults.map(r => ({
      role: 'tool' as const,
      tool_call_id: r.tool_call_id,
      content: r.content,
    }))

    state = {
      ...state,
      messages: [...state.messages, assistantMessage, ...toolResultMessages],
      turnCount: state.turnCount + 1,
    }
  }

  // Reached MAX_TURNS without convergence
  session.status = 'awaiting_user'
  if (session.currentPlan && session.currentScore) {
    yield {
      type: 'max_iter_reached',
      currentScore: session.currentScore.overall,
      plan: session.currentPlan,
    }
  }
  yield { type: 'done', messageId: randomUUID() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```

Expected: all 9 tests pass (4 original + 5 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/react-loop.ts apps/api/src/agents/react-loop.test.ts
git commit -m "fix(react-loop): emit assistant_say for narrative-with-tool-calls; always emit done"
```

---

## Task 4: Add `parseLLMJson` retry helper

**Files:**
- Create: `apps/api/src/llm/json-retry.ts`
- Test: `apps/api/src/llm/json-retry.test.ts`

A small reusable helper for `critic.ts` and `generator.runRefine`. Tries: (1) parse content as-is, (2) extract first `{...}` or `[...]` substring, (3) call a `retry` callback once with a "valid JSON only" reminder, (4) return `null` so callers can apply their own fallback. Schema validation happens after each parse attempt.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/llm/json-retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { parseLLMJson } from './json-retry.js'

const Schema = z.object({ score: z.number() })

describe('parseLLMJson', () => {
  it('returns parsed object on clean JSON', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson('{"score": 80}', Schema, retry)
    expect(result).toEqual({ score: 80 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('extracts JSON from prose wrapping', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson(
      'Sure, here you go: {"score": 75} hope this helps!',
      Schema,
      retry,
    )
    expect(result).toEqual({ score: 75 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('extracts JSON from a fenced markdown block', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson(
      '```json\n{"score": 90}\n```',
      Schema,
      retry,
    )
    expect(result).toEqual({ score: 90 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('calls retry once when initial parse fails', async () => {
    const retry = vi.fn().mockResolvedValue('{"score": 60}')
    const result = await parseLLMJson('Sorry I cannot do that.', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ score: 60 })
  })

  it('calls retry once when content fails schema validation', async () => {
    const retry = vi.fn().mockResolvedValue('{"score": 85}')
    const result = await parseLLMJson('{"score": "not a number"}', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ score: 85 })
  })

  it('returns null when retry also fails', async () => {
    const retry = vi.fn().mockResolvedValue('still garbage')
    const result = await parseLLMJson('garbage', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null and does not retry when retry is not provided', async () => {
    const result = await parseLLMJson('garbage', Schema)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/json-retry.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `parseLLMJson`**

Create `apps/api/src/llm/json-retry.ts`:

```typescript
import type { ZodSchema } from 'zod'

function extractJsonSubstring(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced?.[1]) return fenced[1].trim()
  // Greedy match: first `{` to last `}` (or `[` / `]`) — handles trailing prose.
  const objStart = content.indexOf('{')
  const objEnd = content.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) return content.slice(objStart, objEnd + 1)
  const arrStart = content.indexOf('[')
  const arrEnd = content.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) return content.slice(arrStart, arrEnd + 1)
  return null
}

function tryParse<T>(content: string, schema: ZodSchema<T>): T | null {
  const candidates = [content.trim(), extractJsonSubstring(content)].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate))
    } catch {
      // try next candidate
    }
  }
  return null
}

/**
 * Parse a JSON object out of an LLM response with one retry.
 *
 * Strategy:
 *   1. Try direct JSON.parse + schema validation
 *   2. Try extracting fenced ```json``` or first `{...}` / `[...]` substring
 *   3. If `retry` is provided, call it once (caller appends a "valid JSON only" reminder)
 *   4. Return null if all attempts fail
 */
export async function parseLLMJson<T>(
  content: string,
  schema: ZodSchema<T>,
  retry?: () => Promise<string>,
): Promise<T | null> {
  const first = tryParse(content, schema)
  if (first !== null) return first
  if (!retry) return null
  let retryContent: string
  try {
    retryContent = await retry()
  } catch {
    return null
  }
  return tryParse(retryContent, schema)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/json-retry.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/llm/json-retry.ts apps/api/src/llm/json-retry.test.ts
git commit -m "feat(llm): add parseLLMJson retry helper for sub2api JSON outputs"
```

---

## Task 5: Apply `parseLLMJson` to `critic.ts`

**Files:**
- Modify: `apps/api/src/agents/critic.ts`
- Test: `apps/api/src/agents/critic.test.ts`

`critic.ts` currently sends `response_format: { type: 'json_object' }`, which sub2api silently drops (per `docs/sub2api.md`), and then does a single `JSON.parse` on `message.content` with a `FALLBACK` of zeros if parsing fails. Replace with `parseLLMJson` + retry, drop the dead `response_format` arg.

- [ ] **Step 1: Write the failing test**

Look at the existing `critic.test.ts` to find the mock pattern (it should mock `loggedCompletion`). If a retry test does not exist, append:

```typescript
  it('retries once when initial response is non-JSON', async () => {
    let call = 0
    ;(loggedCompletion as any).mockImplementation(async () => {
      call++
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: call === 1
              ? 'Sorry, I cannot output JSON right now.'
              : '{"qualityScore": 75, "blockers": [], "itemIssues": [], "globalIssues": []}',
          },
        }],
      }
    })

    const report = await criticReview(samplePlan, sampleBrief())
    expect(loggedCompletion).toHaveBeenCalledTimes(2)
    expect(report.qualityScore).toBe(75)
  })
```

(`samplePlan` and `sampleBrief` are defined at the top of the existing test file; if not, copy the minimal shapes from `react-loop.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/critic.test.ts
```

Expected: FAIL — `loggedCompletion` is called once, not twice.

- [ ] **Step 3: Use `parseLLMJson` in `criticReview`**

Replace the body of `criticReview` in `apps/api/src/agents/critic.ts` (lines 42-76) with:

```typescript
export async function criticReview(plan: Plan, brief: TripBrief, language = 'zh'): Promise<CriticReport> {
  const systemPrompt = SYSTEM_PROMPT_BASE.replace(
    'OUTPUT_LANGUAGE',
    language === 'zh' ? 'Chinese (Simplified)' : language,
  )

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `TripBrief:\n${JSON.stringify(brief)}\n\nPlan:\n${JSON.stringify(plan)}`,
    },
  ]

  let firstContent: string
  try {
    const resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
    })
    firstContent = resp.choices[0]?.message?.content ?? ''
  } catch (err) {
    console.warn('[Critic] LLM call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const retry = async (): Promise<string> => {
    const resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: [
        ...llmMessages,
        { role: 'assistant', content: firstContent },
        { role: 'user', content: 'Your last reply was not valid JSON. Output ONLY one JSON object matching the schema, no prose, no code fences.' },
      ],
      temperature: 0.2,
    })
    return resp.choices[0]?.message?.content ?? ''
  }

  const parsed = await parseLLMJson(firstContent, CriticReportSchema, retry)
  if (parsed) return parsed
  console.warn(`[Critic] Parse failed after retry (raw="${firstContent.slice(0, 200).replace(/\n/g, '\\n')}")`)
  return FALLBACK
}
```

Add the import at the top of the file (after the existing `loggedCompletion` import on line 2):

```typescript
import { parseLLMJson } from '../llm/json-retry.js'
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/critic.test.ts
```

Expected: all tests pass (existing + new retry test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/critic.ts apps/api/src/agents/critic.test.ts
git commit -m "fix(critic): use parseLLMJson with retry; drop ignored response_format arg"
```

---

## Task 6: Apply `parseLLMJson` to `generator.runRefine`

**Files:**
- Modify: `apps/api/src/agents/generator.ts:311-355`
- Test: `apps/api/src/agents/generator.test.ts`

`runRefine` currently does an extract-then-parse and falls back to returning the unrepaired `current` plan when JSON parsing fails — losing the refinement. Use `parseLLMJson` to retry once before falling back.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/agents/generator.test.ts`, append a test for the retry path. (Inspect the file first to mirror its mock setup for `loggedCompletion` / `runWithToolLoop`.)

```typescript
  it('runRefine retries once when first response has no JSON', async () => {
    let call = 0
    ;(loggedCompletion as any).mockImplementation(async () => {
      call++
      // First call: no JSON. Second call (retry): valid plan JSON.
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: call === 1
              ? 'I am unable to repair this plan.'
              : '```json\n' + JSON.stringify(samplePlan) + '\n```',
          },
        }],
      }
    })

    const result = await runRefine(samplePlan, sampleReport(), sampleBrief())
    expect(loggedCompletion).toHaveBeenCalledTimes(2)
    expect(result.title).toBe(samplePlan.title)
  })
```

(Use whatever `samplePlan` / `sampleBrief` / `sampleReport` factories already exist in the file; otherwise copy minimal shapes from `react-loop.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```

Expected: FAIL — `loggedCompletion` is called once.

- [ ] **Step 3: Add a `tryParsePlan` helper and one-shot retry in `runRefine`**

`runRefine` needs JSON.parse → `normalizePlanJson` → `PlanSchema.parse` (three steps), so the generic `parseLLMJson` doesn't fit cleanly here. Use a focused inline helper instead — same retry shape, plan-aware parsing.

Add this helper near the existing helpers in `apps/api/src/agents/generator.ts` (right after `extractJsonCodeBlock` at line 127):

```typescript
function tryParsePlan(content: string): Plan | null {
  const json = (extractJsonCodeBlock(content) ?? content).trim()
  if (!json || (json[0] !== '{' && json[0] !== '[')) return null
  try {
    return PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
  } catch {
    return null
  }
}
```

Then replace the JSON-extract block at the bottom of `runRefine` (lines 343-354) with:

```typescript
  let parsed = tryParsePlan(prepared.content)
  if (!parsed) {
    try {
      const resp = await loggedCompletion('generator', {
        model: PLANNER_MODEL,
        messages: [
          ...prepared.messages,
          { role: 'assistant', content: prepared.content },
          { role: 'user', content: 'Your last reply did not contain a valid JSON plan. Output ONLY one ```json``` code block with the complete repaired plan, no prose before or after.' },
        ],
        tools, tool_choice: 'none',
        temperature: 0.3,
      })
      const retryContent = resp.choices[0]?.message?.content ?? ''
      parsed = tryParsePlan(retryContent)
    } catch (err) {
      console.warn('[Generator.refine] Retry call failed:', err instanceof Error ? err.message : err)
    }
  }
  if (parsed) return parsed
  console.warn(`[Generator.refine] Parse failed after retry (raw len=${prepared.content?.length ?? 0}), returning original`)
  return current
}
```

Note: `runRefine` returns `Plan` (not `null`); on total failure it falls back to the unrepaired `current` plan — same as today, but only after one retry. No `parseLLMJson` import needed in this file.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/generator.ts apps/api/src/agents/generator.test.ts
git commit -m "fix(generator): retry refine once on malformed JSON before falling back"
```

---

## Task 7: Add per-chunk idle watchdog to `loggedStream`

**Files:**
- Modify: `apps/api/src/llm/logger.ts:179-260`
- Test: `apps/api/src/llm/logger.test.ts`

Sub2api routes through ChatGPT and SSE streams can stall mid-response. Today, a stalled stream blocks the orchestrator forever (no `done` ever fires, frontend hangs). Add a configurable per-chunk idle timeout — if no chunk arrives within `LLM_STREAM_IDLE_MS` (default 60_000), the stream is aborted with a clear error. Top-level `try/catch` in `sessions.ts` already surfaces it as an `error` event.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/llm/logger.test.ts`:

```typescript
  it('aborts loggedStream when no chunk arrives within the idle timeout', async () => {
    // Mock a stream that yields one chunk then hangs forever.
    const stallingStream = (async function*() {
      yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] }
      await new Promise(() => { /* never resolves */ })
    })()
    ;(llm.chat.completions.create as any).mockResolvedValue(stallingStream)

    process.env.LLM_STREAM_IDLE_MS = '50'
    try {
      const gen = loggedStream('test', {
        model: 'fake', messages: [{ role: 'user', content: 'x' }],
      } as any)
      const collected: any[] = []
      let error: unknown = null
      try {
        for await (const c of gen) collected.push(c)
      } catch (e) {
        error = e
      }
      expect(collected).toHaveLength(1)
      expect(error).toBeTruthy()
      expect(String(error)).toMatch(/idle/i)
    } finally {
      delete process.env.LLM_STREAM_IDLE_MS
    }
  }, 2000)
```

(If `logger.test.ts` doesn't already mock `llm.chat.completions.create`, follow the pattern from `react-loop.test.ts:5-8` to mock `../client.js` first.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts
```

Expected: test times out at 2000ms, OR collects only 1 chunk and never throws.

- [ ] **Step 3: Add the watchdog**

Add this helper near the top of `apps/api/src/llm/logger.ts` (after the `MAX_REQUEST_BYTES` constant on line 28):

```typescript
async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  idleMs: number,
): AsyncGenerator<T> {
  const iter = source[Symbol.asyncIterator]()
  while (true) {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM stream idle for ${idleMs}ms (no chunk received)`)), idleMs)
    })
    try {
      const result = await Promise.race([iter.next(), timeout])
      if (timer) clearTimeout(timer)
      if (result.done) return
      yield result.value
    } catch (err) {
      if (timer) clearTimeout(timer)
      // Best-effort cancel of the upstream iterator
      try { await iter.return?.(undefined) } catch { /* ignore */ }
      throw err
    }
  }
}
```

Inside `loggedStream`, after the `const start = Date.now()` line (line 184), add:

```typescript
  const idleMs = Number(process.env.LLM_STREAM_IDLE_MS ?? 60_000)
```

(Read per-call rather than module-level, so the test can mutate `process.env.LLM_STREAM_IDLE_MS` without dealing with vitest module caching.)

Then change the `for await (const chunk of stream)` loop on line 207 to:

```typescript
    for await (const chunk of withIdleTimeout(stream, idleMs)) {
```

The rest of the chunk-handling body stays the same.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/llm/logger.test.ts
```

Expected: all tests pass, including the new idle-timeout test (completes in ~50ms).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/llm/logger.ts apps/api/src/llm/logger.test.ts
git commit -m "feat(llm): per-chunk idle watchdog on loggedStream to surface stalled SSE"
```

---

## Task 8: Frontend — render `assistant_say` as a narration bubble

**Files:**
- Modify: `apps/web/stores/chat.ts:240-280` (event switch) and adjacent state setup
- Modify: `apps/web/components/ChatPanel.vue:32-55` (template) and styles
- Modify: `apps/web/types/itinerary.ts` *(or wherever `ChatMessage` / `Role` lives)*
- Test: manual browser smoke after `pnpm dev` (no Vue unit tests in this codebase per `tests/e2e/` unavailability)

Render `assistant_say` as a separate, pre-finalized assistant message with role `'narration'` so it visually distinguishes from the final answer.

- [ ] **Step 1: Locate the `Role` type**

```bash
rg -n "type Role" apps/web/types/ apps/web/stores/
```

Open the file that defines `Role` and add `'narration'` to the union.

For example, if it currently reads `export type Role = 'user' | 'assistant' | 'system'`, change to:

```typescript
export type Role = 'user' | 'assistant' | 'system' | 'narration'
```

- [ ] **Step 2: Handle the event in `chat.ts`**

In `apps/web/stores/chat.ts`, inside the `case 'tool_reasoning':` block at line 261, leave it as-is. Add a new case immediately after `case 'tool_reasoning':` (before `case 'plan_partial':` at line 264):

```typescript
        case 'assistant_say': {
          // A finalized "narration" message — orchestrator told the user something
          // before invoking a tool. Append as a separate bubble so the final answer
          // (delivered via 'token') stays visually distinct.
          this.messages.push({
            id: `narration-${crypto.randomUUID()}`,
            role: 'narration',
            content: event.content,
          })
          this.persistState()
          break
        }
```

- [ ] **Step 3: Render narration bubbles in `ChatPanel.vue`**

In `apps/web/components/ChatPanel.vue`, the existing template at lines 33-45 already renders any `message.role` via `bubble-${message.role}`. Just add a CSS rule for `.bubble-narration` in the `<style>` block. Insert after the `.bubble-system` block (around line 176):

```css
.bubble-narration {
  align-self: flex-start;
  background: var(--bg-subtle);
  color: var(--text-muted, #6b7280);
  border-color: var(--border-subtle-2, var(--border));
  border-radius: var(--r-md) var(--r-md) var(--r-md) 4px;
  font-style: italic;
  max-width: min(640px, 85%);
  opacity: 0.85;
}
```

- [ ] **Step 4: Manual smoke test**

```bash
pnpm dev
```

Open the printed `http://localhost:<port>` URL, log in, and submit a partial trip request such as `去上海玩` (intentionally missing dates / travelers / budget) so the orchestrator narrates before calling `call_clarifier`. Verify:
- A lighter italic bubble appears with the orchestrator's lead-in text.
- The clarification card still appears below it (existing behavior unchanged).
- Refresh the page — narration bubbles persist via `sessionStorage`.

If narration does not appear, check the browser console for `[chatStream] parse failed` warnings (would indicate the schema rejected the new event — confirm Task 1 was committed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/stores/chat.ts apps/web/components/ChatPanel.vue apps/web/types/itinerary.ts
git commit -m "feat(web): render assistant_say as a narration bubble"
```

---

## Task 9: Emit `done` after top-level error in SSE routes

**Files:**
- Modify: `apps/api/src/routes/sessions.ts:79-97` and `:118-134`
- Test: `apps/api/src/routes/sessions.test.ts`

When `runReactLoop` throws, `sessions.ts` emits `{type:'error',...}` but never `done`. The frontend `useChatStream.ts` `onClose` fires when the server closes the stream, but the chat store's `phase: 'planning'` only flips to `'idle'` on `done`/`error` handling — verify `'error'` already does this; if not, the cleanest universal fix is to always emit `done` after `error` so the loop-exit invariant ("every run ends with `done`") holds.

- [ ] **Step 1: Confirm the frontend invariant**

```bash
rg -n "case 'error'|case 'done'" apps/web/stores/chat.ts
```

If the `case 'error':` handler already resets `phase` to `'error'`, this task is a defense-in-depth backstop. If it doesn't, this fix is load-bearing.

- [ ] **Step 2: Write the failing test**

In `apps/api/src/routes/sessions.test.ts`, locate the existing SSE error test (search for `LOOP_ERROR`). If a `done`-after-error assertion does not exist, add one.

```typescript
  it('emits done after a loop error so the frontend exits loading state', async () => {
    // Force runReactLoop to throw mid-stream
    vi.mocked(runReactLoop).mockImplementationOnce(async function*() {
      throw new Error('boom')
    })
    const events = await collectSSE(/* existing helper that POSTs /messages and parses SSE */)
    const errIdx = events.findIndex(e => e.type === 'error')
    const doneIdx = events.findIndex(e => e.type === 'done')
    expect(errIdx).toBeGreaterThan(-1)
    expect(doneIdx).toBeGreaterThan(errIdx)
  })
```

(Adapt to the actual helper / mock pattern in the existing file — read it first.)

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/routes/sessions.test.ts
```

Expected: FAIL — `done` is not in the event list.

- [ ] **Step 4: Emit `done` in both catch blocks**

In `apps/api/src/routes/sessions.ts`, change the catch block at lines 86-89 from:

```typescript
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
    } finally {
```

to:

```typescript
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
      await send({ type: 'done', messageId: runId })
    } finally {
```

Apply the identical change to the second SSE block in the `/continue` handler (lines 128-131).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @travel-agent/api exec vitest run src/routes/sessions.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/sessions.ts apps/api/src/routes/sessions.test.ts
git commit -m "fix(sessions): emit done after error so frontend exits loading state"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm -r test
```

Expected: 0 failures. Note the totals; investigate any regression even if unrelated.

- [ ] **Step 2: Type-check both apps**

```bash
pnpm --filter @travel-agent/shared build
pnpm --filter @travel-agent/api build
pnpm --filter @travel-agent/web build
```

Expected: all three succeed (web build will be slower due to Nuxt).

- [ ] **Step 3: End-to-end smoke**

```bash
pnpm dev
```

Open the printed URL, log in, and run two scenarios:

**Scenario A — narration bubble shown**
Send `去上海玩` (intentionally missing dates / travelers / budget). Expect:
1. Streaming "thinking" indicators (existing behavior).
2. A lighter italic narration bubble appears with the orchestrator's lead-in text (e.g. "为了把高铁/酒店…").
3. The clarification card appears below it.

**Scenario B — full plan path still works**
Reply with concrete dates / travelers / budget. Expect:
1. Existing iteration progress + score events.
2. A final assistant message bubble (regular style, not italic) with the closing summary.
3. The plan renders in the right-hand panel.

If either scenario regresses, do NOT mark this task complete — open an issue with the console / network log and fix before proceeding.

- [ ] **Step 4: Final commit (if any docs/notes were updated)**

```bash
git status
# If only verification changes, no commit needed.
```

---

## Self-Review Notes (for the implementer)

- **sub2api `finish_reason` quirk**: This plan does NOT add `max_tokens`-truncation continuation, because per `docs/sub2api.md` `finish_reason` is always `"stop"` — making truncation undetectable without heuristics. The `parseLLMJson` retry indirectly handles the most common truncation symptom (incomplete JSON) by re-prompting.
- **Cancellation invariant**: Task 3 makes cancelled runs emit `done` (without `converged: true`). The frontend can treat unflagged `done` as either a final answer or a clean cancel — both correctly clear the loading state.
- **`tool_reasoning` is intentionally kept**: Task 3 keeps emitting per-chunk `tool_reasoning` for live preview during streaming. The frontend currently ignores it, but a future "thinking panel" can subscribe without breaking the new `assistant_say` path.
- **Why `parseLLMJson` lives under `apps/api/src/llm/`**: it's API-internal, sub2api-specific (`response_format` doesn't work), and not used by the web app. Don't promote it to `packages/shared` until a second app needs it.
