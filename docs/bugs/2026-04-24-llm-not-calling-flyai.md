# Bug: ReAct loop never converges — LLM doesn't call flyai, items always empty

**Discovered:** 2026-04-24 during post-rewrite browser smoke test
**Branch / commit at discovery:** `main` @ `2475d8d`
**Severity:** High — core ReAct value proposition (real flight/hotel/POI data via flyai) doesn't fire; user always sees `score=0` and waits for max-iter timeout

---

## Symptom

End-to-end repro from logged-in browser:

1. Send `我想去上海玩 3 天，从北京出发，2 个人，预算 5000，喜欢美食和文化` to the planner
2. UI streams a short NL prelude like `"我先为你整理一个适合 2 人的上海 3 天行程..."`
3. Right side renders **empty** plan card:
   - Title present (`上海3天2晚美食文化之旅`)
   - `dailyPlans = [{day:1, items:[]}, {day:2, items:[]}, {day:3, items:[]}]`
   - `estimatedBudget.amount = 0`
4. Score panel shows `综合评分=0`, `transport/lodging/attraction = N/A`
5. Top progress bar climbs `第 1 / 10 轮优化中` → `第 2 / 10 轮` → ... and the score **never changes**
6. After ~3-5 minutes the loop finally hits `max_iter_reached`

## Root cause hypothesis

The LLM (`gpt-5.4` via sub2api proxy at `http://43.166.169.153:8080/v1`) **silently ignores the flyai tool**. Backend log evidence:

```
[SkillRegistry] Installed skill: flyai@1.0.14    ← only registration, never invoked
```

There are **zero** `[SkillRegistry] Invoking skill: flyai` lines, even though the system prompt instructs:

> 跨城交通：必须调用 flyai skill，传 command="search-flight"...

The LLM instead responds with hedge text like:

> 当前我无法实时查询交通和酒店库存价格

then emits a JSON plan with empty `items` arrays. Each refine round repeats the same pattern.

Possible underlying causes (subagent to verify):

1. **sub2api proxy doesn't pass `tools` / `tool_choice` correctly** — gpt-5.4 may not see the function declarations
2. **`tool_choice: 'auto'` is too weak** — model defaults to "I can't access real-time data"
3. **Tool schema mismatch** — flyai's `parameters.json` has many top-level fields all marked optional except `command`; LLM can't pick correctly
4. **Reasoning model behavior** — gpt-5.4 may prefer to reply directly rather than emit tool calls when uncertain

## Reproducer (offline, no UI)

```bash
# 1. Start API
PORT=3001 pnpm --filter @travel-agent/api dev > /tmp/api.log 2>&1 &
sleep 5

# 2. Login
curl -sS -c /tmp/cookies -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"XING736bing"}'

# 3. Create session
SESSION=$(curl -sS -b /tmp/cookies -X POST http://localhost:3001/api/sessions \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session']['id'])")

# 4. Send full brief
curl -sS -b /tmp/cookies --max-time 600 -N -X POST \
  http://localhost:3001/api/sessions/$SESSION/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"我想去上海玩 3 天，从北京出发，2 个人，预算 5000，喜欢美食和文化"}' \
  | tee /tmp/sse.log

# 5. Inspect — should see ZERO "Invoking skill: flyai" lines:
grep "Invoking skill" /tmp/api.log
```

Expected (after fix): plan items get populated; `[SkillRegistry] Invoking skill: flyai` appears at least once per session; score climbs above 0; loop converges to >= 90 within 10 rounds OR shows real per-category scores like `transport=70, lodging=85, attraction=90`.

Actual: zero flyai invocations, plan items stay empty, score stays 0.

---

## Acceptance criteria

A fix is acceptable if:

1. ✅ For the standard repro brief above, **flyai is invoked at least once** (visible in `[SkillRegistry] Invoking skill: flyai` log)
2. ✅ Resulting plan has **non-empty `items` array** for each day, including:
   - At least 1 transport item with a flight number (e.g. `CA1234`) or train code (`G1234`) — directly from flyai output
   - At least 1 lodging item with a real hotel name from flyai search-hotel
   - At least 2-3 attraction/meal items per day with opening hours / ticket prices
3. ✅ After 1-3 iterations, `score.transport`, `score.lodging`, `score.attraction` are all **≥ 60** (not null, not 0)
4. ✅ Existing 24 unit tests still pass; web build still succeeds
5. ✅ Fix is reasonably scoped (≤ 200 lines of changed code, ≤ 2-3 commits)

If the LLM-via-proxy fundamentally cannot call tools, the acceptable workaround is **deterministic pre-call**: backend extracts `originCity + destination + travelDates + travelers` from the brief and **directly invokes flyai before any LLM call**, then stuffs the structured results into the LLM context as `system` messages. The LLM then only needs to format/select, not decide to call.

---

## Approaches the subagent should evaluate

In rough order of robustness:

### A. Deterministic pre-call (most reliable)
Before `runInitial`, in `react-loop.ts` (or new `pre-fetch.ts`):

```ts
async function prefetchFlyaiContext(brief: TripBrief): Promise<string[]> {
  const ctx: string[] = []
  if (brief.originCity && brief.destination && brief.travelDates?.start) {
    const flights = await skillRegistry.invoke('flyai', {
      command: 'search-flight',
      origin: brief.originCity,
      destination: brief.destination,
      depDate: brief.travelDates.start,
    })
    ctx.push(`真实航班数据 (flyai search-flight):\n${flights.slice(0, 3000)}`)
  }
  if (brief.destination && brief.travelDates?.start && brief.travelDates?.end) {
    const hotels = await skillRegistry.invoke('flyai', {
      command: 'search-hotel',
      destName: brief.destination,
      checkInDate: brief.travelDates.start,
      checkOutDate: brief.travelDates.end,
    })
    ctx.push(`真实酒店数据 (flyai search-hotel):\n${hotels.slice(0, 3000)}`)
  }
  if (brief.destination) {
    const pois = await skillRegistry.invoke('flyai', {
      command: 'search-poi',
      destName: brief.destination,
    })
    ctx.push(`真实景点数据 (flyai search-poi):\n${pois.slice(0, 3000)}`)
  }
  return ctx
}
```

Then prepend the strings as `{ role: 'system', content: ... }` to `runInitial`'s message list. **Pros:** works regardless of LLM tool support, deterministic, observable. **Cons:** extra ~10-30s latency upfront, may pre-fetch data the user doesn't actually need.

Edge case: if `travelDates` is missing, default to `today + 7 days` for search-flight and `+7 to +10` for hotel — the LLM only needs the data shape, exact dates can be picked later.

### B. Force first-round tool call
In `runInitial`'s tool-loop pass:

```ts
tool_choice: { type: 'function', function: { name: 'flyai' } }  // first round only
```

Then on subsequent rounds switch back to `'auto'`. **Pros:** minimal change, keeps LLM in driver's seat. **Cons:** if sub2api proxy doesn't pass `tool_choice`, this does nothing; also forces only ONE call (LLM might pick search-poi instead of search-flight).

### C. Strengthen system prompt + post-validate
Add to the system prompt: `如果你输出 dailyPlans 但所有 items 为空，我会拒绝你的输出并要求你重新生成。` Then in `runInitial`, after parsing the plan, if `every day.items.length === 0`, retry once with a stronger nudge. **Pros:** cheapest. **Cons:** not robust — may still fail.

### D. Switch model
Change `LLM_MODEL_PLANNER` env to a model known to support function calling well (e.g. direct OpenAI `gpt-4o`, Claude). **Out of scope** unless the user provides credentials.

---

## Recommended approach

**A (deterministic pre-call) + C (strengthen prompt) combined.** A guarantees real data is available in context; C nudges the LLM to actually use it.

If A is implemented well, the system prompt for `runInitial` should change from:

> 跨城交通：必须调用 flyai skill...

to:

> 你将在 system 消息中收到真实航班、酒店、景点 JSON 数据。请直接基于这些数据填写 PlanItem.description，不要说"我无法实时查询"。如果需要更多查询，可以调用 flyai tool。

---

## Files most likely to change

| File | Likely change |
|---|---|
| `apps/api/src/agents/react-loop.ts` | Insert prefetch step between extractor and runInitial |
| `apps/api/src/agents/generator.ts` | Accept optional `prefetched` context param; weave into system messages; update `SYSTEM_PROMPT_INITIAL` |
| **NEW** `apps/api/src/agents/prefetch.ts` | Encapsulate flyai pre-calls + structured caching |
| `apps/api/src/agents/extractor.ts` | (maybe) auto-fill `travelDates` defaults if missing — needed to pre-call hotel search |

## Out of scope

- Switching the underlying LLM provider
- Adding new flyai commands beyond search-flight / search-hotel / search-poi
- UI changes (current frontend already correctly displays whatever items the backend produces)
