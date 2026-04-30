# Tool Categorization & Evaluator Removal

**Date:** 2026-04-30

## Goal

1. Reorganize `apps/api/src/agents/tools/` into `agent/` and `mcp/` subdirectories reflecting each tool's dependency type.
2. Remove the evaluator/refiner pipeline (scoring adds little user value) and all dead code downstream.

---

## Tool Classification

| Tool | File | Category | Reason |
|------|------|----------|--------|
| `call_extractor` | `extract-brief.tool.ts` | **agent** | Calls LLM (`FAST_MODEL`) via `extractor.ts` |
| `call_generator` | `generate-plan.tool.ts` | **agent** | Calls LLM via `generator.ts` (`runInitial`) |
| `call_clarifier` | `ask-clarification.tool.ts` | **agent** | Calls LLM (`FAST_MODEL`) via `clarifier.ts` |
| `call_prefetch` | `prefetch-context.tool.ts` | **mcp** | Calls external FlyAI service via skill registry |

`evaluate-plan.tool.ts` and `refine-plan.tool.ts` are deleted, not categorized.

---

## Directory Structure (after)

```
apps/api/src/agents/tools/
  agent/
    extract-brief.tool.ts
    generate-plan.tool.ts
    ask-clarification.tool.ts
  mcp/
    prefetch-context.tool.ts
  types.ts
  index.ts
```

---

## Pipeline (after)

```
call_extractor → call_prefetch → call_generator → done
```

Orchestrator receives the plan from generator and emits a single short Chinese confirmation sentence. No convergence loop, no scoring.

---

## Deletions

### API layer
- `apps/api/src/agents/tools/evaluate-plan.tool.ts`
- `apps/api/src/agents/tools/refine-plan.tool.ts`
- `apps/api/src/agents/evaluator.ts` + `evaluator.test.ts`
- `apps/api/src/agents/critic.ts` + `critic.test.ts`
- `runRefine` function removed from `apps/api/src/agents/generator.ts`

### Shared package
- `packages/shared/src/evaluation.ts` (entire file — `EvaluationReport`, `EvaluationRule`, etc.)
- `packages/shared/src/scoring.ts` (entire file — `scorePlan`, `isConverged`, rule weights)
- Events removed from `packages/shared/src/events.ts`: `score`, `iteration_progress`, `max_iter_reached`
- Fields removed from `packages/shared/src/session.ts`: `currentScore`, `currentEvaluation`, `iterationCount`

### Frontend
- `apps/web/components/ItineraryScore.vue` (entire file)
- `apps/web/utils/scoring.ts` (entire file)
- `apps/web/components/react/ReactProgressBar.vue` — remove score progress bar display
- `apps/web/stores/chat.ts` — remove `displayScore`, `targetScore`, `maxIterReached`, and `score` / `iteration_progress` / `max_iter_reached` event handlers
- `apps/web/stores/workspace.ts` — remove `currentScore` field and its assignment
- `apps/web/components/PlanningPreview.vue` — remove `<ItineraryScore>` usage and score-related computed properties

---

## Modifications

### `apps/api/src/agents/tools/index.ts`
- Update import paths to `./agent/` and `./mcp/`
- Remove `evaluatePlanTool` and `refinePlanTool` from `ALL_TOOLS`
- Remove `ORCHESTRATOR_SYSTEM_PROMPT` sections: Post-evaluator rule, Error recovery rule (retry generator), and all `call_evaluator`/`call_refiner` references
- New post-generator instruction: after `call_generator` returns, emit one short Chinese confirmation sentence and stop

### `apps/api/src/agents/react-loop.ts`
- Remove `iterationCount` increment
- Remove `max_iter_reached` emit
- Remove `converged` field from `done` event payload (or keep as always `true`)

### `packages/shared/src/index.ts`
- Remove re-exports of `evaluation.ts` and `scoring.ts`

---

## Out of Scope

- No changes to `call_extractor`, `call_prefetch`, `call_generator`, `call_clarifier` behavior
- No changes to auth, session store, or SSE transport
- No frontend UI redesign beyond removing score display
