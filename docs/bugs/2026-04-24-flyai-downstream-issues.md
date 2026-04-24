# Bugs: flyai prefetch partial-failure (post-ReAct-rewrite)

**Discovered:** 2026-04-24 during browser smoke test after landing the ReAct rewrite + flyai prefetch fix
**Branch / commit at discovery:** `main` @ `7561220`
**Severity:** Medium — ReAct loop now works end-to-end with real flight data, but 2 of 3 prefetch calls consistently fail, so lodging/attraction scores max out around 40-75 instead of climbing toward 90+. Not blocking; acceptable degradation. See companion bug `docs/bugs/2026-04-24-llm-not-calling-flyai.md` for the prerequisite fix already landed.

---

## Context

After the prefetch + tightened-prompt fix, the ReAct loop succeeds in its primary goal:
- `flyai` is invoked 3 times per session (search-flight + search-hotel + search-poi)
- Plan items are populated (19 total items for a 3-day Shanghai trip)
- Scores become non-null: transport=72, lodging=40, attraction=75
- First-day transport uses **real** data: `KN5977 中联航 PKX→PVG 21:00→22:55 ¥700`

But only the **flight** prefetch actually succeeds. Hotel and POI calls fail silently (caught by `try/tryInvoke` as designed), so the LLM has to guess those legs from general knowledge, capping their scores.

---

## Issue 1: `search-poi` uses wrong CLI flag

### Symptom

```
[Prefetch] flyai search-poi failed, skipping: ...
```

Backend log shows every smoke test hits this. Zero POI data ever enters the LLM context.

### Evidence

Our call in `apps/api/src/agents/prefetch.ts`:

```ts
await skillRegistry.invoke('flyai', {
  command: 'search-poi',
  destName: brief.destination,
})
```

`load-dir-skills.ts` converts keys camelCase → kebab-case, producing `--dest-name`.

`~/.codex/skills/flyai/skills/flyai/references/search-poi.md` shows the actual flag is `--city-name`, not `--dest-name`.

### Impact

- Attraction score is driven entirely by LLM general knowledge (no real opening hours, ticket prices, coordinates)
- Attraction score caps ~75 — can't reliably climb to 90

### Fix options

**A. Fix on our side (recommended, 1 line):**
```ts
// prefetch.ts
await skillRegistry.invoke('flyai', {
  command: 'search-poi',
  cityName: brief.destination,   // was destName
})
```

**B. Verify and also fix for search-hotel:** check `references/search-hotel.md` — our current call uses `destName`, which may also be wrong. The CLI probably wants `--dest-name` literally (not `--city-name`), but worth verifying: `flyai search-hotel --help` or reading the reference doc.

**C. Add a compat shim in `load-dir-skills.ts`**: map known camelCase aliases to their kebab targets. Too brittle; prefer A.

### Scope

**1-2 lines per skill invocation**. Should be a 10-minute fix. Verify by running the smoke test again and grepping for `[Prefetch] gathered 3/3 entries` (was 1/3).

---

## Issue 2: `search-hotel` hits HTTP 429 rate limit

### Symptom

```
[SkillRegistry] Skill failed: flyai ... HTTP 429 Rate limit exceeded
[Prefetch] flyai search-hotel failed, skipping: ...
```

Observed mid-run during a session that was on iteration 2+. First iteration's prefetch succeeded; later iterations' prefetch failed due to rate limiting on the upstream MCP endpoint flyai talks to.

### Evidence

- Only hotel search hits 429; flight search in the same session succeeded just fine
- The 429 comes from the MCP/upstream provider, not from the `flyai` CLI itself
- Hotel data cache (if it was populated in round 1) should in principle be reused, so round 2+ shouldn't re-call — **check if our cache is working correctly**

### Impact

- If the first round's hotel search also fails (cold start), lodging leg gets no real hotel data
- Lodging score stuck at 40 (no check-in time, no real price range)
- Adding more iterations makes it worse (more 429s over time)

### Fix options

**A. Verify cache hit behavior:** prefetch.ts already has a `sessionId + briefHash` cache. Confirm via logs that **iteration 2+ does NOT re-call flyai when brief unchanged**. If it does, fix the cache key or insertion order.

**B. Back off on 429:** detect the 429 error substring, sleep 3-5s and retry once. Cheap, mitigates rate limits without structural changes.

**C. Decrease concurrency:** prefetch currently does flight / hotel / POI in parallel (`Promise.all`-ish). Serialize with small delays to reduce burst.

### Scope

A is essentially verification-only. B is ~5 lines. C is a light refactor. Pick A+B for best effort.

---

## Issue 3: only 1/3 prefetch entries reach the LLM (compound of #1 + #2)

Log line:

```
[Prefetch] gathered 1/3 entries for session=... brief=上海/3d
```

Nothing to fix independently — resolving #1 and #2 lifts this to 3/3 naturally.

### Verification after fix

```bash
# After applying fix for #1 and #2, smoke test and expect:
grep "Prefetch] gathered" /tmp/smoke-dev.log
# → [Prefetch] gathered 3/3 entries for session=...
```

If still <3/3 after #1 and #2 fixes, there's a deeper problem (network, auth) to investigate.

---

## Issue 4: refine LLM returned empty content once (already handled)

### Symptom

```
[Generator.refine] No JSON in LLM output (content length=0), returning original
```

Observed in one of ~3-4 refine rounds.

### Evidence

Single log line. The refine path in `generator.ts` already handles this by returning the original plan unchanged; the ReAct loop continues normally to the next iteration.

### Impact

That particular refine iteration is a no-op — plan doesn't improve but doesn't break. Net: 1 iteration wasted out of 10.

### Fix options

Could add retry-once on empty response, or add better logging to learn what the LLM actually returned. But given the existing fallback works, **it's acceptable to leave as-is** unless frequency becomes a problem.

### Scope

**Optional**. Only worth fixing if we observe >20% of refine rounds returning empty.

---

## Acceptance criteria (if we do the fix)

A fix for Issues #1 and #2 is acceptable when:

1. ✅ `search-poi` invocation succeeds at least once in a fresh session against a known-good destination (e.g., 上海, 北京)
2. ✅ `[Prefetch] gathered 3/3 entries` appears in backend log for a session where brief has `destination + originCity + days`
3. ✅ First iteration's `score.attraction` >= 80 (given real POI data, the LLM should hit opening hours + ticket price consistently)
4. ✅ First iteration's `score.lodging` >= 70 (given real hotel data, the LLM should fill check-in time + room type + price)
5. ✅ Existing 31 unit tests pass
6. ✅ Regression-test: the original bug (LLM not calling flyai at all) still doesn't recur

---

## Recommended batching

Do Issues #1 + #2 together in a single small commit (both touch `prefetch.ts`). Issue #4 can be deferred indefinitely.

## Files likely to change

| File | Change |
|---|---|
| `apps/api/src/agents/prefetch.ts` | Fix `search-poi` flag name; add 429 retry/backoff; verify cache key works for refine |
| `apps/api/src/agents/prefetch.test.ts` | Add cases for the corrected parameter name + 429 retry path |

No changes expected to `react-loop.ts`, `generator.ts`, `extractor.ts`, or any frontend code.

## Out of scope

- Switching away from sub2api / flyai
- Adding new flyai commands
- Rewriting the ReAct loop state machine
- Frontend display changes
