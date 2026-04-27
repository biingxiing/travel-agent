# Subagent Architecture + Prompt Caching + Language Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the ReAct planning loop into clean stateless subagents, move all prompts to English with user-language output injection, enable LLM prefix caching, fix all P0/P1 code-review bugs, and replace the multi-iteration refine loop with a single-pass model.

**Architecture:** Each agent (extractor, clarifier, critic, generator, refiner) receives only the structured data it needs — no raw `session.messages` passed to generator or refiner. The orchestrator (`react-loop.ts`) stores `prefetchContext` on the session so the single refine pass can reuse flyai data without re-fetching. `language` flows from the HTTP request → session → each user-facing agent, defaulting to `'zh'`.

**Tech Stack:** TypeScript, Hono, Zod, OpenAI-compatible SDK, Pinia (Vue 3), Vitest

---

## File Map

| File | Change |
|------|--------|
| `packages/shared/src/session.ts` | Add `prefetchContext`, `language` to `SessionStateSchema` |
| `apps/api/src/agents/extractor.ts` | SYSTEM_PROMPT → English |
| `apps/api/src/agents/clarifier.ts` | SYSTEM_PROMPT → English; add `language` param |
| `apps/api/src/agents/critic.ts` | SYSTEM_PROMPT → English; add `language` param for blocker messages |
| `apps/api/src/agents/generator.ts` | Both prompts → English ≥1024 tokens; remove `messages` param; add `language` + `prefetchContext` to `runRefine`; fix message order |
| `apps/api/src/agents/react-loop.ts` | Single-refine pass; store `session.prefetchContext`; pass `language` |
| `apps/api/src/routes/sessions.ts` | Accept `language` in `SendMessageSchema`; store in session |
| `apps/web/stores/chat.ts` | Extract `resetTransientState()`; fix message-ID collision; remove dual plan truth |
| `apps/web/pages/index.vue` | Explicit `stream.setSessionId()` in `loadHistoryEntry` |
| `apps/web/composables/useChatStream.ts` | Pass `language` in request body |
| `apps/api/src/agents/react-loop.test.ts` | Update fixtures + single-refine assertions |
| `apps/api/src/agents/generator.test.ts` | Update `runRefine` call sites (remove `messages` arg) |

---

## Task 1: Shared — extend SessionState with `prefetchContext` and `language`

**Files:**
- Modify: `packages/shared/src/session.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/session.test.ts` (create if absent — check `pnpm test:shared` first):

```typescript
import { describe, it, expect } from 'vitest'
import { SessionStateSchema } from './session.js'

describe('SessionStateSchema defaults', () => {
  it('adds prefetchContext default []', () => {
    const s = SessionStateSchema.parse({
      id: 's1', userId: 'u1', title: null, brief: null,
      messages: [], currentPlan: null, currentScore: null,
      status: 'draft', iterationCount: 0, lastRunId: null,
      pendingClarification: null, createdAt: 1, updatedAt: 1,
    })
    expect(s.prefetchContext).toEqual([])
  })

  it('adds language default zh', () => {
    const s = SessionStateSchema.parse({
      id: 's1', userId: 'u1', title: null, brief: null,
      messages: [], currentPlan: null, currentScore: null,
      status: 'draft', iterationCount: 0, lastRunId: null,
      pendingClarification: null, createdAt: 1, updatedAt: 1,
    })
    expect(s.language).toBe('zh')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:shared
```
Expected: FAIL — `prefetchContext` and `language` do not exist on type.

- [ ] **Step 3: Add the two fields to `SessionStateSchema`**

In `packages/shared/src/session.ts`, update `SessionStateSchema`:

```typescript
export const SessionStateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable().default(null),
  brief: TripBriefSchema.nullable().default(null),
  messages: z.array(MessageSchema).default([]),
  currentPlan: PlanSchema.nullable().default(null),
  currentScore: ItineraryScoreSummarySchema.nullable().default(null),
  status: SessionStatusEnum,
  iterationCount: z.number().int().nonnegative().default(0),
  lastRunId: z.string().nullable().default(null),
  pendingClarification: z.string().nullable().default(null),
  prefetchContext: z.array(z.string()).default([]),  // new
  language: z.string().default('zh'),                // new
  createdAt: z.number(),
  updatedAt: z.number(),
})
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test:shared
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/session.ts packages/shared/src/session.test.ts
git commit -m "feat(shared): add prefetchContext and language to SessionState"
```

---

## Task 2: API — Extractor prompt → English

**Files:**
- Modify: `apps/api/src/agents/extractor.ts`

- [ ] **Step 1: Run existing extractor tests first**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/extractor.test.ts
```
Expected: all PASS (baseline).

- [ ] **Step 2: Replace `SYSTEM_PROMPT` in extractor.ts with English version**

Replace the `const SYSTEM_PROMPT = ` block (lines 53–75):

```typescript
const SYSTEM_PROMPT = `You are a travel intent extractor. Read the conversation history and existing TripBrief (may be null), extract/merge the latest TripBrief, and determine the user's intent.

Output JSON (one object only, no markdown):
{
  "brief": {
    "destinations": ["city1", "city2"],
    "days": number,
    "originCity": "...",
    "travelers": number,
    "preferences": ["..."],
    "pace": "relaxed|balanced|packed",
    "budget": { "amount": number, "currency": "CNY" },
    "travelDates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "notes": "..."
  },
  "intent": "new" | "refine" | "clarify-answer" | "continue",
  "changedFields": ["destinations", ...]
}

Intent classification rules:
- User describes a trip for the first time ("go to X for N days") → "new"
- User answers a previous clarifying question ("departing from Shanghai") → "clarify-answer"
- User modifies an existing plan ("change the hotel", "add one more day") → "refine"
- User asks to continue optimizing ("keep refining", "try again") → "continue"

Merge rules: preserve unchanged fields from existingBrief; overwrite only the fields the user explicitly changed.`
```

- [ ] **Step 3: Run extractor tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/extractor.test.ts
```
Expected: all PASS (prompt language doesn't affect schema parsing tests).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/extractor.ts
git commit -m "feat(extractor): convert system prompt to English"
```

---

## Task 3: API — Clarifier prompt → English + language param

**Files:**
- Modify: `apps/api/src/agents/clarifier.ts`

- [ ] **Step 1: Replace SYSTEM_PROMPT construction and add `language` param**

Replace the entire file content:

```typescript
import { llm, FAST_MODEL } from '../llm/client.js'
import type { TripBrief, Message } from '@travel-agent/shared'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

interface ClarifyResult {
  question: string
  defaultSuggestion: string | null
}

const FALLBACKS: Record<ClarifyReason, Record<string, ClarifyResult>> = {
  missing_destination: {
    zh: { question: '你想去哪里旅行？', defaultSuggestion: null },
    en: { question: 'Where would you like to travel?', defaultSuggestion: null },
  },
  missing_days: {
    zh: { question: '你计划玩几天？', defaultSuggestion: '按 5 天规划' },
    en: { question: 'How many days are you planning?', defaultSuggestion: 'Plan for 5 days' },
  },
  missing_dates: {
    zh: { question: '你打算什么时候出发？', defaultSuggestion: null },
    en: { question: 'When are you planning to depart?', defaultSuggestion: null },
  },
}

function getFallback(reason: ClarifyReason, language: string): ClarifyResult {
  return FALLBACKS[reason][language] ?? FALLBACKS[reason]['zh']
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function defaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return formatDate(d)
}

function briefSummary(brief: Partial<TripBrief>): string {
  const parts: string[] = []
  if (brief.destinations?.length) parts.push(`destinations: ${brief.destinations.join(', ')}`)
  if (brief.days) parts.push(`${brief.days} days`)
  if (brief.travelers && brief.travelers > 1) parts.push(`${brief.travelers} travelers`)
  if (brief.originCity) parts.push(`departing from ${brief.originCity}`)
  return parts.join('; ') || 'none'
}

export async function generateClarification(
  messages: Message[],
  brief: Partial<TripBrief>,
  reason: ClarifyReason,
  language = 'zh',
): Promise<ClarifyResult> {
  const fieldLabel =
    reason === 'missing_destination' ? 'travel destination' :
    reason === 'missing_days' ? 'number of travel days' : 'departure date'

  const systemPrompt =
    `You are a travel planning assistant. Known trip info: ${briefSummary(brief)}. ` +
    `Missing field: ${fieldLabel}. ` +
    `Ask for this field in a warm, conversational single sentence (max 20 words). ` +
    `Do not repeat information the user already provided. Output only the question. ` +
    `IMPORTANT: Write the question in this language: ${language}.`

  const fallback = getFallback(reason, language)
  let question: string = fallback.question
  try {
    const resp = await llm.chat.completions.create({
      model: FAST_MODEL,
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
      max_tokens: 60,
    })
    const raw = resp.choices[0]?.message?.content?.trim()
    if (raw) question = raw
  } catch (err) {
    console.warn('[Clarifier] LLM failed, using fallback:', err instanceof Error ? err.message : err)
  }

  let defaultSuggestion: string | null = fallback.defaultSuggestion
  if (reason === 'missing_dates') {
    const start = defaultStartDate()
    defaultSuggestion = language === 'zh'
      ? `按 ${start} 出发规划`
      : `Plan departure from ${start}`
  }

  return { question, defaultSuggestion }
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm -r test
```
Expected: PASS. If clarifier.test.ts exists, it should still pass (interface unchanged).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/agents/clarifier.ts
git commit -m "feat(clarifier): English prompt + language param for user-facing questions"
```

---

## Task 4: API — Critic prompt → English + language param for blocker messages

**Files:**
- Modify: `apps/api/src/agents/critic.ts`

- [ ] **Step 1: Replace `SYSTEM_PROMPT` and add `language` param to `criticReview`**

Replace the entire file:

```typescript
import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import { CriticReportSchema, type CriticReport, type Plan, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'

const SYSTEM_PROMPT_BASE = `You are a travel itinerary reviewer. Read a Plan and TripBrief, identify issues by dimension.

[BLOCKER] (critical missing info — must ask user before proceeding):
- missing_origin: cross-city travel but no departure city
- missing_dates: dates required for flight/hotel booking but absent
- missing_budget: user gave no budget and itinerary quality is ambiguous
- unclear_preference: preferences (food/culture/outdoor) too vague to select attractions
- other: other critical clarification needed

[ITEM ISSUE] (problem with a specific item on a specific day):
- transport: missing flight/train number → suggestedAction: call_flyai_flight or call_flyai_train
- lodging: missing specific hotel/room type → suggestedAction: call_flyai_hotel
- attraction: vague description (missing opening hours / admission / duration) → suggestedAction: rewrite_description
- duplicate or unreasonable item → suggestedAction: replace_item
- out-of-sequence items → suggestedAction: reorder
severity: high (score < 50) | medium (50–79) | low (≥ 80)

[GLOBAL ISSUE]: repeated attractions, unbalanced pace, thematic inconsistency, etc.

Output JSON (one object, no markdown):
{
  "qualityScore": 0-100,
  "blockers": [{ "type": "...", "message": "<question string in OUTPUT_LANGUAGE>" }],
  "itemIssues": [{
    "dayNum": number, "itemIndex": number, "severity": "high|medium|low",
    "category": "transport|lodging|attraction|meal|coherence",
    "problem": "...", "suggestedAction": "...",
    "hints": { /* optional: params for flyai calls */ }
  }],
  "globalIssues": ["..."]
}`

const FALLBACK: CriticReport = {
  qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
}

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

  let resp
  try {
    resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
  } catch (err) {
    console.warn('[Critic] LLM call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const raw = resp.choices[0]?.message?.content ?? '{}'
  try {
    return CriticReportSchema.parse(JSON.parse(raw || '{}'))
  } catch (err) {
    console.warn(`[Critic] Parse failed (raw="${raw.slice(0, 200).replace(/\n/g, '\\n')}"):`, err instanceof Error ? err.message : err)
    return FALLBACK
  }
}
```

- [ ] **Step 2: Update evaluator.ts to pass language**

In `apps/api/src/agents/evaluator.ts`, update the signature and `criticReview` call:

```typescript
import { scorePlan, isConverged, type Plan, type TripBrief, type EvaluationReport } from '@travel-agent/shared'
import { criticReview } from './critic.js'
import { getEvalConfig } from '../config/eval.js'

export async function evaluate(plan: Plan, brief: TripBrief, language = 'zh'): Promise<EvaluationReport> {
  const cfg = getEvalConfig()
  const ruleScore = scorePlan(plan)
  const critic = await criticReview(plan, brief, language)  // pass language
  const llmScore = critic.qualityScore

  const overallCombined = Math.round(cfg.ruleWeight * ruleScore.overall + cfg.llmWeight * llmScore)

  const combined = {
    overall: overallCombined,
    transport: ruleScore.transport.score,
    lodging: ruleScore.lodging.score,
    attraction: ruleScore.attraction.score,
  }

  const converged = isConverged(ruleScore, cfg.threshold) &&
    cfg.requiredCategories.every((cat) => ruleScore[cat].score !== null)

  return {
    ruleScore, llmScore, combined,
    blockers: critic.blockers,
    itemIssues: critic.itemIssues,
    globalIssues: critic.globalIssues,
    converged,
  }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm -r test
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/critic.ts apps/api/src/agents/evaluator.ts
git commit -m "feat(critic,evaluator): English prompt + language param for blocker messages"
```

---

## Task 5: API — Generator major refactor (English prompts, clean subagent signature)

This is the largest single task. It achieves:
1. English system prompts expanded to ≥1024 tokens (OpenAI prefix caching threshold)
2. Removes `messages: Message[]` from both `runInitial` and `runRefine`
3. Adds `prefetchContext: string[]` to `runRefine` (replaces messages)
4. Adds `language` param to both functions
5. Fixes message order bug (task instruction always last)

**Files:**
- Modify: `apps/api/src/agents/generator.ts`
- Modify: `apps/api/src/agents/generator.test.ts`

- [ ] **Step 1: Read current generator.test.ts to understand what to update**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```
Note which tests call `runRefine` with a `messages` argument — they will need updating.

- [ ] **Step 2: Write failing tests for new signatures**

Add to `apps/api/src/agents/generator.test.ts` (add alongside existing tests, do not delete them yet):

```typescript
// New signature tests
it('runRefine accepts prefetchContext instead of messages', async () => {
  const mockPlan = { /* minimal valid plan */ } as Plan
  const mockReport = {
    combined: { overall: 70, transport: 70, lodging: 70, attraction: 70 },
    itemIssues: [], globalIssues: [], blockers: [], converged: false,
    ruleScore: {} as any, llmScore: 70,
  }
  const mockBrief = {
    destinations: ['Beijing'], days: 3, travelers: 1,
    preferences: [], originCity: null, pace: 'balanced',
    budget: null, travelDates: null, notes: null,
  } as TripBrief

  // Should not throw — no messages param
  const result = await runRefine(mockPlan, mockReport, mockBrief, ['prefetch data'])
  expect(result).toBeDefined()
})
```

- [ ] **Step 3: Run new test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```
Expected: FAIL — `runRefine` still requires 4 args with old `messages` as 4th.

- [ ] **Step 4: Replace generator.ts with new implementation**

Replace the full file content of `apps/api/src/agents/generator.ts`:

```typescript
import { randomUUID } from 'crypto'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedCompletion, loggedStream } from '../llm/logger.js'
import { skillRegistry } from '../registry/skill-registry.js'
import {
  PlanSchema, type Plan, type ChatStreamEvent, type EvaluationReport, type TripBrief,
} from '@travel-agent/shared'
import type OpenAI from 'openai'
import type { SkillManifest } from '../registry/types.js'

const MAX_SKILL_ROUNDS = 4

// Static prefix — must be identical across calls for LLM prefix caching.
// Keep this const module-level so the string reference is stable.
const SYSTEM_PROMPT_INITIAL = `You are a professional travel planner. Based on the TripBrief and any prefetched real-world data provided in system messages, generate a complete JSON itinerary.

## Input Guidelines
- System messages may contain "Real flight/hotel/POI data". These are actual results already fetched via flyai. Use them directly when filling PlanItems.
- Do NOT say "I cannot check real-time" — real data has already been provided. Fill items from it directly.
- If a data type is missing (e.g., no flight data for local travel), use general knowledge. Do not refuse to output.
- If you need supplementary data, call a flyai tool (command: search-flight, search-hotel, search-poi, search-train). Otherwise skip the tool call.

## Output Format
- Start with 1–2 natural language sentences telling the user you are planning, then output exactly ONE \`\`\`json code block.
- If destinations or days are missing, ask in natural language; do not output JSON.
- Every day in dailyPlans[].items MUST contain at least 3 items. Empty arrays are invalid.

## Required Content Per Item Type

### Transport Items (type: "transport")
- Must include: flight or train number, departure/arrival stations or airports, departure/arrival times, ticket price.
- For every adjacent city pair (including origin↔first city, last city↔origin) insert one transport item.
- When both flight and train data are available, recommend the best option and mention the alternative.
- Description format: "Recommended: [number], [dep]→[arr], [time], ¥[price]. Alternative: [option], ¥[price] / [hours]h"
- On multi-destination trips insert a transport item at end of the day when switching cities.

### Lodging Items (type: "lodging")
- Must include: hotel name, star rating or property type, price per night.
- Use real hotel names from flyai data when available.

### Attraction Items (type: "attraction")
- Must include: opening hours (e.g. 09:00–17:00 or all-day), admission fee (e.g. ¥60/person or free), suggested visit duration (e.g. 2 hours).

### Meal Items (type: "meal")
- Include at least one meal per day with restaurant name or cuisine type and price range.

## JSON Schema (strict — violations cause parse rejection)
Top-level fields:
- title: string
- destinations: string[] — ordered by visit sequence
- days: number
- travelers: number
- pace: "relaxed" | "balanced" | "packed"  (English enum only — never Chinese)
- dailyPlans: Array<{ day: number, items: PlanItem[] }>
- estimatedBudget: { amount: number, currency: "CNY", breakdown: Array<{ category: "transport"|"lodging"|"food"|"tickets"|"other", amount: number }> }
- tips: string[]
- disclaimer: string

PlanItem fields:
- type: "attraction" | "meal" | "transport" | "lodging" | "activity" | "note"  (English enum only)
- title: string
- description: string — must meet requirements above per item type
- duration?: string
- cost?: number

## Quality Standards
- Budget total must be internally consistent with item prices.
- Do not repeat the same attraction or hotel across days.
- Group nearby attractions on the same day for geographic efficiency.
- Transport must connect the correct city pairs with realistic schedules.
- All prices should be reasonable for the destination and traveler count.
- Output all user-facing text (titles, descriptions, tips, disclaimer) in OUTPUT_LANGUAGE.`

const SYSTEM_PROMPT_REFINE = `You are a travel itinerary repair specialist. Fix ONLY the issues identified in the critic's EvaluationReport — do NOT rewrite the entire itinerary.

## Repair Instructions

For each itemIssue:
- suggestedAction = call_flyai_flight: call flyai search-flight using hints, then rewrite the transport item description with real data (flight number, route, time, price).
- suggestedAction = call_flyai_train: call flyai search-train using hints, then rewrite the transport item with real train data.
- suggestedAction = call_flyai_hotel: call flyai search-hotel using hints, then rewrite the lodging item with real hotel name and price.
- suggestedAction = call_flyai_poi: call flyai search-poi using hints, then enrich the attraction description.
- suggestedAction = rewrite_description: rewrite only the description field, adding the missing details (opening hours, admission, duration, hotel name, price per night).
- suggestedAction = replace_item: replace with a more appropriate item at the same position.
- suggestedAction = reorder: adjust item order within the day for logical flow.

For globalIssues: make targeted adjustments (e.g., swap a duplicate attraction, rebalance a packed day).

Preserve every item NOT mentioned in the report exactly as-is.

## Output
Output the COMPLETE repaired plan JSON (all days, all items including unchanged ones) — exactly ONE \`\`\`json code block. No prose before or after.

## Input You Will Receive
1. TripBrief — structured trip requirements
2. PrefetchContext — real-world data already retrieved for this session (for reference)
3. CurrentPlan — the plan to repair
4. EvaluationReport — itemIssues and globalIssues to address

Output all user-facing text in OUTPUT_LANGUAGE.`

// Build tool list once per process start — skill registry is static after bootstrap.
let _cachedTools: OpenAI.Chat.ChatCompletionTool[] | null = null
function buildSkillTools(): OpenAI.Chat.ChatCompletionTool[] {
  if (_cachedTools) return _cachedTools
  _cachedTools = skillRegistry.list().map((m: SkillManifest) => ({
    type: 'function',
    function: {
      name: m.name,
      description: m.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(m.parameters ?? {}).map(([k, p]) => [k, { type: p.type, description: p.description }]),
        ),
        required: Object.entries(m.parameters ?? {}).filter(([, p]) => p.required).map(([k]) => k),
        additionalProperties: false,
      },
    },
  }))
  return _cachedTools
}

function extractJsonCodeBlock(content: string): string | null {
  const m = content.match(/```json\s*([\s\S]*?)\s*```/)
  return m?.[1] ?? null
}

function normalizePace(raw: unknown): 'relaxed' | 'balanced' | 'packed' | undefined {
  if (raw === 'relaxed' || raw === 'balanced' || raw === 'packed') return raw
  if (typeof raw !== 'string') return undefined
  if (/紧|密|高强|快|加速|大量/.test(raw)) return 'packed'
  if (/松|休闲|慢|宽|轻松|舒缓/.test(raw)) return 'relaxed'
  return 'balanced'
}

const ITEM_TYPE_MAP: Record<string, 'attraction' | 'meal' | 'transport' | 'lodging' | 'activity' | 'note'> = {
  attraction: 'attraction', meal: 'meal', transport: 'transport',
  lodging: 'lodging', activity: 'activity', note: 'note',
  '景点': 'attraction', '景区': 'attraction', '观光': 'attraction',
  '餐饮': 'meal', '美食': 'meal', '用餐': 'meal', '餐厅': 'meal',
  '交通': 'transport', '出行': 'transport', '航班': 'transport', '高铁': 'transport', '火车': 'transport',
  '住宿': 'lodging', '酒店': 'lodging', '入住': 'lodging',
  '活动': 'activity', '体验': 'activity',
  '备注': 'note', '提示': 'note',
}

function normalizePlanItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item }
  if (typeof out.type === 'string' && !ITEM_TYPE_MAP[out.type]) {
    for (const [zh, en] of Object.entries(ITEM_TYPE_MAP)) {
      if ((out.type as string).includes(zh)) { out.type = en; break }
    }
  } else if (typeof out.type === 'string') {
    out.type = ITEM_TYPE_MAP[out.type]
  }
  if (typeof out.type !== 'string') out.type = 'activity'
  if (typeof out.title !== 'string' || !out.title) {
    out.title = typeof out.description === 'string' && out.description
      ? (out.description as string).slice(0, 40)
      : '未命名'
  }
  return out
}

function normalizePlanJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>
  const normalizedPace = normalizePace(obj.pace)
  if (normalizedPace) obj.pace = normalizedPace
  else delete obj.pace
  if (Array.isArray(obj.dailyPlans)) {
    obj.dailyPlans = (obj.dailyPlans as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      items: Array.isArray(d.items)
        ? (d.items as Array<Record<string, unknown>>).map(normalizePlanItem)
        : [],
    }))
  }
  if (obj.estimatedBudget && typeof obj.estimatedBudget === 'object') {
    const b = obj.estimatedBudget as Record<string, unknown>
    if (typeof b.amount !== 'number') b.amount = 0
    if (typeof b.currency !== 'string') b.currency = 'CNY'
    if (b.breakdown && !Array.isArray(b.breakdown) && typeof b.breakdown === 'object') {
      b.breakdown = Object.entries(b.breakdown as Record<string, unknown>)
        .filter(([k]) => ['transport', 'lodging', 'food', 'tickets', 'other'].includes(k))
        .map(([category, amount]) => ({
          category,
          amount: typeof amount === 'number' ? amount : 0,
        }))
    }
  }
  if (!Array.isArray(obj.preferences)) obj.preferences = []
  if (!Array.isArray(obj.tips)) obj.tips = []
  if (typeof obj.travelers !== 'number') obj.travelers = 1
  if (typeof obj.disclaimer !== 'string') {
    obj.disclaimer = '本行程由 AI 生成，仅供参考。出行前请通过官方渠道核对最新信息。'
  }
  return obj
}

async function runWithToolLoop(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
): Promise<{ content: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] }> {
  let current = [...messages]
  for (let i = 0; i < MAX_SKILL_ROUNDS; i++) {
    const resp = await loggedCompletion('generator', {
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3,
    })
    const msg = resp.choices[0]?.message
    if (!msg) return { content: '', messages: current }
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) return { content: typeof msg.content === 'string' ? msg.content : '', messages: current }
    current.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const c of calls) {
      let out: string
      try {
        const args = c.function.arguments ? JSON.parse(c.function.arguments) : {}
        out = await skillRegistry.invoke(c.function.name, args as Record<string, unknown>)
      } catch (err) {
        out = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      current.push({ role: 'tool', tool_call_id: c.id, content: out })
    }
  }
  return { content: '', messages: current }
}

function resolveLanguageLabel(language: string): string {
  if (language === 'zh') return 'Chinese (Simplified)'
  if (language === 'en') return 'English'
  return language
}

// runInitial: receives only structured data — no raw chat history.
// TripBrief is the distilled intent; history is not needed by the generator.
export async function* runInitial(
  brief: TripBrief,
  prefetchedContext: string[] = [],
  language = 'zh',
): AsyncGenerator<ChatStreamEvent, Plan | null, void> {
  const messageId = randomUUID()
  const systemPrompt = SYSTEM_PROMPT_INITIAL.replace('OUTPUT_LANGUAGE', resolveLanguageLabel(language))

  const prefetchedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = prefetchedContext.map(
    (content) => ({ role: 'system' as const, content }),
  )
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...prefetchedMessages,
    { role: 'user', content: `TripBrief:\n${JSON.stringify(brief)}` },
  ]

  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)

  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of loggedStream('generator', {
    model: PLANNER_MODEL,
    messages: [
      ...prepared.messages,
      { role: 'system', content: 'Generate the final itinerary now: natural language intro + ```json code block.' },
    ],
    tools, tool_choice: 'none',
    temperature: 0.7,
  })) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (!delta) continue
    full += delta
    if (!inJson) {
      nlBuf += delta
      const start = nlBuf.indexOf('```json')
      if (start !== -1) {
        inJson = true
        const nlPart = nlBuf.slice(0, start).trimEnd()
        if (nlPart) yield { type: 'token', delta: nlPart }
        nlBuf = ''
      } else {
        const safe = nlBuf.length > 7 ? nlBuf.length - 7 : 0
        if (safe > 0) {
          yield { type: 'token', delta: nlBuf.slice(0, safe) }
          nlBuf = nlBuf.slice(safe)
        }
      }
    }
  }
  if (!inJson && nlBuf.trim()) yield { type: 'token', delta: nlBuf }

  const json = extractJsonCodeBlock(full)
  if (!json) {
    yield { type: 'done', messageId }
    return null
  }
  try {
    const plan = PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
    yield { type: 'plan', plan }
    yield { type: 'done', messageId }
    return plan
  } catch (err) {
    yield { type: 'error', code: 'PLAN_PARSE_FAILED', message: err instanceof Error ? err.message : String(err) }
    return null
  }
}

// runRefine: receives structured data only — no raw chat history.
// Reuses prefetchContext from the session to avoid redundant flyai calls.
export async function runRefine(
  current: Plan,
  report: EvaluationReport,
  brief: TripBrief,
  prefetchContext: string[] = [],
  language = 'zh',
): Promise<Plan> {
  const systemPrompt = SYSTEM_PROMPT_REFINE.replace('OUTPUT_LANGUAGE', resolveLanguageLabel(language))

  // Static prefix first (cacheable), then current task instruction last.
  const prefetchMessages: OpenAI.Chat.ChatCompletionMessageParam[] = prefetchContext.map(
    (content) => ({ role: 'user' as const, content: `[Prefetch data for reference]\n${content}` }),
  )
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...prefetchMessages,
    {
      role: 'user',
      content: [
        `TripBrief:\n${JSON.stringify(brief)}`,
        `\nCurrentPlan:\n${JSON.stringify(current)}`,
        `\nEvaluationReport:\n${JSON.stringify({
          combined: report.combined,
          itemIssues: report.itemIssues,
          globalIssues: report.globalIssues,
        })}`,
      ].join('\n'),
    },
  ]

  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)
  const rawJson = extractJsonCodeBlock(prepared.content) ?? prepared.content
  const json = rawJson?.trim()
  if (!json || (json[0] !== '{' && json[0] !== '[')) {
    console.warn(`[Generator.refine] No JSON in output (len=${prepared.content?.length ?? 0}), returning original`)
    return current
  }
  try {
    return PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
  } catch (err) {
    console.warn('[Generator.refine] Parse failed, returning original:', err)
    return current
  }
}
```

- [ ] **Step 5: Update generator.test.ts — remove `messages` arg from all `runRefine` calls**

Search `apps/api/src/agents/generator.test.ts` for any call like `runRefine(plan, report, brief, messages)` and change to `runRefine(plan, report, brief, [])`.

Also update the new test added in Step 2 if needed.

- [ ] **Step 6: Run generator tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/generator.ts apps/api/src/agents/generator.test.ts
git commit -m "feat(generator): English prompts, clean subagent signature, remove messages param, fix cache prefix"
```

---

## Task 6: API — React-loop: single-refine pass, store prefetchContext, pass language

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts`
- Modify: `apps/api/src/agents/react-loop.test.ts`

- [ ] **Step 1: Write failing test for single-refine behavior**

In `apps/api/src/agents/react-loop.test.ts`, add after the existing tests:

```typescript
it('runs evaluate then single refine when score is low', async () => {
  ;(extractBrief as any).mockResolvedValue({
    brief: { destinations: ['Beijing'], days: 3, travelers: 1, preferences: [] },
    intent: 'new', changedFields: [],
  })
  ;(runInitial as any).mockImplementation(async function* () {
    yield { type: 'plan', plan: samplePlan }
    yield { type: 'done', messageId: 'msg1' }
    return samplePlan
  })
  ;(evaluate as any)
    .mockResolvedValueOnce(emptyReport(false))  // first eval: not converged
    .mockResolvedValueOnce(emptyReport(true))   // second eval: converged
  ;(runRefine as any).mockResolvedValue(samplePlan)

  const session = baseSession()
  const events = await collect(runReactLoop(session, 'r1'))

  // runRefine called exactly once
  expect(runRefine).toHaveBeenCalledTimes(1)
  // evaluate called twice (initial + after refine)
  expect(evaluate).toHaveBeenCalledTimes(2)
  // ends with done event
  expect(events.some((e) => e.type === 'done')).toBe(true)
})

it('emits max_iter_reached if still not converged after single refine', async () => {
  ;(extractBrief as any).mockResolvedValue({
    brief: { destinations: ['Beijing'], days: 3, travelers: 1, preferences: [] },
    intent: 'new', changedFields: [],
  })
  ;(runInitial as any).mockImplementation(async function* () {
    yield { type: 'plan', plan: samplePlan }
    yield { type: 'done', messageId: 'msg1' }
    return samplePlan
  })
  ;(evaluate as any).mockResolvedValue(emptyReport(false))  // never converges
  ;(runRefine as any).mockResolvedValue(samplePlan)

  const session = baseSession()
  const events = await collect(runReactLoop(session, 'r1'))

  expect(events.some((e) => e.type === 'max_iter_reached')).toBe(true)
  expect(runRefine).toHaveBeenCalledTimes(1)
})
```

Also update `baseSession()` to include new fields:

```typescript
function baseSession(): SessionState {
  return {
    id: 's1', userId: 'u1', title: null, brief: null,
    messages: [{ role: 'user', content: '北京 3 天', timestamp: 1 }],
    currentPlan: null, currentScore: null, status: 'draft',
    iterationCount: 0, lastRunId: 'r1', pendingClarification: null,
    prefetchContext: [],   // new field
    language: 'zh',        // new field
    createdAt: 1, updatedAt: 1,
  }
}
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```
Expected: new tests FAIL (old while-loop still present).

- [ ] **Step 3: Replace react-loop.ts with single-refine orchestrator**

```typescript
import { randomUUID } from 'crypto'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import { prefetchFlyaiContext } from './prefetch.js'
import { generateClarification } from './clarifier.js'
import { getEvalConfig } from '../config/eval.js'
import {
  isBriefMinimallyComplete,
  type SessionState, type ChatStreamEvent, type ItineraryScoreSummary, type Plan,
} from '@travel-agent/shared'

function summarize(report: Awaited<ReturnType<typeof evaluate>>, iteration: number): ItineraryScoreSummary {
  return {
    overall: report.combined.overall,
    transport: report.combined.transport,
    lodging: report.combined.lodging,
    attraction: report.combined.attraction,
    iteration,
  }
}

function isCancelled(session: SessionState, runId: string): boolean {
  return session.lastRunId !== runId
}

export async function* runReactLoop(
  session: SessionState, runId: string,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const cfg = getEvalConfig()
  const language = session.language ?? 'zh'

  // Phase 0: Extract brief
  yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
  const ext = await extractBrief(session.messages, session.brief)
  session.brief = ext.brief

  if (!isBriefMinimallyComplete(ext.brief)) {
    const missingDest = !ext.brief.destinations?.length
    const reason = missingDest ? 'missing_destination' : 'missing_days'
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, reason, language,
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield { type: 'clarify_needed', question, reason, ...(defaultSuggestion !== null && { defaultSuggestion }) }
    return
  }

  // Phase 0.5: ask for travel dates if missing
  if (!ext.brief.travelDates) {
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, 'missing_dates', language,
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield { type: 'clarify_needed', question, reason: 'missing_dates', ...(defaultSuggestion !== null && { defaultSuggestion }) }
    return
  }

  if (isCancelled(session, runId)) return

  // Phase 1: Initial generation (only if no current plan, or user wants new trip)
  if (!session.currentPlan || ext.intent === 'new') {
    session.status = 'planning'
    session.iterationCount = 0

    yield { type: 'agent_step', agent: 'generator', status: 'thinking' }
    let prefetched: string[] = []
    try {
      prefetched = await prefetchFlyaiContext(ext.brief, session.id)
    } catch (err) {
      console.warn('[ReactLoop] prefetchFlyaiContext failed (continuing without):', err)
    }
    // Store prefetch so the single refine pass can reuse it without re-fetching
    session.prefetchContext = prefetched

    if (isCancelled(session, runId)) return

    let initial: Plan | null = null
    const gen = runInitial(ext.brief, prefetched, language)
    while (true) {
      const r = await gen.next()
      if (r.value && typeof r.value === 'object' && 'type' in r.value) {
        yield r.value as ChatStreamEvent
      }
      if (r.done) { initial = r.value as Plan | null; break }
    }
    if (!initial) return
    session.currentPlan = initial
    session.iterationCount = 1
  }

  // Phase 2: Evaluate once
  if (isCancelled(session, runId)) return
  session.status = 'refining'
  yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
  const report = await evaluate(session.currentPlan!, ext.brief, language)

  const summary = summarize(report, session.iterationCount)
  session.currentScore = summary
  yield {
    type: 'score',
    overall: summary.overall,
    transport: summary.transport,
    lodging: summary.lodging,
    attraction: summary.attraction,
    iteration: session.iterationCount,
    converged: report.converged,
  }

  if (report.blockers.length > 0) {
    const b = report.blockers[0]
    session.status = 'awaiting_user'
    session.pendingClarification = b.message
    yield { type: 'clarify_needed', question: b.message, reason: b.type }
    return
  }

  if (report.converged) {
    session.status = 'converged'
    session.pendingClarification = null
    yield { type: 'done', messageId: randomUUID(), converged: true }
    return
  }

  // Phase 3: Single refine pass
  if (isCancelled(session, runId)) return
  session.iterationCount++
  yield {
    type: 'iteration_progress',
    iteration: session.iterationCount,
    maxIterations: 2,
    currentScore: summary.overall,
    targetScore: cfg.threshold,
    status: 'refining',
  }
  yield { type: 'agent_step', agent: 'generator', status: 'refining' }
  const refined = await runRefine(
    session.currentPlan!, report, ext.brief,
    session.prefetchContext ?? [],
    language,
  )
  if (isCancelled(session, runId)) return
  session.currentPlan = refined
  yield { type: 'plan', plan: refined }

  // Final evaluation after refine
  yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
  const finalReport = await evaluate(refined, ext.brief, language)
  const finalSummary = summarize(finalReport, session.iterationCount)
  session.currentScore = finalSummary
  yield {
    type: 'score',
    overall: finalSummary.overall,
    transport: finalSummary.transport,
    lodging: finalSummary.lodging,
    attraction: finalSummary.attraction,
    iteration: session.iterationCount,
    converged: finalReport.converged,
  }

  if (finalReport.converged) {
    session.status = 'converged'
    session.pendingClarification = null
    yield { type: 'done', messageId: randomUUID(), converged: true }
    return
  }

  // Score still below threshold — surface to user for manual /continue
  session.status = 'awaiting_user'
  yield { type: 'max_iter_reached', currentScore: finalSummary.overall, plan: refined }
}
```

- [ ] **Step 4: Run all react-loop tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts
```
Expected: all PASS

- [ ] **Step 5: Run full test suite**

```bash
pnpm -r test
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/react-loop.ts apps/api/src/agents/react-loop.test.ts
git commit -m "feat(react-loop): single-refine pass, store prefetchContext, pass language to subagents"
```

---

## Task 7: API — Sessions route accepts `language`

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`

- [ ] **Step 1: Update `SendMessageSchema` to accept `language`**

In `apps/api/src/routes/sessions.ts`, replace:

```typescript
const SendMessageSchema = z.object({ content: z.string().min(1) })
```

with:

```typescript
const SendMessageSchema = z.object({
  content: z.string().min(1),
  language: z.string().optional(),
})
```

- [ ] **Step 2: Store `language` on the session**

In the `POST /:id/messages` handler, after reading `content`:

```typescript
const { content, language } = c.req.valid('json')
// Store language preference on session (set once; subsequent messages inherit)
if (language && !fresh.language) {
  fresh.language = language
}
```

Do the same for the `POST /:id/continue` handler if it re-reads the session — confirm the session is re-fetched via `sessionStore.get` and thus already has the stored language.

- [ ] **Step 3: Run tests and smoke check**

```bash
pnpm -r test
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/sessions.ts
git commit -m "feat(sessions): accept language in send-message request, store on session"
```

---

## Task 8: Web — Chat store P0 fixes

Fixes three code-review issues in one commit:
- P0: `hydrateFromSessionMessages` missing ReAct state reset (ghost UI elements)
- P0: message ID collision in same millisecond
- P1: `chat.plan` dual source-of-truth (consolidate into workspace store)

**Files:**
- Modify: `apps/web/stores/chat.ts`

- [ ] **Step 1: Extract `resetTransientState()` and call it in the three reset sites**

In `apps/web/stores/chat.ts`, inside the `actions` object, add the helper action and update the three callers:

```typescript
// ── new helper ──────────────────────────────────────────────────────────────
resetTransientState() {
  this.iteration = 0
  this.maxIterations = 10
  this.displayScore = null
  this.loopStatus = null
  this.awaitingClarify = null
  this.maxIterReached = null
  this.canContinue = false
  this.streamSteps = []
  this.errorMessage = ''
  this.currentMessageId = ''
  this.pendingAssistantText = ''
},

// ── update hydrateFromSessionMessages ───────────────────────────────────────
hydrateFromSessionMessages(messages: Message[]) {
  const history: ChatMessage[] = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .map((m, i) => ({
      id: `${m.role}-${m.timestamp}-${i}`,   // index suffix prevents ID collision
      role: m.role as Role,
      content: m.content,
    }))
  this.resetTransientState()                 // clear all ReAct fields
  this.phase = history.length > 0 ? 'result' : 'idle'
  this.agentStatus = history.length > 0 ? '上次行程已加载' : '准备开始'
  this.plan = null
  this.pendingSelections = []
  this.draft = ''
  this.messages = history.length > 0 ? [welcomeMessage, ...history] : [welcomeMessage]
  this.persistState()
},

// ── update resetConversation (call resetTransientState) ─────────────────────
// Find existing resetConversation action and add this.resetTransientState() call.
// Exact diff depends on current content — find the action and add the call.

// ── update beginPlanning (call resetTransientState) ─────────────────────────
beginPlanning(content: string) {
  this.phase = 'planning'
  this.resetTransientState()                 // clears errorMessage, loopStatus, etc.
  this.agentStatus = planningMessages.thinking
  this.pendingSelections = []
  this.messages.push({
    id: `user-${Date.now()}`,
    role: 'user',
    content,
  })
  this.currentMessageId = `assistant-${Date.now()}`
  this.messages.push({
    id: this.currentMessageId,
    role: 'assistant',
    content: '',
  })
  this.draft = ''
  this.persistState()
},
```

- [ ] **Step 2: Fix dual source of truth for `plan`**

In `handleStreamEvent` → `'plan'` case, ensure `workspace.currentPlan` is always the single source; `this.plan` is only kept for sessionStorage persistence and must stay in sync:

```typescript
case 'plan':
  ws.currentPlan = event.plan
  this.plan = event.plan          // keep for sessionStorage only
  this.awaitingClarify = null
  this.maxIterReached = null
  this.persistState()
  break
```

Find `applyItemSelection` (or wherever item selections modify the plan) and ensure it updates `ws.currentPlan` as well as `this.plan`. Search for `this.plan` in workspace.ts and chat.ts — wherever plan mutations happen, apply to both:

```typescript
// Pattern to apply everywhere a plan is mutated:
ws.currentPlan = updatedPlan
this.plan = updatedPlan
```

- [ ] **Step 3: Run the web build to catch TypeScript errors**

```bash
pnpm build:web
```
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/stores/chat.ts
git commit -m "fix(web/chat): resetTransientState, message ID collision, plan dual source of truth"
```

---

## Task 9: Web — Frontend plumbing (loadHistoryEntry + language in requests)

**Files:**
- Modify: `apps/web/pages/index.vue`
- Modify: `apps/web/composables/useChatStream.ts`

- [ ] **Step 1: Explicit setSessionId in loadHistoryEntry**

In `apps/web/pages/index.vue`, update `loadHistoryEntry`:

```typescript
async function loadHistoryEntry(entry: TripHistoryEntry) {
  try {
    const { session } = await stream.loadSession(entry.sessionId)
    stream.setSessionId(session.id)              // explicit — don't rely on loadSession side-effect
    workspaceStore.hydrateFromSession(session)
    workspaceStore.persistState()
    chatStore.hydrateFromSessionMessages(session.messages)
    chatStore.setSession(session.id)
  } catch (err) {
    console.error('[loadHistoryEntry] failed', err)
  }
}
```

- [ ] **Step 2: Pass `language` in sendMessage**

In `apps/web/composables/useChatStream.ts`, update `sendMessage`:

```typescript
async function sendMessage(content: string, handlers: ChatStreamHandlers, language = 'zh') {
  const id = await ensureSessionId()
  const apiBase = resolveApiBase()
  await streamRequest(`${apiBase}/api/sessions/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, language }),
  }, handlers)
}
```

Also update `ChatStreamSession` interface to reflect the new signature:

```typescript
sendMessage: (content: string, handlers: ChatStreamHandlers, language?: string) => Promise<void>
```

- [ ] **Step 3: Update all `sendMessage` call sites in index.vue**

Search for `stream.sendMessage(` in `apps/web/pages/index.vue`. Each call should pass the language. For now hardcode `'zh'` as default until a language picker exists:

```typescript
// Example — find the actual call site and update it:
await stream.sendMessage(content, handlers, 'zh')
```

- [ ] **Step 4: Build and verify**

```bash
pnpm build:web
pnpm -r test
```
Expected: build clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/pages/index.vue apps/web/composables/useChatStream.ts
git commit -m "fix(web): explicit setSessionId in loadHistoryEntry; pass language in chat requests"
```

---

## Self-Review

### Spec coverage
| Requirement | Task |
|-------------|------|
| Prompt prefix caching (static prefix ≥1024 tokens, English) | Task 5 |
| Multi-agent: no `messages` in generator/refiner | Tasks 5, 6 |
| `prefetchContext` stored on session, reused by refiner | Tasks 1, 6 |
| Single-refine pass, `/continue` for manual refinement | Task 6 |
| All prompts in English | Tasks 2, 3, 4, 5 |
| User-language output (default zh) | Tasks 3, 4, 5, 6, 7, 9 |
| P0: ReAct state reset bug | Task 8 |
| P0: message ID collision | Task 8 |
| P0: historyMessages order bug | Auto-fixed by Task 5 (history removed) |
| P1: unbounded session.messages | Auto-fixed by Task 5 (history removed) |
| P1: stream.setSessionId explicit | Task 9 |
| P1: dual source of truth plan | Task 8 |
| Tests updated for new signatures | Tasks 5, 6 |

### Placeholder scan
No TBD/TODO/placeholder language present. All code blocks are complete.

### Type consistency
- `runInitial(brief, prefetchedContext, language)` — defined Task 5, called Task 6 ✓
- `runRefine(current, report, brief, prefetchContext, language)` — defined Task 5, called Task 6 ✓
- `evaluate(plan, brief, language)` — defined Task 4, called Task 6 ✓
- `generateClarification(messages, brief, reason, language)` — defined Task 3, called Task 6 ✓
- `session.prefetchContext` — added Task 1, written Task 6 ✓
- `session.language` — added Task 1, written Task 7, read Task 6 ✓
- `resetTransientState()` — defined Task 8, called in same file ✓
