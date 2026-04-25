# Multi-Destination Brief Refactor — Design Spec

**Date:** 2026-04-25
**Scope:** `packages/shared`, `apps/api`, `apps/web`
**Status:** Approved

---

## Problem

`TripBrief` currently holds a single `destination: string`. Users asking for multi-city trips (e.g. "先去顺德再去珠海") get only one city stored; prefetch queries that one city for hotels/POI and one flight leg, producing itineraries with no concrete data for subsequent cities.

**Fix:** Replace `destination` with `destinations: string[]` throughout, with a backward-compatible Zod preprocess migration for existing persisted sessions. Make prefetch query every cross-city transport leg (flight + train) plus every destination's hotels/POI.

---

## Architecture

### Data flow change

```
before:  extractor → { destination: "顺德" }         → prefetch: 1 hotel, 1 POI, 1 flight leg
after:   extractor → { destinations: ["顺德","珠海"] } → prefetch: 2×hotel, 2×POI, 3×(flight+train) legs
```

Legs computed as: `[origin→city0, city0→city1, …, cityN-1→origin(return)]`

---

## File-by-File Changes

### 1. `packages/shared/src/brief.ts`

Replace `destination: z.string()` with `destinations: z.array(z.string()).min(1)` under a `z.preprocess` wrapper that upgrades legacy `{ destination: "X" }` rows:

```ts
const rawBriefShape = z.object({
  destinations: z.array(z.string()).min(1),
  // ... other fields unchanged
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
```

Update `isBriefMinimallyComplete`:
```ts
return (b.destinations?.length ?? 0) > 0 && !!b.days && b.days > 0
```

### 2. `packages/shared/src/plan.ts`

Same preprocess pattern: `destination: z.string()` → `destinations: z.array(z.string()).min(1)` with the same legacy migration. `normalizePlanJson` in `generator.ts` must stop touching `plan.destination` and leave `destinations` alone.

### 3. `apps/api/src/agents/extractor.ts`

**System prompt** — change brief JSON schema section:
```
"destinations": ["目的地1", "目的地2"],  // 按游览顺序，多城行程输出多个
```

**`regexFallback`** — collect all `DESTINATION_REGEX` matches (remove `break`), deduplicate in order, assign `out.destinations = matches`.

**`briefCandidate` merge** (line ~105–113):
```ts
destinations: parsed.brief.destinations
  ?? (fallback.destinations as string[] | undefined)
  ?? existingBrief?.destinations
  ?? [],
```
Remove the `destination` line entirely.

### 4. `apps/api/src/agents/react-loop.ts`

Replace the incompleteness guard (~line 35):
```ts
if (!ext.brief.destinations || ext.brief.destinations.length === 0) {
```

### 5. `apps/api/src/agents/prefetch.ts`

**`hashBrief`** — include full `destinations` array instead of `destination`.

**`prefetchFlyaiContext`** — build legs and per-city tasks:

```ts
const cities = brief.destinations        // visit order
const origin = brief.originCity ?? null

// Cross-city transport legs
const legs: { from: string; to: string; depOffset: number }[] = []
if (origin) legs.push({ from: origin, to: cities[0], depOffset: 0 })
for (let i = 0; i < cities.length - 1; i++) {
  const offset = Math.round((totalDays) * (i + 1) / cities.length)
  legs.push({ from: cities[i], to: cities[i + 1], depOffset: offset })
}
if (origin && cities.length > 0) {
  legs.push({ from: cities[cities.length - 1], to: origin, depOffset: totalDays - 1 })
}

// Each leg: parallel flight + train
for (const leg of legs) {
  const depDate = offsetDate(dates.start, leg.depOffset)
  tasks.push(tryInvoke({ command: 'search-flight', origin: leg.from, destination: leg.to, depDate }, '航班'))
  tasks.push(tryInvoke({ command: 'search-train',  origin: leg.from, destination: leg.to, depDate }, '火车'))
}

// Each destination: hotel + POI
for (const city of cities) {
  tasks.push(tryInvoke({ command: 'search-hotel', destName: city, checkInDate: dates.start, checkOutDate: dates.end }, '酒店'))
  tasks.push(tryInvoke({ command: 'search-poi',   cityName: city }, '景点'))
}
```

Add helper `offsetDate(startStr: string, n: number): string` — returns `startStr + n days` as `YYYY-MM-DD`.

### 6. `apps/api/src/agents/generator.ts`

**`SYSTEM_PROMPT_INITIAL`** additions:
- Replace single-leg transport instruction with: "对 destinations 中每对相邻城市（含出发地↔第一城、末城↔出发地），从 flyai 给出的机票和火车数据中各挑最优（考虑时长×票价），在 transport item description 里写：推荐方案（航班号/车次、起止站、时长、票价）并附一行'备选：XX 方案（XX 元/XX 小时）'。"
- Add: "destinations 长度 > 1 时按顺序串联：先游 destinations[0] N 天，再转城市…。每次换城在当天最后插一个 transport item。"

**`normalizePlanJson`** — remove any line that touches `plan.destination` as a string; schema now parses `destinations`.

### 7. `apps/web/composables/useTripHistory.ts`

```ts
// ~line 58
const dests: string[] = brief?.destinations ?? plan?.destinations ?? []
const destination = dests.length > 1 ? dests.join(' / ') : (dests[0] ?? '')
```

`TripHistoryEntry.destination: string` stays as computed join — no interface change needed downstream.

### 8. `apps/web/pages/index.vue`

```ts
breadcrumbDestination = computed(() =>
  (currentPlan.value?.destinations ?? []).join(' / ') || ''
)
```

---

## Test Changes (mechanical)

In every `*.test.ts`:
- `destination: 'X'` → `destinations: ['X']`
- `brief.destination` → `brief.destinations[0]`
- `plan.destination` → `plan.destinations[0]`

**Key behavior changes to assert:**
- `react-loop.test.ts`: empty-destination test becomes `destinations: []` → clarification triggered
- `prefetch.test.ts`: single-dest + origin → 4 tasks (outbound flight+train + hotel+POI); with return leg → 6 tasks. Update count assertions.
- `extractor.test.ts`: assert `res.brief.destinations` is an array.

---

## Verification

1. `pnpm -r test` — all suites pass
2. `pnpm build` — no TypeScript errors
3. Dev run: send "我想从北京出发，先去顺德玩3天再去珠海2天"
   - API logs show prefetch gathered entries covering BJ→顺德 flight+train, 顺德→珠海 flight+train, 珠海→BJ flight+train, 顺德 hotel+POI, 珠海 hotel+POI
   - Final plan has `destinations: ["顺德","珠海"]`
   - Transport items contain both recommended option and alternative with real prices/times

---

## Files Changed

| File | Change |
|---|---|
| `packages/shared/src/brief.ts` | `destination` → `destinations[]` with preprocess migration |
| `packages/shared/src/plan.ts` | Same |
| `apps/api/src/agents/extractor.ts` | Prompt + regex emit `destinations[]`; merge updated |
| `apps/api/src/agents/react-loop.ts` | Guard checks `destinations.length === 0` |
| `apps/api/src/agents/prefetch.ts` | Leg-based queries: flight+train per leg, hotel+POI per city; add `offsetDate` helper |
| `apps/api/src/agents/generator.ts` | System prompt multi-city instructions; remove `destination` from normalization |
| `apps/web/composables/useTripHistory.ts` | Read `destinations[0]` / `destinations.join(' / ')` |
| `apps/web/pages/index.vue` | Breadcrumb from `plan.destinations.join(' / ')` |
| All `*.test.ts` | Mechanical: `destination:"X"` → `destinations:["X"]` |
