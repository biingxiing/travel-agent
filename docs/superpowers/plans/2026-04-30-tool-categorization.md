# Tool Categorization & Evaluator Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `tools/` into `agent/` and `mcp/` subdirectories and delete the evaluator/refiner pipeline plus all downstream dead code.

**Architecture:** Move 3 LLM-calling tools into `tools/agent/`, move the 1 external-service tool into `tools/mcp/`, update `ALL_TOOLS` imports, delete the evaluator and refiner tools + their backing agents, remove related shared types and events, clean up frontend score UI.

**Tech Stack:** TypeScript, Hono, Nuxt 3, Pinia, `@travel-agent/shared` Zod schemas, Vitest

---

## File Map

### Created
- `apps/api/src/agents/tools/agent/` (directory)
- `apps/api/src/agents/tools/mcp/` (directory)

### Moved
- `tools/extract-brief.tool.ts` → `tools/agent/extract-brief.tool.ts`
- `tools/generate-plan.tool.ts` → `tools/agent/generate-plan.tool.ts`
- `tools/ask-clarification.tool.ts` → `tools/agent/ask-clarification.tool.ts`
- `tools/ask-clarification.tool.test.ts` → `tools/agent/ask-clarification.tool.test.ts`
- `tools/prefetch-context.tool.ts` → `tools/mcp/prefetch-context.tool.ts`
- `tools/prefetch-context.tool.test.ts` → `tools/mcp/prefetch-context.tool.test.ts`

### Deleted
- `apps/api/src/agents/tools/evaluate-plan.tool.ts`
- `apps/api/src/agents/tools/refine-plan.tool.ts`
- `apps/api/src/agents/evaluator.ts`
- `apps/api/src/agents/evaluator.test.ts`
- `apps/api/src/agents/critic.ts`
- `apps/api/src/agents/critic.test.ts`
- `apps/web/components/react/MaxIterCard.vue`
- `apps/web/components/react/ReactProgressBar.vue`
- `apps/web/components/ItineraryScore.vue`
- `apps/web/utils/scoring.ts`
- `packages/shared/src/evaluation.ts`
- `packages/shared/src/scoring.ts`

### Modified
- `apps/api/src/agents/tools/index.ts` — update imports + ALL_TOOLS + ORCHESTRATOR_SYSTEM_PROMPT
- `apps/api/src/agents/tools/index.test.ts` — remove evaluator/refiner from tool list assertions
- `apps/api/src/agents/generator.ts` — remove `runRefine` + `SYSTEM_PROMPT_REFINE`
- `apps/api/src/agents/generator.test.ts` — remove runRefine tests
- `apps/api/src/agents/react-loop.ts` — remove evaluation/score logic + max_iter_reached
- `apps/api/src/agents/tools/generate-plan.tool.ts` — remove `session.iterationCount` increment
- `apps/api/src/persistence/pg.ts` — remove iterationCount from read/write
- `apps/api/src/session/store.ts` — remove iterationCount initializer
- `apps/api/src/routes/sessions.ts` — remove iterationCount reset
- `packages/shared/src/session.ts` — remove currentScore/currentEvaluation/iterationCount/ItineraryScoreSummarySchema/'refining' status
- `packages/shared/src/events.ts` — remove score/iteration_progress/max_iter_reached events
- `packages/shared/src/index.ts` — remove evaluation/scoring exports
- `apps/web/stores/chat.ts` — remove displayScore/targetScore/maxIterReached/loopStatus + handlers
- `apps/web/stores/workspace.ts` — remove currentScore
- `apps/web/components/states/StreamingBubble.vue` — remove loopStatus/iteration props
- `apps/web/components/PlanningPreview.vue` — remove ItineraryScore usage
- `apps/web/composables/useTripHistory.ts` — remove 'refining' from IN_PROGRESS_STATUSES
- `apps/web/composables/useTripHistory.test.ts` — update test fixtures
- `apps/web/pages/index.vue` — remove MaxIterCard/ReactProgressBar/score bindings

---

## Task 1: Reorganize tools directory

**Files:**
- Create: `apps/api/src/agents/tools/agent/` (directory)
- Create: `apps/api/src/agents/tools/mcp/` (directory)
- Move: `tools/{extract-brief,generate-plan,ask-clarification}.tool.ts` → `tools/agent/`
- Move: `tools/ask-clarification.tool.test.ts` → `tools/agent/`
- Move: `tools/prefetch-context.tool.ts` → `tools/mcp/`
- Move: `tools/prefetch-context.tool.test.ts` → `tools/mcp/`
- Modify: `apps/api/src/agents/tools/index.ts`

- [ ] **Step 1: Create subdirectories and move files**

```bash
cd apps/api/src/agents/tools
mkdir agent mcp
mv extract-brief.tool.ts generate-plan.tool.ts ask-clarification.tool.ts ask-clarification.tool.test.ts agent/
mv prefetch-context.tool.ts prefetch-context.tool.test.ts mcp/
```

- [ ] **Step 2: Update imports in `tools/index.ts`**

Replace the four import lines at the top of `apps/api/src/agents/tools/index.ts`:

```typescript
import { extractBriefTool } from './agent/extract-brief.tool.js'
import { prefetchContextTool } from './mcp/prefetch-context.tool.js'
import { generatePlanTool } from './agent/generate-plan.tool.js'
import { evaluatePlanTool } from './evaluate-plan.tool.js'
import { refinePlanTool } from './refine-plan.tool.js'
import { askClarificationTool } from './agent/ask-clarification.tool.js'
```

(evaluatePlanTool and refinePlanTool will be removed in Task 2 — leave them for now)

- [ ] **Step 3: Run tests to verify nothing broke**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/
```

Expected: all existing tests pass (same count as before).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/tools/
git commit -m "refactor(tools): reorganize into agent/ and mcp/ subdirectories"
```

---

## Task 2: Remove evaluate and refine tools

**Files:**
- Delete: `apps/api/src/agents/tools/evaluate-plan.tool.ts`
- Delete: `apps/api/src/agents/tools/refine-plan.tool.ts`
- Modify: `apps/api/src/agents/tools/index.ts`

- [ ] **Step 1: Delete the two tool files**

```bash
rm apps/api/src/agents/tools/evaluate-plan.tool.ts
rm apps/api/src/agents/tools/refine-plan.tool.ts
```

- [ ] **Step 2: Update `ALL_TOOLS` in `apps/api/src/agents/tools/index.ts`**

Remove the evaluatePlanTool and refinePlanTool import lines and remove them from ALL_TOOLS:

```typescript
import { extractBriefTool } from './agent/extract-brief.tool.js'
import { prefetchContextTool } from './mcp/prefetch-context.tool.js'
import { generatePlanTool } from './agent/generate-plan.tool.js'
import { askClarificationTool } from './agent/ask-clarification.tool.js'

// ...

export const ALL_TOOLS: SubagentTool[] = [
  extractBriefTool,
  prefetchContextTool,
  generatePlanTool,
  askClarificationTool,
]
```

- [ ] **Step 3: Replace `ORCHESTRATOR_SYSTEM_PROMPT` in `apps/api/src/agents/tools/index.ts`**

Replace the entire `ORCHESTRATOR_SYSTEM_PROMPT` constant with:

```typescript
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are an expert travel-planning orchestrator building personalized itineraries.

A great travel plan goes beyond logistics. It reflects who the traveler is: how many people are going, whether they prefer trains or flights, whether they want a packed itinerary or a leisurely pace, their interests (history, food, nature, nightlife, shopping), budget sensitivity, and any special needs. The more you understand about the traveler, the better the plan.

**Clarification rule (strict):** Only call \`call_clarifier\` when at least one of these three is genuinely missing or ambiguous: destination, travel dates, or traveler count. If all three are known — even approximately — proceed immediately to \`call_prefetch\` then \`call_generator\`. Do NOT call \`call_clarifier\` because budget, pace, accommodation style, or personal preferences are unspecified; the generator handles those with sensible defaults. Halting for optional details wastes the traveler's time and is always the wrong choice when a workable plan can be produced.

Ground every itinerary in real-world data. Use the available tools to look up actual transportation options, weather patterns, attraction hours and ticketing, and accommodation conditions for the destination and travel dates. If live data is unavailable after querying, you may reason from recent historical data (prior years), but you must explicitly state that the information is inferred, explain why live data could not be retrieved, and cite the historical source. Never invent facts about schedules, prices, operating status, or travel times. Never plan an itinerary that violates physical reality — for example, routing that requires covering impossible distances within the available time.

**After call_generator returns:** Emit only a single short sentence in Chinese (30 characters or fewer) to confirm completion. Example: '行程规划已完成，祝您旅途愉快！' Do NOT reproduce the itinerary. Do NOT use markdown headers, bullet points, or bold text.
`
```

- [ ] **Step 4: Update `buildStateContextMessage` in `index.ts`** — remove `iterationCount` from the JSON snapshot (it will be removed from session schema in Task 8, but we stop serialising it now)

In `buildStateContextMessage`, change the JSON.stringify call to remove `iterationCount`:

```typescript
return {
  role: 'user',
  content: `Session state:\n${JSON.stringify({
    hasBrief: !!session.brief,
    brief: session.brief,
    hasCurrentPlan: !!session.currentPlan,
    language: session.language ?? 'zh',
    status: session.status,
    loopPhase,
    prefetchContextSize: session.prefetchContext?.length ?? 0,
  })}`,
}
```

Also remove the `currentScore` branch from `loopPhase` derivation — the new version is:

```typescript
let loopPhase: string
if (session.currentPlan) {
  loopPhase = 'planned'
} else if (session.brief) {
  loopPhase = 'briefed'
} else {
  loopPhase = 'draft'
}
```

- [ ] **Step 5: Update `index.test.ts` — remove evaluator/refiner from tool count assertion**

In `apps/api/src/agents/tools/index.test.ts`, find any assertion checking the length of `ALL_TOOLS` and update it from 6 to 4. Find any test referencing `call_evaluator` or `call_refiner` tool names and delete those test cases.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/tools/
git commit -m "feat(tools): remove evaluate and refine tools from pipeline"
```

---

## Task 3: Delete evaluator and critic agents

**Files:**
- Delete: `apps/api/src/agents/evaluator.ts`
- Delete: `apps/api/src/agents/evaluator.test.ts`
- Delete: `apps/api/src/agents/critic.ts`
- Delete: `apps/api/src/agents/critic.test.ts`

- [ ] **Step 1: Delete all four files**

```bash
rm apps/api/src/agents/evaluator.ts apps/api/src/agents/evaluator.test.ts
rm apps/api/src/agents/critic.ts apps/api/src/agents/critic.test.ts
```

- [ ] **Step 2: Run tests to verify no remaining references**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/
```

Expected: all tests pass (evaluator and critic test files are gone so no failures from them).

- [ ] **Step 3: Commit**

```bash
git add -u apps/api/src/agents/
git commit -m "feat(agents): delete evaluator and critic agents"
```

---

## Task 4: Remove `runRefine` from `generator.ts`

**Files:**
- Modify: `apps/api/src/agents/generator.ts`
- Modify: `apps/api/src/agents/generator.test.ts`

- [ ] **Step 1: Delete `runRefine` and `SYSTEM_PROMPT_REFINE` from `generator.ts`**

Remove from `apps/api/src/agents/generator.ts`:
- The `SYSTEM_PROMPT_REFINE` constant (starts at around line 78, ends around line 120)
- The exported `runRefine` function (starts around line 365, ends at the end of the file)
- Any imports used only by `runRefine` — check if `EvaluationReport` is imported and remove it

- [ ] **Step 2: Delete `runRefine` tests from `generator.test.ts`**

Remove from `apps/api/src/agents/generator.test.ts` all test blocks that call `runRefine`. Keep the `runInitial` tests.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```

Expected: all remaining tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/generator.ts apps/api/src/agents/generator.test.ts
git commit -m "feat(generator): remove runRefine and SYSTEM_PROMPT_REFINE"
```

---

## Task 5: Simplify `react-loop.ts`

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts`

- [ ] **Step 1: Replace the no-tool-calls convergence block**

Find the block starting with `if (toolCalls.length === 0) {` and replace the entire body with:

```typescript
if (toolCalls.length === 0) {
  if (trimmed) {
    await emit({ type: 'token', delta: fullContent })
  }
  session.status = 'converged'
  session.pendingClarification = null
  yield { type: 'done', messageId: randomUUID(), converged: true }
  return
}
```

- [ ] **Step 2: Replace the MAX_TURNS end block**

Find the block after the `while` loop (starting with `// Reached MAX_TURNS`) and replace it with:

```typescript
// Reached MAX_TURNS without explicit convergence
session.status = 'converged'
yield { type: 'done', messageId: randomUUID(), converged: true }
```

- [ ] **Step 3: Remove unused variable references**

Remove any lines that reference `session.currentScore` or `session.currentEvaluation` in `react-loop.ts` (there should be 2–3 after the above edits).

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/react-loop.ts
git commit -m "feat(react-loop): remove evaluation/scoring logic and max_iter_reached"
```

---

## Task 6: Remove `iterationCount` from API persistence layer

**Files:**
- Modify: `apps/api/src/agents/tools/agent/generate-plan.tool.ts`
- Modify: `apps/api/src/persistence/pg.ts`
- Modify: `apps/api/src/session/store.ts`
- Modify: `apps/api/src/routes/sessions.ts`

- [ ] **Step 1: Remove `iterationCount` increment from `generate-plan.tool.ts`**

Delete this line from the `call` method:

```typescript
session.iterationCount = (session.iterationCount ?? 0) + 1
```

- [ ] **Step 2: Remove `iterationCount` from `pg.ts`**

In `apps/api/src/persistence/pg.ts`:

Remove `iteration_count: number` from the DB row type.

Remove `iterationCount: row.iteration_count` from the row mapper.

In the upsert query, remove `, iteration_count` from the column list in the INSERT columns, remove the corresponding `$N` placeholder, remove `iteration_count = EXCLUDED.iteration_count` from the ON CONFLICT SET, and remove `state.iterationCount` from the values array. Renumber remaining `$N` placeholders accordingly.

- [ ] **Step 3: Remove `iterationCount` from `session/store.ts`**

Delete `iterationCount: 0,` from the initial session object in `apps/api/src/session/store.ts`.

- [ ] **Step 4: Remove `iterationCount` reset from `routes/sessions.ts`**

Delete `session.iterationCount = 0` (around line 146 in `apps/api/src/routes/sessions.ts`).

- [ ] **Step 5: Run full API test suite**

```bash
pnpm --filter @travel-agent/api exec vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/tools/agent/generate-plan.tool.ts \
        apps/api/src/persistence/pg.ts \
        apps/api/src/session/store.ts \
        apps/api/src/routes/sessions.ts
git commit -m "feat(api): remove iterationCount from session and persistence"
```

---

## Task 7: Clean `packages/shared` — session schema

**Files:**
- Modify: `packages/shared/src/session.ts`

- [ ] **Step 1: Remove `EvaluationReport` import from `session.ts`**

Delete:
```typescript
import type { EvaluationReport } from './evaluation.js'
```

- [ ] **Step 2: Remove `ItineraryScoreSummarySchema` and its type export**

Delete the entire `ItineraryScoreSummarySchema` definition and the `ItineraryScoreSummary` type alias from `session.ts`.

- [ ] **Step 3: Remove three fields from `SessionStateSchema`**

Delete these lines from `SessionStateSchema`:
```typescript
currentScore: ItineraryScoreSummarySchema.nullable().default(null),
currentEvaluation: z.custom<EvaluationReport>().nullable().default(null),
iterationCount: z.number().int().nonnegative().default(0),
```

- [ ] **Step 4: Remove `'refining'` from `SessionStatusEnum`**

Change:
```typescript
export const SessionStatusEnum = z.enum([
  'draft', 'planning', 'refining', 'awaiting_user', 'converged', 'error',
])
```
To:
```typescript
export const SessionStatusEnum = z.enum([
  'draft', 'planning', 'awaiting_user', 'converged', 'error',
])
```

- [ ] **Step 5: Run shared tests**

```bash
pnpm --filter @travel-agent/shared exec vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/session.ts
git commit -m "feat(shared): remove score/evaluation fields and refining status from session schema"
```

---

## Task 8: Clean `packages/shared` — events and files

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`
- Delete: `packages/shared/src/evaluation.ts`
- Delete: `packages/shared/src/scoring.ts`
- Delete: `packages/shared/src/evaluation.test.ts` (if it exists)
- Delete: `packages/shared/src/scoring.test.ts` (if it exists)

- [ ] **Step 1: Remove three events from `events.ts`**

In `packages/shared/src/events.ts`, delete the three `z.object(...)` entries for `score`, `iteration_progress`, and `max_iter_reached`. Each starts with `z.object({ type: z.literal('score'` etc. The union will shrink from 14 to 11 variants.

- [ ] **Step 2: Delete evaluation and scoring files**

```bash
rm packages/shared/src/evaluation.ts packages/shared/src/scoring.ts
# Remove test files if they exist
rm -f packages/shared/src/evaluation.test.ts packages/shared/src/scoring.test.ts
```

- [ ] **Step 3: Update `packages/shared/src/index.ts`**

Remove these two lines:
```typescript
export * from './scoring.js'
export * from './evaluation.js'
```

- [ ] **Step 4: Run shared + API tests together**

```bash
pnpm -r test
```

Expected: all tests pass. If the API references `EvaluationReport` or `scorePlan` elsewhere, TypeScript will error — fix any stray import.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): remove score/iteration_progress/max_iter_reached events and delete evaluation/scoring modules"
```

---

## Task 9: Frontend store cleanup

**Files:**
- Modify: `apps/web/stores/chat.ts`
- Modify: `apps/web/stores/workspace.ts`

- [ ] **Step 1: Update `apps/web/stores/chat.ts` state**

Remove from the state object:
```typescript
displayScore: null as number | null,
targetScore: 90,
loopStatus: null as 'evaluating' | 'refining' | null,
maxIterReached: null as { currentScore: number } | null,
```

- [ ] **Step 2: Update `resetTransientState` in `chat.ts`**

Remove these lines from `resetTransientState`:
```typescript
this.displayScore = null
this.loopStatus = null
this.maxIterReached = null
```
Also remove `this.targetScore = 90` if present.

- [ ] **Step 3: Remove event handlers in `chat.ts`**

Delete the three `case` blocks for `'iteration_progress'`, `'score'`, and `'max_iter_reached'` from the `handleEvent` / `processEvent` switch.

In the `'plan'` case handler, remove `this.agentStatus = '正在评估行程…'`.

- [ ] **Step 4: Remove unused import from `chat.ts`**

Remove `ItineraryScoreSummary` from the import line at the top of `chat.ts`.

- [ ] **Step 5: Update `apps/web/stores/workspace.ts`**

Remove `currentScore: null as ItineraryScoreSummary | null` from the state object.

Remove `this.currentScore = session.currentScore` from the session hydration method.

Remove `this.currentScore = null` from any reset method.

Remove `ItineraryScoreSummary` from the import at the top of `workspace.ts`.

- [ ] **Step 6: Run web type check**

```bash
pnpm --filter @travel-agent/web exec vue-tsc --noEmit
```

Expected: no type errors in store files.

- [ ] **Step 7: Commit**

```bash
git add apps/web/stores/
git commit -m "feat(web/stores): remove score, loopStatus, and maxIterReached state"
```

---

## Task 10: Frontend component cleanup

**Files:**
- Delete: `apps/web/components/react/MaxIterCard.vue`
- Delete: `apps/web/components/react/ReactProgressBar.vue`
- Delete: `apps/web/components/ItineraryScore.vue`
- Delete: `apps/web/utils/scoring.ts`
- Modify: `apps/web/components/states/StreamingBubble.vue`
- Modify: `apps/web/components/PlanningPreview.vue`
- Modify: `apps/web/composables/useTripHistory.ts`
- Modify: `apps/web/composables/useTripHistory.test.ts`
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Delete removed components**

```bash
rm apps/web/components/react/MaxIterCard.vue
rm apps/web/components/react/ReactProgressBar.vue
rm apps/web/components/ItineraryScore.vue
rm apps/web/utils/scoring.ts
```

- [ ] **Step 2: Simplify `StreamingBubble.vue`**

Replace the `<script setup>` with:
```typescript
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

defineProps<{
  status: string
  steps?: string[]
}>()
</script>
```

Replace the `effectiveStatus` computed and its usages in the template — change `{{ effectiveStatus }}` to `{{ status }}`.

- [ ] **Step 3: Remove `ItineraryScore` from `PlanningPreview.vue`**

In `apps/web/components/PlanningPreview.vue`:
- Delete the `import ItineraryScore` line
- Delete `import type { ItineraryScore, ItemScore } from '~/utils/scoring'`
- Delete the `itineraryScore` and `displayScore` computed properties
- Delete `<ItineraryScore v-if="displayScore" :score="displayScore" />` from the template

- [ ] **Step 4: Update `useTripHistory.ts`**

In `apps/web/composables/useTripHistory.ts`, change:
```typescript
const IN_PROGRESS_STATUSES = new Set(['planning', 'refining', 'awaiting_user'])
```
To:
```typescript
const IN_PROGRESS_STATUSES = new Set(['planning', 'awaiting_user'])
```

- [ ] **Step 5: Update `useTripHistory.test.ts`**

In `apps/web/composables/useTripHistory.test.ts`, find any test fixture using `status: 'refining'` and change it to `status: 'planning'` (or `'awaiting_user'` depending on what the test is asserting).

Also remove `currentScore: null` and `currentEvaluation: null` and `iterationCount: 0` from test fixture objects — these fields no longer exist on `SessionState`.

- [ ] **Step 6: Update `index.vue`**

In `apps/web/pages/index.vue`:

Remove these two import lines:
```typescript
import MaxIterCard from "~/components/react/MaxIterCard.vue"
import ReactProgressBar from "~/components/react/ReactProgressBar.vue"
```

Remove from the destructured store values:
```typescript
maxIterations,
displayScore,
targetScore,
loopStatus,
maxIterReached,
```

Remove the `<ReactProgressBar v-if="loopStatus" ...>` block from the template.

Remove the `<MaxIterCard v-else-if="canContinue && maxIterReached" ...>` block from the template.

- [ ] **Step 7: Run full type check**

```bash
pnpm --filter @travel-agent/web exec vue-tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 8: Run all tests**

```bash
pnpm -r test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat(web): remove score UI components and clean up evaluation references"
```

---

## Task 11: Smoke test the full pipeline

- [ ] **Step 1: Start the dev stack**

```bash
pnpm dev
```

- [ ] **Step 2: Open the browser at the printed URL (default http://localhost:3000) and log in**

- [ ] **Step 3: Send a planning request, e.g. "帮我规划广东3天游，2人"**

Expected sequence visible in the chat panel:
1. ReAct steps appear: extractor → prefetch → generator
2. Itinerary streams into the planning preview
3. A short Chinese confirmation message appears (e.g. "行程规划已完成，祝您旅途愉快！")
4. No score bar, no "继续优化" card

- [ ] **Step 4: Test clarification flow — send an ambiguous message, e.g. "帮我规划一次旅行"**

Expected: clarification question appears asking for destination/dates/traveler count.

- [ ] **Step 5: Commit any follow-up fixes found during smoke test**
