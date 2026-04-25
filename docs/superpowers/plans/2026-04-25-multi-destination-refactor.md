# Multi-Destination Brief Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `destination: string` with `destinations: string[]` throughout the stack. Prefetch queries every cross-city transport leg (flight + train) and every city's hotel/POI. Existing persisted sessions migrate transparently via Zod preprocess.

**Architecture:** A `z.preprocess` wrapper in both `brief.ts` and `plan.ts` auto-upgrades legacy `{ destination: "X" }` objects to `{ destinations: ["X"] }` on parse. All downstream consumers (extractor, react-loop guard, prefetch, generator, frontend) update accordingly.

**Tech Stack:** Zod preprocess, TypeScript, Vitest, Vue 3 / Nuxt 3

---

## File Map

| Action | File | Change |
|---|---|---|
| Modify | `packages/shared/src/brief.ts` | `destination` → `destinations[]` with preprocess migration |
| Modify | `packages/shared/src/plan.ts` | Same |
| Modify | `apps/api/src/agents/extractor.ts` | Prompt + regex + merge logic |
| Modify | `apps/api/src/agents/react-loop.ts` | Guard check |
| Modify | `apps/api/src/agents/prefetch.ts` | Leg-based queries + `offsetDate` helper |
| Modify | `apps/api/src/agents/generator.ts` | System prompt + `normalizePlanJson` |
| Modify | `apps/api/src/agents/extractor.test.ts` | `destination` → `destinations` in mocks |
| Modify | `apps/api/src/agents/critic.test.ts` | Same |
| Modify | `apps/web/composables/useTripHistory.ts` | Read `destinations[]` |
| Modify | `apps/web/pages/index.vue` | Breadcrumb from `destinations.join(' / ')` |

---

### Task 1: Update `packages/shared/src/brief.ts`

**Files:**
- Modify: `packages/shared/src/brief.ts`

- [ ] **Step 1: Replace the entire file**

```ts
import { z } from 'zod'

const rawBriefShape = z.object({
  destinations: z.array(z.string()).min(1).default([]),
  originCity: z.string().optional(),
  days: z.number().int().nonnegative(),
  travelers: z.number().int().positive().default(1),
  travelDates: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  budget: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().default('CNY'),
  }).optional(),
  preferences: z.array(z.string()).default([]),
  pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
  notes: z.string().optional(),
})

export const TripBriefSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (typeof r.destination === 'string' && !Array.isArray(r.destinations)) {
      r.destinations = [r.destination]
      delete r.destination
    }
  }
  return raw
}, rawBriefShape)

export type TripBrief = z.infer<typeof rawBriefShape>

export function isBriefMinimallyComplete(b: Partial<TripBrief>): boolean {
  return (b.destinations?.length ?? 0) > 0 && !!b.days && b.days > 0
}

export function mergeBrief(prev: TripBrief, patch: Partial<TripBrief>): TripBrief {
  return TripBriefSchema.parse({ ...prev, ...patch }) as TripBrief
}
```

- [ ] **Step 2: Build the shared package**

```bash
cd packages/shared && pnpm build 2>&1 | head -30
```

Expected: no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/brief.ts
git commit -m "feat(shared): destination → destinations[] with preprocess legacy migration"
```

---

### Task 2: Update `packages/shared/src/plan.ts`

**Files:**
- Modify: `packages/shared/src/plan.ts`

- [ ] **Step 1: Replace `destination` with `destinations[]` and add preprocess**

Replace the `PlanSchema` definition. Change:

```ts
export const PlanSchema = z.object({
  title: z.string(),
  destination: z.string(),
  // ...
})
```

to:

```ts
const rawPlanShape = z.object({
  title: z.string(),
  destinations: z.array(z.string()).min(1).default([]),
  originCity: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  days: z.number(),
  travelers: z.number().default(1),
  pace: z.enum(['relaxed', 'balanced', 'packed']).default('balanced'),
  preferences: z.array(z.string()).default([]),
  dailyPlans: z.array(DailyPlanSchema),
  estimatedBudget: EstimatedBudgetSchema.optional(),
  tips: z.array(z.string()).default([]),
  disclaimer: z.string().default('本行程由 AI 生成，仅供参考。出行前请通过官方渠道核对最新信息。'),
})

export const PlanSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (typeof r.destination === 'string' && !Array.isArray(r.destinations)) {
      r.destinations = [r.destination]
      delete r.destination
    }
  }
  return raw
}, rawPlanShape)

export type PlanItem = z.infer<typeof PlanItemSchema>
export type DailyPlan = z.infer<typeof DailyPlanSchema>
export type EstimatedBudget = z.infer<typeof EstimatedBudgetSchema>
export type Plan = z.infer<typeof rawPlanShape>
```

- [ ] **Step 2: Build shared package**

```bash
cd packages/shared && pnpm build 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/plan.ts
git commit -m "feat(shared): plan.destination → destinations[] with preprocess migration"
```

---

### Task 3: Update `extractor.ts` — prompt + regex + merge

**Files:**
- Modify: `apps/api/src/agents/extractor.ts`

- [ ] **Step 1: Update `ExtractorOutputSchema` brief shape**

The extractor calls `TripBriefSchema.parse(briefCandidate)` at the end. `TripBriefSchema` now expects `destinations`. Update the schema reference in `briefCandidate` merge.

In the `SYSTEM_PROMPT`, find the line that shows the brief JSON shape and replace the destination field:

```
// before (in SYSTEM_PROMPT string):
    "destination": "...", "days": 数字, "originCity": "...",
// after:
    "destinations": ["目的地1", "目的地2"],  // 按游览顺序，多城行程输出多个
    "days": 数字, "originCity": "...",
```

- [ ] **Step 2: Update `regexFallback` to collect all destinations**

Replace the destination regex section in `regexFallback`:

```ts
// before:
  for (const re of DESTINATION_REGEXES) {
    const m = text.match(re)
    if (m) { out.destination = m[1]; break }
  }
```
```ts
// after:
  const foundDests: string[] = []
  for (const re of DESTINATION_REGEXES) {
    const globalRe = new RegExp(re.source, re.flags + 'g')
    for (const m of text.matchAll(globalRe)) {
      if (m[1] && !foundDests.includes(m[1])) foundDests.push(m[1])
    }
  }
  if (foundDests.length > 0) out.destinations = foundDests
```

Update the return type: change `out: Partial<TripBrief>` — `TripBrief` now has `destinations`. TypeScript will show an error on `out.destination` (legacy field) if any remains; remove it.

- [ ] **Step 3: Update `briefCandidate` merge block**

Replace lines ~105–113:

```ts
// before:
  const briefCandidate = {
    ...(existingBrief ?? {}),
    ...fallback,
    ...parsed.brief,
    travelers: parsed.brief.travelers ?? fallback.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destination: parsed.brief.destination ?? fallback.destination ?? existingBrief?.destination ?? '',
    days: parsed.brief.days ?? fallback.days ?? existingBrief?.days ?? 0,
  }
```
```ts
// after:
  const briefCandidate = {
    ...(existingBrief ?? {}),
    ...fallback,
    ...parsed.brief,
    travelers: parsed.brief.travelers ?? fallback.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destinations: parsed.brief.destinations ?? fallback.destinations ?? existingBrief?.destinations ?? [],
    days: parsed.brief.days ?? fallback.days ?? existingBrief?.days ?? 0,
  }
```

- [ ] **Step 4: Update the log line**

```ts
// before:
  console.log(`[Extractor] brief=${JSON.stringify(brief)} intent=${parsed.intent} changed=${JSON.stringify(parsed.changedFields)}`)
```
```ts
// after:
  console.log(`[Extractor] brief.destinations=${JSON.stringify(brief.destinations)} days=${brief.days} intent=${parsed.intent} changed=${JSON.stringify(parsed.changedFields)}`)
```

- [ ] **Step 5: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/extractor.ts
git commit -m "feat(extractor): emit destinations[] from regex and LLM merge"
```

---

### Task 4: Update `react-loop.ts` guard

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts`

- [ ] **Step 1: Replace the incomplete brief check**

Find lines ~33–43 in `react-loop.ts`:

```ts
// before:
  if (!isBriefMinimallyComplete(ext.brief)) {
    session.status = 'awaiting_user'
    session.pendingClarification = !ext.brief.destination
      ? '请告诉我目的地是哪里？'
      : '请告诉我打算玩几天？'
    yield {
      type: 'clarify_needed',
      question: session.pendingClarification,
      reason: !ext.brief.destination ? 'missing_destination' : 'missing_days',
    }
    return
  }
```
```ts
// after:
  if (!isBriefMinimallyComplete(ext.brief)) {
    const missingDest = !ext.brief.destinations?.length
    const question = missingDest ? '请告诉我目的地是哪里？' : '请告诉我打算玩几天？'
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield {
      type: 'clarify_needed',
      question,
      reason: missingDest ? 'missing_destination' : 'missing_days',
    }
    return
  }
```

- [ ] **Step 2: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/agents/react-loop.ts
git commit -m "feat(react-loop): update guard to check destinations.length"
```

---

### Task 5: Update `prefetch.ts` — leg-based queries

**Files:**
- Modify: `apps/api/src/agents/prefetch.ts`

- [ ] **Step 1: Update `hashBrief`**

Replace the `hashBrief` function:

```ts
// before:
function hashBrief(brief: TripBrief): string {
  const subset = {
    destination: brief.destination,
    days: brief.days,
    originCity: brief.originCity ?? null,
    travelers: brief.travelers ?? null,
    travelDates: brief.travelDates ?? null,
  }
  return createHash('sha1').update(JSON.stringify(subset)).digest('hex').slice(0, 12)
}
```
```ts
// after:
function hashBrief(brief: TripBrief): string {
  const subset = {
    destinations: brief.destinations,
    days: brief.days,
    originCity: brief.originCity ?? null,
    travelers: brief.travelers ?? null,
    travelDates: brief.travelDates ?? null,
  }
  return createHash('sha1').update(JSON.stringify(subset)).digest('hex').slice(0, 12)
}
```

- [ ] **Step 2: Add `offsetDate` helper after `formatDate`**

```ts
function offsetDate(startStr: string, n: number): string {
  const d = new Date(startStr)
  d.setDate(d.getDate() + n)
  return formatDate(d)
}
```

- [ ] **Step 3: Replace `prefetchFlyaiContext` body**

Replace everything inside `prefetchFlyaiContext` from `const dates = ...` to the final `console.log(...)`:

```ts
  const dates = brief.travelDates ?? defaultDateRange(brief.days || 3)
  const totalDays = brief.days || 3
  const cities = brief.destinations
  const origin = brief.originCity ?? null

  const tasks: Array<Promise<string | null>> = []

  // Build transport legs
  const legs: Array<{ from: string; to: string; depOffset: number }> = []
  if (origin && cities.length > 0) {
    legs.push({ from: origin, to: cities[0], depOffset: 0 })
  }
  for (let i = 0; i < cities.length - 1; i++) {
    const offset = Math.round(totalDays * (i + 1) / cities.length)
    legs.push({ from: cities[i], to: cities[i + 1], depOffset: offset })
  }
  if (origin && cities.length > 0) {
    legs.push({ from: cities[cities.length - 1], to: origin, depOffset: totalDays - 1 })
  }

  // Flight + train for each leg
  for (const leg of legs) {
    const depDate = offsetDate(dates.start, leg.depOffset)
    tasks.push(tryInvoke({ command: 'search-flight', origin: leg.from, destination: leg.to, depDate }, '航班'))
    tasks.push(tryInvoke({ command: 'search-train',  origin: leg.from, destination: leg.to, depDate }, '火车'))
  }

  // Hotel + POI for each destination city
  for (const city of cities) {
    tasks.push(tryInvoke({ command: 'search-hotel', destName: city, checkInDate: dates.start, checkOutDate: dates.end }, '酒店'))
    tasks.push(tryInvoke({ command: 'search-poi',   cityName: city }, '景点'))
  }

  const results = await Promise.all(tasks)
  const ctx = results.filter((r): r is string => r !== null)
  cache.set(key, ctx)
  console.log(`[Prefetch] gathered ${ctx.length}/${tasks.length} entries for session=${sessionId} cities=${cities.join(',')}/${totalDays}d`)
  return ctx
```

- [ ] **Step 4: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/prefetch.ts
git commit -m "feat(prefetch): leg-based transport queries for multi-destination trips"
```

---

### Task 6: Update `generator.ts` — system prompt + normalizePlanJson

**Files:**
- Modify: `apps/api/src/agents/generator.ts`

- [ ] **Step 1: Update `SYSTEM_PROMPT_INITIAL`**

Find the transport instruction line:
```
- 必须包含：跨城出行的交通项（含真实航班号/车次和价格，从 flyai 数据中挑选）
```

Replace with:
```
- 必须包含：destinations 中每对相邻城市（含出发地↔第一城、末城↔出发地）的交通项。从 flyai 给出的机票和火车数据中各挑最优（考虑时长×票价），description 写：推荐方案（航班号/车次、起止站、时长、票价）并附一行"备选：XX 方案（XX 元/XX 小时）"。
- destinations 长度 > 1 时按游览顺序串联城市，每次换城在当天最后插一个 transport item。
```

Find the JSON schema line:
```
- 顶层字段：title, destination, days, travelers, pace, dailyPlans, estimatedBudget, tips, disclaimer
```

Replace with:
```
- 顶层字段：title, destinations（数组）, days, travelers, pace, dailyPlans, estimatedBudget, tips, disclaimer
```

- [ ] **Step 2: Update `normalizePlanJson` — remove `destination` string handling**

In `normalizePlanJson`, find any line that sets `obj.destination` as a string. Remove it. The `PlanSchema` preprocess now handles legacy `destination` → `destinations` migration, so no manual normalization is needed for that field.

Specifically, if there is a line like:
```ts
if (typeof obj.destination !== 'string') obj.destination = ''
```
Remove it entirely.

- [ ] **Step 3: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/generator.ts
git commit -m "feat(generator): multi-city system prompt + remove destination string normalization"
```

---

### Task 7: Fix test files (mechanical)

**Files:**
- Modify: `apps/api/src/agents/extractor.test.ts`
- Modify: `apps/api/src/agents/critic.test.ts`

- [ ] **Step 1: Update `extractor.test.ts`**

The mock LLM now returns `destinations` not `destination`. Update:

```ts
// Test 1 mock response:
// before:
        brief: { destination: '北京', days: 3, travelers: 2 },
// after:
        brief: { destinations: ['北京'], days: 3, travelers: 2 },
```

```ts
// Assertion:
// before:
    expect(res.brief.destination).toBe('北京')
// after:
    expect(res.brief.destinations[0]).toBe('北京')
```

```ts
// Test 2 mock response:
// before:
        brief: { destination: '北京', days: 3, originCity: '上海' },
// after:
        brief: { destinations: ['北京'], days: 3, originCity: '上海' },
```

```ts
// Test 2 existing brief arg:
// before:
      { destination: '北京', days: 3, travelers: 1, preferences: [] },
// after:
      { destinations: ['北京'], days: 3, travelers: 1, preferences: [] },
```

- [ ] **Step 2: Update `critic.test.ts`**

The `samplePlan` uses `destination`:

```ts
// before:
const samplePlan: Plan = {
  title: 'Beijing 3D', destination: '北京', days: 3, travelers: 1,
```
```ts
// after:
const samplePlan: Plan = {
  title: 'Beijing 3D', destinations: ['北京'], days: 3, travelers: 1,
```

The brief arg in test calls:
```ts
// before:
    const r = await criticReview(samplePlan, { destination: '北京', days: 3, travelers: 1, preferences: [] })
// after:
    const r = await criticReview(samplePlan, { destinations: ['北京'], days: 3, travelers: 1, preferences: [] })
```
(Both test calls need this update.)

- [ ] **Step 3: Run tests**

```bash
cd /Users/bill/travel-agent && pnpm -r test --run
```

Expected: all suites PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/extractor.test.ts apps/api/src/agents/critic.test.ts
git commit -m "test: update destination → destinations[] in all test fixtures"
```

---

### Task 8: Update frontend

**Files:**
- Modify: `apps/web/composables/useTripHistory.ts`
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Update `useTripHistory.ts` — `entryFromSession`**

Replace line ~58 in `entryFromSession`:

```ts
// before:
  const destination = brief?.destination || plan?.destination || ""
```
```ts
// after:
  const dests: string[] = brief?.destinations ?? plan?.destinations ?? []
  const destination = dests.length > 1 ? dests.join(' / ') : (dests[0] ?? '')
```

Replace line ~70:

```ts
// before:
  if (destination) cities.add(destination)
```
```ts
// after:
  ;(brief?.destinations ?? plan?.destinations ?? []).forEach((d) => { if (d) cities.add(d) })
```

- [ ] **Step 2: Update `index.vue` — breadcrumb**

Find line ~76:

```ts
// before:
const breadcrumbDestination = computed(() => currentPlan.value?.destination || "")
```
```ts
// after:
const breadcrumbDestination = computed(() =>
  (currentPlan.value?.destinations ?? []).join(' / ') || ''
)
```

- [ ] **Step 3: Build web**

```bash
cd /Users/bill/travel-agent && pnpm build:web 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript errors

- [ ] **Step 4: Final commit**

```bash
git add apps/web/composables/useTripHistory.ts apps/web/pages/index.vue
git commit -m "feat(web): read destinations[] for breadcrumb and trip history entries"
```

---

### Task 9: Smoke verification

- [ ] **Step 1: Start dev stack**

```bash
cd /Users/bill/travel-agent && pnpm dev
```

- [ ] **Step 2: Send a multi-city message**

In the browser, send: `我想从北京出发，先去顺德玩3天再去珠海2天`

- [ ] **Step 3: Verify API log output**

Check terminal for:
```
[Extractor] brief.destinations=["顺德","珠海"] days=5
[Prefetch] gathered X/Y entries for session=... cities=顺德,珠海/5d
```

Confirm prefetch log shows multiple entries (at minimum hotel+POI for each city).

- [ ] **Step 4: Verify plan output**

In the browser plan panel, the breadcrumb should show `顺德 / 珠海`.
Transport items in the plan should reference both 顺德 and 珠海 legs.
