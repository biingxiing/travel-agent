# Pure ReAct Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded extractor→prefetch→generator→evaluator→refine pipeline with a true ReAct loop where an Orchestrator LLM calls each planning step as an isolated subagent tool.

**Architecture:** Orchestrator LLM streams reasoning and emits tool_use blocks; each block maps to a SubagentTool that receives only the isolated context the orchestrator explicitly passes; read-only tools execute concurrently, write tools execute serially. The loop terminates when the LLM produces a turn with no tool calls.

**Tech Stack:** Hono, OpenAI SDK, Zod, Vitest, Nuxt 3, Pinia

---

## File Map

### New files (backend)
```
apps/api/src/agents/tools/types.ts          — SubagentTool interface, LoopState, EmitFn
apps/api/src/agents/tools/extract-brief.tool.ts
apps/api/src/agents/tools/prefetch-context.tool.ts
apps/api/src/agents/tools/generate-plan.tool.ts
apps/api/src/agents/tools/evaluate-plan.tool.ts
apps/api/src/agents/tools/refine-plan.tool.ts
apps/api/src/agents/tools/ask-clarification.tool.ts
apps/api/src/agents/tools/index.ts          — buildOrchestratorMessages, toOpenAITools, ALL_TOOLS
apps/api/src/agents/tool-execution.ts       — partitionToolCalls, executeSubagents
apps/api/src/agents/tool-execution.test.ts
```

### Rewritten
```
apps/api/src/agents/react-loop.ts           — new while(true) orchestration loop
apps/api/src/agents/react-loop.test.ts      — updated tests for new LLM-driven loop
```

### Modified (backend)
```
apps/api/src/routes/sessions.ts             — pass emit fn to runReactLoop; collect token via emit
```

### Modified (shared + frontend)
```
packages/shared/src/events.ts              — add tool_reasoning event
apps/web/stores/chat.ts                    — handle tool_reasoning, add reasoningText state
```

### Preserved unchanged (wrapped by tools)
```
apps/api/src/agents/extractor.ts
apps/api/src/agents/prefetch.ts
apps/api/src/agents/generator.ts
apps/api/src/agents/evaluator.ts
apps/api/src/agents/critic.ts
apps/api/src/agents/clarifier.ts
```

---

## AGENT A TASKS — Backend (tasks 1–8)

### Task 1: SubagentTool types

**Files:**
- Create: `apps/api/src/agents/tools/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// apps/api/src/agents/tools/types.ts
import type OpenAI from 'openai'
import type { SessionState } from '../../session/store.js'
import type { ChatStreamEvent } from '@travel-agent/shared'

export type EmitFn = (event: ChatStreamEvent) => Promise<void>

export interface SubagentTool {
  name: string
  description: string
  /** Plain JSON Schema object for the OpenAI tool call */
  parametersSchema: Record<string, unknown>
  isConcurrencySafe(): boolean
  call(
    input: Record<string, unknown>,
    session: SessionState,
    emit: EmitFn,
  ): Promise<SubagentResult>
}

export type SubagentResult =
  | { type: 'ok'; output: string }
  | { type: 'halt'; reason: 'clarification_requested' }

export interface LoopState {
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  tools: SubagentTool[]
  turnCount: number
  runId: string
}

export interface ExecuteResult {
  toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }>
  shouldHalt: boolean
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/agents/tools/types.ts
git commit -m "feat(api): add SubagentTool types for ReAct migration"
```

---

### Task 2: Tool execution engine

**Files:**
- Create: `apps/api/src/agents/tool-execution.ts`
- Create: `apps/api/src/agents/tool-execution.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/agents/tool-execution.test.ts
import { describe, it, expect, vi } from 'vitest'
import { partitionToolCalls, executeSubagents } from './tool-execution.js'
import type { SubagentTool } from './tools/types.js'

const readTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => true,
  call: vi.fn().mockResolvedValue({ type: 'ok', output: `result:${name}` }),
})
const writeTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => false,
  call: vi.fn().mockResolvedValue({ type: 'ok', output: `result:${name}` }),
})
const haltTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => false,
  call: vi.fn().mockResolvedValue({ type: 'halt', reason: 'clarification_requested' }),
})

describe('partitionToolCalls', () => {
  it('groups consecutive read-only calls into a single concurrent batch', () => {
    const tools = [readTool('a'), readTool('b'), writeTool('c')]
    const blocks = [
      { id: '1', name: 'a', input: {} },
      { id: '2', name: 'b', input: {} },
      { id: '3', name: 'c', input: {} },
    ]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toEqual({ concurrent: true, blocks: [blocks[0], blocks[1]] })
    expect(batches[1]).toEqual({ concurrent: false, blocks: [blocks[2]] })
  })

  it('flushes concurrent batch before a write tool', () => {
    const tools = [readTool('a'), writeTool('b'), readTool('c')]
    const blocks = [
      { id: '1', name: 'a', input: {} },
      { id: '2', name: 'b', input: {} },
      { id: '3', name: 'c', input: {} },
    ]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(3)
    expect(batches[0].concurrent).toBe(true)
    expect(batches[1].concurrent).toBe(false)
    expect(batches[2].concurrent).toBe(true)
  })

  it('puts a solo write tool in its own batch', () => {
    const tools = [writeTool('w')]
    const blocks = [{ id: '1', name: 'w', input: {} }]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({ concurrent: false, blocks })
  })

  it('groups all read-only calls into one batch', () => {
    const tools = [readTool('a'), readTool('b')]
    const blocks = [{ id: '1', name: 'a', input: {} }, { id: '2', name: 'b', input: {} }]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(1)
    expect(batches[0].concurrent).toBe(true)
  })
})

describe('executeSubagents', () => {
  const fakeSession = {} as any
  const fakeEmit = vi.fn()

  it('returns tool results for each block', async () => {
    const tools = [readTool('a'), readTool('b')]
    const blocks = [{ id: '1', name: 'a', input: {} }, { id: '2', name: 'b', input: {} }]
    const { toolResults, shouldHalt } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(toolResults).toHaveLength(2)
    expect(toolResults[0]).toEqual({ role: 'tool', tool_call_id: '1', content: 'result:a' })
    expect(toolResults[1]).toEqual({ role: 'tool', tool_call_id: '2', content: 'result:b' })
    expect(shouldHalt).toBe(false)
  })

  it('sets shouldHalt when a halt tool is called', async () => {
    const tools = [haltTool('h')]
    const blocks = [{ id: '1', name: 'h', input: {} }]
    const { shouldHalt } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(shouldHalt).toBe(true)
  })

  it('returns error output for unknown tool name', async () => {
    const tools = [readTool('known')]
    const blocks = [{ id: '1', name: 'unknown', input: {} }]
    const { toolResults } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(toolResults[0].content).toContain('unknown tool')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @travel-agent/api exec vitest run src/agents/tool-execution.test.ts`
Expected: FAIL — `tool-execution.js` not found

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/agents/tool-execution.ts
import type { SubagentTool, EmitFn, ExecuteResult } from './tools/types.js'
import type { SessionState } from '../session/store.js'

export interface ToolCallBlock {
  id: string
  name: string
  input: Record<string, unknown>
}

interface Batch {
  concurrent: boolean
  blocks: ToolCallBlock[]
}

export function partitionToolCalls(blocks: ToolCallBlock[], tools: SubagentTool[]): Batch[] {
  const batches: Batch[] = []
  let concurrentBatch: ToolCallBlock[] = []

  for (const block of blocks) {
    const tool = tools.find(t => t.name === block.name)
    if (tool?.isConcurrencySafe()) {
      concurrentBatch.push(block)
    } else {
      if (concurrentBatch.length > 0) {
        batches.push({ concurrent: true, blocks: concurrentBatch })
        concurrentBatch = []
      }
      batches.push({ concurrent: false, blocks: [block] })
    }
  }
  if (concurrentBatch.length > 0) {
    batches.push({ concurrent: true, blocks: concurrentBatch })
  }
  return batches
}

async function runOne(
  block: ToolCallBlock,
  tools: SubagentTool[],
  session: SessionState,
  emit: EmitFn,
): Promise<{ id: string; output: string; shouldHalt: boolean }> {
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

export async function executeSubagents(
  blocks: ToolCallBlock[],
  tools: SubagentTool[],
  session: SessionState,
  emit: EmitFn,
): Promise<ExecuteResult> {
  const toolResults: ExecuteResult['toolResults'] = []
  let shouldHalt = false

  for (const batch of partitionToolCalls(blocks, tools)) {
    let results: Array<{ id: string; output: string; shouldHalt: boolean }>
    if (batch.concurrent) {
      results = await Promise.all(batch.blocks.map(b => runOne(b, tools, session, emit)))
    } else {
      results = []
      for (const block of batch.blocks) {
        results.push(await runOne(block, tools, session, emit))
      }
    }
    for (const r of results) {
      toolResults.push({ role: 'tool', tool_call_id: r.id, content: r.output })
      if (r.shouldHalt) shouldHalt = true
    }
  }

  return { toolResults, shouldHalt }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @travel-agent/api exec vitest run src/agents/tool-execution.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tool-execution.ts apps/api/src/agents/tool-execution.test.ts
git commit -m "feat(api): add tool execution engine with concurrent/serial partitioning"
```

---

### Task 3: SubagentTool wrappers — extract-brief, prefetch-context

**Files:**
- Create: `apps/api/src/agents/tools/extract-brief.tool.ts`
- Create: `apps/api/src/agents/tools/prefetch-context.tool.ts`

- [ ] **Step 1: Write extract-brief.tool.ts**

```typescript
// apps/api/src/agents/tools/extract-brief.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { extractBrief } from '../extractor.js'

export const extractBriefTool: SubagentTool = {
  name: 'call_extractor',
  description: 'Parse user messages into a structured TripBrief. Call this first to understand the trip request. Returns JSON with {brief, intent, changedFields}.',
  parametersSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: { type: 'string' },
        description: 'The raw user message strings to parse.',
      },
    },
    required: ['messages'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, _emit: EmitFn): Promise<SubagentResult> {
    const { messages } = input as { messages: string[] }
    // Isolated context: construct Message objects from the passed strings only
    const msgs = messages.map(content => ({
      role: 'user' as const,
      content,
      timestamp: Date.now(),
    }))
    const result = await extractBrief(msgs, session.brief ?? null)
    session.brief = result.brief
    return { type: 'ok', output: JSON.stringify(result) }
  },
}
```

- [ ] **Step 2: Write prefetch-context.tool.ts**

```typescript
// apps/api/src/agents/tools/prefetch-context.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { prefetchFlyaiContext } from '../prefetch.js'
import type { TripBrief } from '@travel-agent/shared'

export const prefetchContextTool: SubagentTool = {
  name: 'call_prefetch',
  description: 'Fetch real-world flight, hotel, and POI data for the given TripBrief. Returns a summary of how many context entries were fetched. Pass session.prefetchContext when calling call_generator.',
  parametersSchema: {
    type: 'object',
    properties: {
      brief: {
        type: 'object',
        description: 'The TripBrief JSON object returned by call_extractor.',
      },
    },
    required: ['brief'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    await emit({ type: 'agent_step', agent: 'prefetch', status: 'thinking' })
    const { brief } = input as { brief: TripBrief }
    const context = await prefetchFlyaiContext(brief, session.id)
    session.prefetchContext = context
    await emit({
      type: 'agent_step',
      agent: 'prefetch',
      status: 'done',
      output: `${context.length} context entries fetched`,
    })
    return {
      type: 'ok',
      output: `Prefetched ${context.length} context entries. Use session.prefetchContext when calling call_generator.`,
    }
  },
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/tools/extract-brief.tool.ts apps/api/src/agents/tools/prefetch-context.tool.ts
git commit -m "feat(api): add extract-brief and prefetch-context subagent tools"
```

---

### Task 4: SubagentTool wrappers — generate-plan, evaluate-plan

**Files:**
- Create: `apps/api/src/agents/tools/generate-plan.tool.ts`
- Create: `apps/api/src/agents/tools/evaluate-plan.tool.ts`

- [ ] **Step 1: Write generate-plan.tool.ts**

```typescript
// apps/api/src/agents/tools/generate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { runInitial } from '../generator.js'
import type { TripBrief, ChatStreamEvent } from '@travel-agent/shared'

export const generatePlanTool: SubagentTool = {
  name: 'call_generator',
  description: 'Generate an initial travel itinerary. Requires brief and prefetchContext. Streams plan tokens to the client as it runs. Returns the complete plan JSON.',
  parametersSchema: {
    type: 'object',
    properties: {
      brief: { type: 'object', description: 'TripBrief from call_extractor.' },
      prefetchContext: {
        type: 'array',
        items: { type: 'string' },
        description: 'Context strings from call_prefetch. Pass [] if prefetch was skipped.',
      },
      language: { type: 'string', description: 'Output language: "zh" or "en".' },
    },
    required: ['brief', 'prefetchContext', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { brief, prefetchContext, language } = input as {
      brief: TripBrief
      prefetchContext: string[]
      language: string
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'thinking' })

    let plan = null
    const gen = runInitial(brief, prefetchContext, language)
    while (true) {
      const r = await gen.next()
      // Forward streaming events (token, plan, plan_partial, agent_step) to client
      if (r.value !== undefined && r.value !== null && typeof r.value === 'object' && 'type' in r.value) {
        await emit(r.value as ChatStreamEvent)
      }
      if (r.done) { plan = r.value; break }
    }

    if (!plan) return { type: 'ok', output: 'Generator produced no plan.' }
    session.currentPlan = plan
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(plan) }
  },
}
```

- [ ] **Step 2: Write evaluate-plan.tool.ts**

```typescript
// apps/api/src/agents/tools/evaluate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { evaluate } from '../evaluator.js'
import type { Plan, TripBrief } from '@travel-agent/shared'

export const evaluatePlanTool: SubagentTool = {
  name: 'call_evaluator',
  description: 'Score the current travel plan. Returns an EvaluationReport with {combined: {overall, transport, lodging, attraction}, blockers, itemIssues, converged}. Call after call_generator or call_refiner.',
  parametersSchema: {
    type: 'object',
    properties: {
      plan: { type: 'object', description: 'The Plan JSON to evaluate.' },
      brief: { type: 'object', description: 'The TripBrief for scoring context.' },
      language: { type: 'string', description: 'Language for the LLM critic.' },
    },
    required: ['plan', 'brief', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { plan, brief, language } = input as { plan: Plan; brief: TripBrief; language: string }
    await emit({ type: 'agent_step', agent: 'evaluator', status: 'evaluating' })
    const report = await evaluate(plan, brief, language)

    session.currentScore = {
      overall: report.combined.overall,
      transport: report.combined.transport,
      lodging: report.combined.lodging,
      attraction: report.combined.attraction,
      iteration: session.iterationCount,
    }

    await emit({
      type: 'score',
      overall: report.combined.overall,
      transport: report.combined.transport,
      lodging: report.combined.lodging,
      attraction: report.combined.attraction,
      iteration: session.iterationCount,
      converged: report.converged,
    })
    await emit({
      type: 'agent_step',
      agent: 'evaluator',
      status: 'done',
      output: `Score: ${report.combined.overall}, converged: ${report.converged}`,
    })
    return { type: 'ok', output: JSON.stringify(report) }
  },
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/tools/generate-plan.tool.ts apps/api/src/agents/tools/evaluate-plan.tool.ts
git commit -m "feat(api): add generate-plan and evaluate-plan subagent tools"
```

---

### Task 5: SubagentTool wrappers — refine-plan, ask-clarification

**Files:**
- Create: `apps/api/src/agents/tools/refine-plan.tool.ts`
- Create: `apps/api/src/agents/tools/ask-clarification.tool.ts`

- [ ] **Step 1: Write refine-plan.tool.ts**

```typescript
// apps/api/src/agents/tools/refine-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { runRefine } from '../generator.js'
import type { Plan, TripBrief, EvaluationReport } from '@travel-agent/shared'

export const refinePlanTool: SubagentTool = {
  name: 'call_refiner',
  description: 'Fix issues in the current plan identified by call_evaluator. Takes the plan, brief, evaluation report, and prefetch context. Returns the refined plan JSON.',
  parametersSchema: {
    type: 'object',
    properties: {
      plan: { type: 'object', description: 'The Plan JSON to refine.' },
      brief: { type: 'object', description: 'The TripBrief for context.' },
      report: { type: 'object', description: 'The EvaluationReport from call_evaluator.' },
      prefetchContext: {
        type: 'array',
        items: { type: 'string' },
        description: 'Prefetch context strings. Pass session.prefetchContext or [].',
      },
      language: { type: 'string', description: 'Output language.' },
    },
    required: ['plan', 'brief', 'report', 'prefetchContext', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { plan, brief, report, prefetchContext, language } = input as {
      plan: Plan
      brief: TripBrief
      report: EvaluationReport
      prefetchContext: string[]
      language: string
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'refining' })
    const refined = await runRefine(plan, report, brief, prefetchContext, language)
    session.currentPlan = refined
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'plan', plan: refined })
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(refined) }
  },
}
```

- [ ] **Step 2: Write ask-clarification.tool.ts**

```typescript
// apps/api/src/agents/tools/ask-clarification.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '../../session/store.js'
import { generateClarification } from '../clarifier.js'
import type { TripBrief } from '@travel-agent/shared'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

export const askClarificationTool: SubagentTool = {
  name: 'call_clarifier',
  description: 'Ask the user for missing trip information. Emits a clarify_needed event and HALTS the planning loop. Only call when destination, days, or dates are missing and cannot be inferred.',
  parametersSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['missing_destination', 'missing_days', 'missing_dates'],
        description: 'What critical information is missing.',
      },
      brief: {
        type: 'object',
        description: 'Current TripBrief (partial is fine).',
      },
      language: { type: 'string', description: 'User language for the question.' },
    },
    required: ['reason', 'brief', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { reason, brief, language } = input as {
      reason: ClarifyReason
      brief: Partial<TripBrief>
      language: string
    }
    // Pass session messages for context-aware question generation
    const msgs = session.messages.map(m => ({ ...m }))
    const { question, defaultSuggestion } = await generateClarification(msgs, brief, reason, language)
    session.status = 'awaiting_user'
    session.pendingClarification = question
    await emit({
      type: 'clarify_needed',
      question,
      reason,
      ...(defaultSuggestion !== null ? { defaultSuggestion } : {}),
    })
    return { type: 'halt', reason: 'clarification_requested' }
  },
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/tools/refine-plan.tool.ts apps/api/src/agents/tools/ask-clarification.tool.ts
git commit -m "feat(api): add refine-plan and ask-clarification subagent tools"
```

---

### Task 6: Tools index + orchestrator system prompt

**Files:**
- Create: `apps/api/src/agents/tools/index.ts`

- [ ] **Step 1: Write the file**

```typescript
// apps/api/src/agents/tools/index.ts
import type OpenAI from 'openai'
import type { SubagentTool } from './types.js'
import type { SessionState } from '../../session/store.js'
import { extractBriefTool } from './extract-brief.tool.js'
import { prefetchContextTool } from './prefetch-context.tool.js'
import { generatePlanTool } from './generate-plan.tool.js'
import { evaluatePlanTool } from './evaluate-plan.tool.js'
import { refinePlanTool } from './refine-plan.tool.js'
import { askClarificationTool } from './ask-clarification.tool.js'

export { type SubagentTool } from './types.js'
export { type EmitFn } from './types.js'
export { type LoopState } from './types.js'

export const ALL_TOOLS: SubagentTool[] = [
  extractBriefTool,
  prefetchContextTool,
  generatePlanTool,
  evaluatePlanTool,
  refinePlanTool,
  askClarificationTool,
]

export function toOpenAITools(tools: SubagentTool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema,
    },
  }))
}

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are a travel planning orchestrator. Your goal is to create a high-quality travel itinerary using specialized subagent tools.

Workflow:
1. Call call_extractor with the user's raw messages to get a TripBrief.
2. If critical info is missing (destination or days), call call_clarifier to ask — this halts the loop.
3. Call call_prefetch with the TripBrief to get real-world flight/hotel/POI data.
4. Call call_generator with the brief, prefetch context, and language to create the initial itinerary.
5. Call call_evaluator to score the plan. Check the returned EvaluationReport:
   - If converged is true: stop calling tools and output a brief confirmation in the user's language.
   - If blockers exist: call call_clarifier.
   - If score < 90: call call_refiner with the plan, brief, report, and prefetch context.
6. After call_refiner: call call_evaluator again.
7. If still not converged after one refine: stop calling tools (the client will surface the plan).

When you stop calling tools, write a short confirmation message in the user's preferred language.
Never skip call_extractor on the first turn.
`

export function buildOrchestratorMessages(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const userMessagesText = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n---\n')

  const stateContext = JSON.stringify({
    hasBrief: !!session.brief,
    brief: session.brief,
    hasCurrentPlan: !!session.currentPlan,
    currentScore: session.currentScore,
    language: session.language ?? 'zh',
    iterationCount: session.iterationCount,
    status: session.status,
    prefetchContextSize: session.prefetchContext?.length ?? 0,
  })

  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Session state:\n${stateContext}\n\nUser messages:\n${userMessagesText}`,
    },
  ]
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/agents/tools/index.ts
git commit -m "feat(api): add tools index, toOpenAITools, and orchestrator system prompt"
```

---

### Task 7: Rewrite react-loop.ts

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts` (full rewrite)

- [ ] **Step 1: Read the current file**

Read `apps/api/src/agents/react-loop.ts` to confirm its current content before overwriting.

- [ ] **Step 2: Write the new react-loop.ts**

```typescript
// apps/api/src/agents/react-loop.ts
import { randomUUID } from 'crypto'
import type OpenAI from 'openai'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedStream } from '../llm/logger.js'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { ALL_TOOLS, toOpenAITools, buildOrchestratorMessages } from './tools/index.js'
import type { EmitFn, LoopState } from './tools/types.js'
import { executeSubagents } from './tool-execution.js'
import type { ToolCallBlock } from './tool-execution.js'

const MAX_TURNS = 10

async function streamOrchestrator(
  state: LoopState,
  emit: EmitFn,
): Promise<{
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  toolCalls: ToolCallBlock[]
}> {
  let fullContent = ''
  const rawToolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  const openAITools = toOpenAITools(state.tools)

  for await (const chunk of loggedStream('orchestrator', {
    model: PLANNER_MODEL,
    messages: state.messages,
    tools: openAITools,
    tool_choice: 'auto',
    temperature: 0.3,
  })) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) {
      fullContent += delta.content
      await emit({ type: 'tool_reasoning', delta: delta.content })
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
    try { input = JSON.parse(tc.arguments || '{}') } catch { /* malformed JSON */ }
    return { id: tc.id, name: tc.name, input }
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

  return { assistantMessage, toolCalls }
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
    if (isCancelled(session, runId)) return

    const { assistantMessage, toolCalls } = await streamOrchestrator(state, emit)

    // No tool calls → orchestrator decided it's done
    if (toolCalls.length === 0) {
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    if (isCancelled(session, runId)) return

    const { toolResults, shouldHalt } = await executeSubagents(
      toolCalls, state.tools, session, emit,
    )

    if (shouldHalt) return

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
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors (will fail on sessions.ts until Task 8 is done — that's OK, fix after)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/react-loop.ts
git commit -m "feat(api): rewrite react-loop.ts as LLM-orchestrated ReAct loop"
```

---

### Task 8: Update sessions.ts + react-loop.test.ts

**Files:**
- Modify: `apps/api/src/routes/sessions.ts` (two call sites)
- Modify: `apps/api/src/agents/react-loop.test.ts`

- [ ] **Step 1: Read sessions.ts**

Read `apps/api/src/routes/sessions.ts` to find the two `runReactLoop` call sites.

- [ ] **Step 2: Update the POST /:id/messages handler**

Find this block (around line 74–87):
```typescript
let assistantContent = ''
// ...
for await (const ev of runReactLoop(fresh, runId)) {
  await send(ev)
  if (ev.type === 'token') assistantContent += ev.delta
}
```

Replace with:
```typescript
let assistantContent = ''
const sendAndCollect = async (e: ChatStreamEvent) => {
  if (e.type === 'token') assistantContent += e.delta
  await send(e)
}
// ...
for await (const ev of runReactLoop(fresh, runId, sendAndCollect)) {
  await send(ev)
}
```

Also add the import for `ChatStreamEvent` if not already imported:
Check the top of sessions.ts — `ChatStreamEvent` is likely already imported from `@travel-agent/shared`. If not, add it.

- [ ] **Step 3: Update the POST /:id/continue handler**

Find this block (around line 120–126):
```typescript
for await (const ev of runReactLoop(fresh, runId)) await send(ev)
```

Replace with:
```typescript
const sendDirect = async (e: ChatStreamEvent) => { await send(e) }
for await (const ev of runReactLoop(fresh, runId, sendDirect)) await send(ev)
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

Run: `pnpm --filter @travel-agent/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Rewrite react-loop.test.ts**

The new loop is driven by `loggedStream` mock rather than individual agent mocks. Replace the entire file:

```typescript
// apps/api/src/agents/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock loggedStream — controls orchestrator behavior
vi.mock('../llm/logger.js', () => ({
  loggedStream: vi.fn(),
  withSessionContext: (_sid: unknown, _rid: unknown, fn: () => unknown) => fn(),
}))

// Mock all subagent tool implementations (not the tools themselves — just their underlying fns)
vi.mock('./extractor.js', () => ({ extractBrief: vi.fn() }))
vi.mock('./evaluator.js', () => ({ evaluate: vi.fn() }))
vi.mock('./generator.js', () => ({
  runInitial: vi.fn(),
  runRefine: vi.fn(),
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
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
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

function emptyReport(converged = false, blockers: any[] = []) {
  return {
    ruleScore: {
      overall: 80, grade: 'good',
      transport: { score: 80, count: 1, items: [], grade: 'good' },
      lodging: { score: 80, count: 1, items: [], grade: 'good' },
      attraction: { score: 80, count: 2, items: [], grade: 'good' },
      meal: { score: null, count: 0, items: [], grade: 'none' },
      coverage: { score: 80, daysWithTransport: 1, daysWithLodging: 1, daysWithAttractions: 1, totalDays: 1 },
      suggestions: [],
    },
    llmScore: 80,
    combined: { overall: 80, transport: 80, lodging: 80, attraction: 80 },
    blockers, itemIssues: [], globalIssues: [],
    converged,
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
    currentPlan: null, currentScore: null, status: 'draft',
    iterationCount: 0, lastRunId: 'r1', pendingClarification: null,
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
    // Loop halts — no done event
    expect(yieldedEvents.some(e => e.type === 'done')).toBe(false)
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
    expect(events.some(e => e.type === 'done')).toBe(false)
  })

  it('emits max_iter_reached when MAX_TURNS exceeded', async () => {
    // Always return the same tool call to exhaust MAX_TURNS
    ;(loggedStream as any).mockImplementation(() => makeChunks([{
      id: 'tc1', name: 'call_extractor', args: '{"messages":[]}',
    }]))
    ;(extractBrief as any).mockResolvedValue({
      brief: sampleBrief(), intent: 'new', changedFields: [],
    })

    const session = baseSession()
    session.currentPlan = samplePlan
    session.currentScore = { overall: 70, transport: 70, lodging: 70, attraction: 70, iteration: 1 }

    const events = await collect(runReactLoop(session, 'r1', noopEmit))
    expect(events.some(e => e.type === 'max_iter_reached')).toBe(true)
    expect(session.status).toBe('awaiting_user')
  })
})
```

- [ ] **Step 6: Run all API tests**

Run: `pnpm --filter @travel-agent/api exec vitest run`
Expected: all tests pass (including new react-loop + tool-execution tests)

- [ ] **Step 7: Run full test suite**

Run: `pnpm -r test`
Expected: all packages pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/sessions.ts apps/api/src/agents/react-loop.test.ts
git commit -m "feat(api): update sessions.ts emit wiring and update react-loop tests for ReAct"
```

---

## AGENT B TASKS — Frontend (tasks 9–10)

### Task 9: Add tool_reasoning event to shared events

**Files:**
- Modify: `packages/shared/src/events.ts`

- [ ] **Step 1: Read the current events.ts**

Read `packages/shared/src/events.ts` to find the `ChatStreamEventSchema` discriminated union.

- [ ] **Step 2: Add the tool_reasoning variant**

In the `ChatStreamEventSchema` discriminated union, add after the `token` variant:
```typescript
z.object({ type: z.literal('tool_reasoning'), delta: z.string() }),
```

The resulting `ChatStreamEventSchema` should include (new line marked with `// NEW`):
```typescript
export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal('agent_step'), /* ... */ }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({ type: z.literal('tool_reasoning'), delta: z.string() }),  // NEW
  z.object({ type: z.literal('plan_partial'), plan: rawPlanShape.deepPartial() }),
  // ... rest unchanged
])
```

- [ ] **Step 3: Verify TypeScript across all packages**

Run: `pnpm -r build` (or `pnpm --filter @travel-agent/shared exec tsc --noEmit`)
Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/events.ts
git commit -m "feat(shared): add tool_reasoning event type for orchestrator streaming"
```

---

### Task 10: Handle tool_reasoning in the frontend

**Files:**
- Modify: `apps/web/stores/chat.ts`

- [ ] **Step 1: Read chat.ts**

Read `apps/web/stores/chat.ts` — specifically the `handleStreamEvent` switch statement (around line 232).

- [ ] **Step 2: Add state field**

In the store's state definition, find where `pendingAssistantText` or similar fields are defined. Add:
```typescript
reasoningText: '' as string,
```

- [ ] **Step 3: Add resetTransientState reset**

Find where `pendingAssistantText` is reset (likely in a `resetTransientState` or session-start action). Add the same reset for `reasoningText`:
```typescript
this.reasoningText = ''
```

- [ ] **Step 4: Add case in handleStreamEvent**

In the `switch (event.type)` block, add after the `'token'` case:
```typescript
case 'tool_reasoning':
  this.reasoningText += event.delta
  break
```

- [ ] **Step 5: Run web tests**

Run: `pnpm --filter @travel-agent/web exec vitest run` (if web tests exist)
Expected: passes (or "no test files found" — either is OK)

- [ ] **Step 6: Run full type check**

Run: `pnpm -r build`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/stores/chat.ts
git commit -m "feat(web): handle tool_reasoning event in chat store"
```

---

## Verification

After both agents complete:

1. **All tests pass:**
   ```bash
   pnpm -r test
   ```
   Expected: green across all packages

2. **Start full stack:**
   ```bash
   pnpm dev
   ```
   Expected: API and web start without errors

3. **Happy path test** (browser):
   - Send "帮我规划北京3天" → verify `agent_step` cards appear for each subagent, `plan` event fires, `done` event fires
   - Check browser console: `tool_reasoning` events log without errors

4. **Clarification path** (browser):
   - Send "我想旅行" → verify `clarify_needed` event fires, clarification UI appears, `session.status = 'awaiting_user'`

5. **Cancellation test**:
   - Send a message, immediately send another → first run exits cleanly (no duplicate events)
