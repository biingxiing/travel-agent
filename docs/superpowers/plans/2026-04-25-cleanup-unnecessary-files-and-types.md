# Cleanup: Unnecessary Files and Duplicate Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead code and eliminate the duplicate local `Plan`/`PlanItem` types in `apps/web` that shadow the canonical types in `@travel-agent/shared`, causing `as unknown as` type-cast bridges throughout the codebase.

**Architecture:** Delete three dead artifacts (one unused shared schema file, two empty dirs), then slim `apps/web/types/itinerary.ts` down to only the web-UI-specific types it actually owns (`Role`, `ChatMessage`), and update the four consumers to import `Plan`/`ItemSelection`/`ItemOption` directly from `@travel-agent/shared`. Finally remove all `as unknown as Plan` / `as never` / `as Plan` cast bridges that only existed because of the type mismatch.

**Tech Stack:** TypeScript, Nuxt 3, Pinia, Zod (`@travel-agent/shared` schemas), Vitest

---

## File Map

| Action | File | Reason |
|---|---|---|
| **Delete** | `packages/shared/src/itinerary.ts` | Not in `index.ts`, superseded by `plan.ts` |
| **Delete** | `apps/api/src/skills/` (empty dir) | No content, reserved namespace but git ignores empty dirs |
| **Delete** | `apps/api/src/types/` (empty dir) | Same |
| **Modify** | `apps/web/types/itinerary.ts` | Strip Plan/DailyPlan/PlanItem/EstimatedBudget/ItemOption/ItemSelection, keep Role + ChatMessage |
| **Modify** | `apps/web/stores/chat.ts` | Import Plan/ItemOption/ItemSelection from shared; remove `item.desc` compat write |
| **Modify** | `apps/web/utils/scoring.ts` | Import Plan from shared; delete dead `scorePlanCompat`; fix `buildItemScoreMap` param type |
| **Modify** | `apps/web/components/ItemSelector.vue` | Import ItemSelection from shared |
| **Modify** | `apps/web/components/PlanningPreview.vue` | Remove `as unknown as Plan` and `as never` casts |

---

### Task 1: Delete `packages/shared/src/itinerary.ts` and empty API dirs

**Files:**
- Delete: `packages/shared/src/itinerary.ts`
- Delete: `apps/api/src/skills/` (empty dir)
- Delete: `apps/api/src/types/` (empty dir)

- [ ] **Step 1: Delete the three dead artifacts**

```bash
rm packages/shared/src/itinerary.ts
rmdir apps/api/src/skills apps/api/src/types
```

- [ ] **Step 2: Verify shared package still builds**

```bash
pnpm --filter @travel-agent/shared exec tsc --noEmit
```

Expected: no errors (itinerary.ts was never exported; removing it changes nothing).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete dead shared/itinerary.ts and empty API placeholder dirs"
```

---

### Task 2: Slim `apps/web/types/itinerary.ts` to web-UI types only

**Files:**
- Modify: `apps/web/types/itinerary.ts`

- [ ] **Step 1: Replace the file with only the web-UI types**

Replace the entire content of `apps/web/types/itinerary.ts` with:

```typescript
export type Role = "assistant" | "user" | "system"

export interface ChatMessage {
  id: string
  role: Role
  content: string
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/types/itinerary.ts
git commit -m "chore(web): strip duplicate types from types/itinerary.ts, keep only ChatMessage/Role"
```

---

### Task 3: Update `apps/web/stores/chat.ts`

**Files:**
- Modify: `apps/web/stores/chat.ts`

- [ ] **Step 1: Fix the import block at the top of `apps/web/stores/chat.ts`**

Replace:
```typescript
import type { ChatStreamEvent, ItineraryScoreSummary, Message } from "@travel-agent/shared"
import type { ChatMessage, ItemOption, ItemSelection, Plan, Role } from "~/types/itinerary"
```

With:
```typescript
import type { ChatStreamEvent, ItineraryScoreSummary, Message, Plan, ItemOption, ItemSelection } from "@travel-agent/shared"
import type { ChatMessage, Role } from "~/types/itinerary"
```

- [ ] **Step 2: Remove the `as Plan` cast in the `plan_partial` handler**

Find in `handleStreamEvent`, the `plan_partial` case:
```typescript
case 'plan_partial':
  if (event.plan) {
    ws.currentPlan = event.plan as Plan
  }
  break
```

Replace with:
```typescript
case 'plan_partial':
  if (event.plan) {
    ws.currentPlan = event.plan
  }
  break
```

- [ ] **Step 3: Remove the legacy `item.desc` write in `applyItemSelection`**

Find:
```typescript
if (option.patch.description) {
  item.description = option.patch.description
  item.desc = option.patch.description
}
```

Replace with:
```typescript
if (option.patch.description) {
  item.description = option.patch.description
}
```

- [ ] **Step 4: Type-check the file**

```bash
pnpm --filter @travel-agent/web exec tsc --noEmit
```

Expected: no new errors in `stores/chat.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/stores/chat.ts
git commit -m "fix(web/store): import Plan/ItemOption/ItemSelection from shared, remove desc compat shim"
```

---

### Task 4: Update `apps/web/utils/scoring.ts`

**Files:**
- Modify: `apps/web/utils/scoring.ts`

- [ ] **Step 1: Replace the entire file content**

```typescript
export {
  scorePlan, gradeFromScore, isConverged,
  REQUIRED_CATEGORIES, DEFAULT_THRESHOLD,
} from '@travel-agent/shared'
export type {
  Grade, ScoreCheck, ItemScore, CategoryScore, CoverageScore, ItineraryScore,
} from '@travel-agent/shared'

import type { Grade, ItemScore, ItineraryScore, Plan } from '@travel-agent/shared'

export function gradeColor(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '#10b981', good: '#6366f1', fair: '#f59e0b',
    poor: '#ef4444', none: '#d1d5db',
  }
  return map[g]
}

export function gradeLabel(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '优秀', good: '良好', fair: '一般', poor: '欠缺', none: 'N/A',
  }
  return map[g]
}

// Returns a map keyed by "${day.day}-${itemIndex}" → ItemScore
export function buildItemScoreMap(plan: Plan, score: ItineraryScore): Map<string, ItemScore> {
  const map = new Map<string, ItemScore>()

  const byKey = new Map<string, ItemScore>()
  for (const scored of [
    ...score.transport.items,
    ...score.lodging.items,
    ...score.attraction.items,
    ...score.meal.items,
  ]) {
    byKey.set(`${scored.type}::${scored.title}`, scored)
  }

  for (const day of plan.dailyPlans) {
    day.items.forEach((item, idx) => {
      const found = byKey.get(`${item.type}::${item.title}`)
      if (found) map.set(`${day.day}-${idx}`, found)
    })
  }
  return map
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @travel-agent/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/utils/scoring.ts
git commit -m "fix(web/scoring): use shared Plan type, remove dead scorePlanCompat bridge"
```

---

### Task 5: Update `apps/web/components/ItemSelector.vue`

**Files:**
- Modify: `apps/web/components/ItemSelector.vue`

- [ ] **Step 1: Fix the import**

In `apps/web/components/ItemSelector.vue`, replace:
```typescript
import type { ItemSelection } from "~/types/itinerary"
```

With:
```typescript
import type { ItemSelection } from "@travel-agent/shared"
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/ItemSelector.vue
git commit -m "fix(web): import ItemSelection from shared in ItemSelector"
```

---

### Task 6: Remove cast bridges in `apps/web/components/PlanningPreview.vue`

**Files:**
- Modify: `apps/web/components/PlanningPreview.vue`

- [ ] **Step 1: Remove the `as unknown as Plan` cast from the `scorePlan` call**

Find (around line 92-93 in the `<script setup>` section):
```typescript
const itineraryScore = computed<ItineraryScore | null>(() =>
  currentPlan.value ? scorePlan(currentPlan.value as unknown as Plan) : null,
)
```

Replace with:
```typescript
const itineraryScore = computed<ItineraryScore | null>(() =>
  currentPlan.value ? scorePlan(currentPlan.value) : null,
)
```

- [ ] **Step 2: Remove the `as never` cast from the `buildItemScoreMap` call**

Find (around line 97-98):
```typescript
  if (!currentPlan.value || !itineraryScore.value) return new Map()
  return buildItemScoreMap(currentPlan.value as never, itineraryScore.value)
```

Replace with:
```typescript
  if (!currentPlan.value || !itineraryScore.value) return new Map()
  return buildItemScoreMap(currentPlan.value, itineraryScore.value)
```

- [ ] **Step 3: Type-check and run tests**

```bash
pnpm --filter @travel-agent/web exec tsc --noEmit
pnpm -r test
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/PlanningPreview.vue
git commit -m "fix(web): remove as-unknown-as-Plan and as-never cast bridges in PlanningPreview"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full type-check across all packages**

```bash
pnpm -r exec tsc --noEmit 2>&1 | head -50
```

Expected: zero errors.

- [ ] **Step 2: Full test suite**

```bash
pnpm -r test
```

Expected: all tests pass.

- [ ] **Step 3: Confirm no remaining references to the removed types**

```bash
grep -r "ItinerarySchema\|ItineraryItem\b\|from.*types/itinerary.*Plan\|from.*types/itinerary.*DailyPlan\|scorePlanCompat\|item\.desc\b" \
  apps/ packages/ --include="*.ts" --include="*.vue" | grep -v node_modules | grep -v ".nuxt"
```

Expected: no output.
