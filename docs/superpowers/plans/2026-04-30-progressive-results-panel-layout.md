# Progressive Results Panel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop workspace stay single-column while the first itinerary is still being generated, then automatically reveal the right-side plan panel as soon as the first complete itinerary is available.

**Architecture:** Pure frontend change in `apps/web`. The key implementation detail is that the reveal signal cannot be raw `workspaceStore.currentPlan`, because that store is populated by `plan_partial` before the final itinerary is ready. Instead, the page should derive a renderable-plan signal from `chatStore.plan` (final `plan` event) with a `workspaceStore.currentPlan` fallback only for hydrated/history-loaded sessions that already have a complete persisted plan.

**Tech Stack:** Nuxt 3, Vue 3 SFCs, Pinia, plain CSS, Vitest source-inspection tests.

**Spec:** `docs/superpowers/specs/2026-04-30-progressive-results-panel-layout-design.md`

**Branch / commit strategy:** Execute in the current branch or a dedicated worktree; keep one commit per task so regressions in gating vs animation can be reverted independently.

---

## File Map

| File | Touched by | Responsibility |
|---|---|---|
| `apps/web/utils/workspace-layout.test.ts` | Task 1 | Regression checks for the reveal signal, main-grid gating, split ratio, and reveal animation hooks. |
| `apps/web/pages/index.vue` | Task 2 | Workspace render conditions: derive `hasPlanArtifact` from final-plan state, collapse to single-panel before the first final plan, and gate divider / right panel render. |
| `apps/web/assets/css/main.css` | Task 3 | Desktop split ratio, single-panel flex-basis override, and lightweight right-panel reveal motion. |

No API, shared-schema, or `PlanningPreview.vue` changes are needed for this scope.

---

## Task 1: Add failing regression tests for final-plan reveal behavior

**Files:**
- Modify: `apps/web/utils/workspace-layout.test.ts`

- [ ] **Step 1: Add regression tests that describe the desired behavior**

Append this `describe` block to `apps/web/utils/workspace-layout.test.ts` after the existing `workspace landing layout styles` tests:

```ts
describe('progressive results panel layout', () => {
  it('derives the plan-panel reveal signal from the final plan plus hydrated result fallback', () => {
    expect(indexPage).toMatch(
      /const hasPlanArtifact = computed\(\(\) => Boolean\(\s*chatPlan\.value \|\| \(phase\.value === ["']result["'] && currentPlan\.value\)\s*\)\)/,
    )
  })

  it('keeps the main grid single-panel until that reveal signal becomes truthy', () => {
    expect(indexPage).toContain(`:class="{ 'is-single-panel': !hasPlanArtifact }"`)
    expect(indexPage).not.toContain(`:class="{ 'is-single-panel': !hasPlanArtifact && phase !== 'planning' }"`)
  })

  it('renders the divider and right panel only after the first final plan exists', () => {
    expect(indexPage).toContain('<template v-if="hasPlanArtifact">')
    expect(indexPage).not.toContain(`<template v-if="hasPlanArtifact || phase === 'planning'">`)
    expect(indexPage).toContain('class="main-grid-panel main-grid-panel-secondary"')
  })

  it('uses a 46/54 split with a reveal animation for the secondary panel', () => {
    const gridBlock = extractBlock(mainCss, '.main-grid')
    const primaryBlock = extractBlock(mainCss, '.main-grid-panel-primary')
    const singlePanelBlock = extractBlock(mainCss, '.main-grid.is-single-panel .main-grid-panel-primary')
    const secondaryBlock = extractBlock(mainCss, '.main-grid-panel-secondary')

    expect(gridBlock).toBeTruthy()
    expect(gridBlock).toContain('--main-grid-left: 46%;')

    expect(primaryBlock).toBeTruthy()
    expect(primaryBlock).toContain('flex: 0 0 var(--main-grid-left);')
    expect(primaryBlock).toContain('transition: flex-basis 200ms var(--ease-out);')

    expect(singlePanelBlock).toBeTruthy()
    expect(singlePanelBlock).toContain('flex-basis: 100%;')

    expect(secondaryBlock).toBeTruthy()
    expect(secondaryBlock).toContain('animation: plan-panel-reveal 200ms var(--ease-out) both;')
    expect(mainCss).toContain('@keyframes plan-panel-reveal')
  })
})
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
pnpm --filter @travel-agent/web exec vitest run utils/workspace-layout.test.ts
```

Expected: FAIL with at least these mismatches:
- missing `chatPlan.value || (phase.value === "result" && currentPlan.value)` in `index.vue`
- old `hasPlanArtifact || phase === 'planning'` template gate still present
- `--main-grid-left: 42%;` still present instead of `46%`

- [ ] **Step 3: Commit the failing test coverage first**

```bash
git add apps/web/utils/workspace-layout.test.ts
git commit -m "test(web): add progressive results panel layout coverage"
```

Expected: commit succeeds even though the branch is red between Task 1 and Task 3.

---

## Task 2: Gate the right-side workspace on a final-plan signal, not `plan_partial`

**Files:**
- Modify: `apps/web/pages/index.vue`
- Test: `apps/web/utils/workspace-layout.test.ts`

- [ ] **Step 1: Alias `chatStore.plan` in `storeToRefs`**

In `apps/web/pages/index.vue`, update the `storeToRefs(chatStore)` destructure so it includes the final-plan field:

```ts
const {
  agentStatus,
  draft,
  errorMessage,
  messages,
  plan: chatPlan,
  phase,
  streamSteps,
  iteration,
  maxIterations,
  displayScore,
  targetScore,
  loopStatus,
  awaitingClarify,
  maxIterReached,
  canContinue,
} = storeToRefs(chatStore)
```

- [ ] **Step 2: Replace the old `hasPlanArtifact` computed with a final-plan-aware signal**

In the computed declarations near `hasConversation`, replace the current `hasPlanArtifact` line with:

```ts
const hasConversation = computed(() => messages.value.length > 1)
const hasPlanArtifact = computed(() => Boolean(
  chatPlan.value || (phase.value === "result" && currentPlan.value),
))
const hasWorkspaceState = computed(() => Boolean(currentPlan.value || workspaceSessionId.value))
```

Why this exact expression:
- `chatPlan.value` turns truthy on the final `plan` event, so the panel opens immediately when the first complete itinerary lands.
- `(phase.value === "result" && currentPlan.value)` covers hydrated and history-loaded sessions whose full plan lives in `workspaceStore.currentPlan`.
- a plain `Boolean(currentPlan.value)` would incorrectly open the panel on `plan_partial`.

- [ ] **Step 3: Gate the main-grid layout and right panel in the template**

Replace the current `<section ref="mainSplitRef" class="main-grid" ...>` block in `apps/web/pages/index.vue` with:

```vue
<section
  ref="mainSplitRef"
  class="main-grid"
  :class="{ 'is-single-panel': !hasPlanArtifact }"
  :style="mainGridStyle"
>
  <div class="main-grid-panel main-grid-panel-primary">
    <ChatPanel
      :agent-status="agentStatus"
      :messages="messages"
      :phase="phase"
      :stream-steps="streamSteps"
    >
      <template #composer>
        <PromptComposer
          compact
          :draft="draft"
          :loading="phase === 'planning'"
          @submit="submitPrompt"
          @update-draft="chatStore.setDraft"
          @use-prompt="applySuggestedPrompt"
        />
      </template>
    </ChatPanel>
  </div>

  <template v-if="hasPlanArtifact">
    <button
      type="button"
      class="main-grid-divider"
      :class="{ 'is-resizing': isResizingSplit }"
      aria-label="调整对话区和结果区宽度"
      @pointerdown="startSplitResize"
    >
      <span class="main-grid-divider-track" />
      <span class="main-grid-divider-grip">
        <span />
        <span />
        <span />
      </span>
    </button>

    <div class="main-grid-panel main-grid-panel-secondary">
      <PlanningPreview
        :agent-status="agentStatus"
        :error-message="errorMessage"
        :phase="phase"
      />
    </div>
  </template>
</section>
```

- [ ] **Step 4: Run the targeted regression test again**

Run:

```bash
pnpm --filter @travel-agent/web exec vitest run utils/workspace-layout.test.ts
```

Expected: still FAIL, but only on the CSS assertions (`46%`, `flex-basis` transition, `main-grid-panel-secondary` animation). The source-gating assertions should now pass.

- [ ] **Step 5: Commit the template/render-state change**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): reveal results panel on first final itinerary"
```

---

## Task 3: Rebalance the desktop split and add a lightweight reveal transition

**Files:**
- Modify: `apps/web/assets/css/main.css`
- Test: `apps/web/utils/workspace-layout.test.ts`

- [ ] **Step 1: Update the main-grid split ratio and animate the primary panel width**

In `apps/web/assets/css/main.css`, replace the current main-grid blocks:

```css
.main-grid {
  --main-grid-left: 46%;
  display: flex;
  flex: 1;
  gap: 0;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
}

.main-grid-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
}

.main-grid-panel-primary {
  flex: 0 0 var(--main-grid-left);
  transition: flex-basis 200ms var(--ease-out);
}

.main-grid-panel:not(.main-grid-panel-primary) { flex: 1 1 0; }

.main-grid.is-single-panel .main-grid-panel-primary { flex-basis: 100%; }
```

This keeps the chat panel full-width before reveal, then lets it contract smoothly to `46%` when the secondary panel mounts.

- [ ] **Step 2: Add the right-panel reveal animation hook**

Directly after the single-panel override, add:

```css
.main-grid-panel-secondary {
  animation: plan-panel-reveal 200ms var(--ease-out) both;
}

@keyframes plan-panel-reveal {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

No extra `prefers-reduced-motion` block is needed because the global rule in `main.css` already forces all `animation-duration` and `transition-duration` to `0ms` under reduced motion.

- [ ] **Step 3: Run the targeted regression test and the full web test suite**

Run:

```bash
pnpm --filter @travel-agent/web exec vitest run utils/workspace-layout.test.ts
pnpm test:web
```

Expected:
- targeted file PASS with the new progressive-reveal assertions
- full web test suite PASS without touching unrelated frontend tests

- [ ] **Step 4: Build the web app**

Run:

```bash
pnpm build:web
```

Expected: successful Nuxt production build with no template or CSS errors.

- [ ] **Step 5: Commit the CSS reveal behavior**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): add progressive results panel reveal"
```

---

## Task 4: Manual verification of planning, hydration, and reset flows

**Files:**
- Modify only if a verification bug is found: `apps/web/pages/index.vue`, `apps/web/assets/css/main.css`, `apps/web/utils/workspace-layout.test.ts`

- [ ] **Step 1: Start the local stack**

Run:

```bash
pnpm dev:api
pnpm dev:web
```

Expected:
- API serves on the configured dev port without auth/session errors
- Nuxt serves the web app on `http://localhost:3000`

- [ ] **Step 2: Verify pre-plan and in-progress single-panel behavior**

In the browser:
1. Open `http://localhost:3000`.
2. Log in if prompted.
3. Start a brand-new conversation.
4. Submit a prompt and watch the page before the final itinerary lands.

Expected:
- before any plan is ready, only the chat panel is visible
- no right-side `PlanningPreview` shell appears during token streaming
- no center divider is rendered while only `plan_partial` updates are arriving

- [ ] **Step 3: Verify immediate reveal on the first final itinerary**

Continue the same run until the first final itinerary arrives.

Expected:
- the right panel appears immediately when the final itinerary is emitted
- the left panel contracts to the default `46%` width if `travel-agent-panel-layout` is not already stored
- the right panel fades/slides in once and then stays stable
- the divider is visible and draggable after reveal

If you need to re-check the default ratio, clear the saved split first:

```js
sessionStorage.removeItem('travel-agent-panel-layout')
location.reload()
```

- [ ] **Step 4: Verify hydration and new-conversation reset**

In the browser:
1. Reload the page with an already-generated plan in session storage.
2. Confirm the plan loads directly into dual-panel mode.
3. Click `新建行程`.

Expected:
- reload with a stored or history-loaded full plan opens directly in dual-panel mode
- `新建行程` clears both plan stores and returns the workspace to single-panel mode
- the next planning run starts in single-panel mode again until the next final plan arrives

- [ ] **Step 5: Commit only if verification uncovered a bug**

Run:

```bash
git status --short
```

Expected: no output.

If verification required a small follow-up fix, commit that fix with:

```bash
git add apps/web/pages/index.vue apps/web/assets/css/main.css apps/web/utils/workspace-layout.test.ts
git commit -m "fix(web): stabilize progressive results panel behavior"
```

If `git status --short` is empty, skip this commit and leave the task as verification-only.

---

## Self-Review

### Spec coverage

- Single-panel before the first final itinerary: covered by Task 2 template gating and Task 3 single-panel flex-basis override.
- Immediate reveal after first complete itinerary: covered by Task 2 final-plan signal and Task 3 secondary-panel animation.
- Stay open during later refinement: covered by Task 2 using `chatPlan` / result fallback rather than `phase === 'planning'`.
- Hydrated sessions open dual-panel: covered by Task 2 result-phase fallback and Task 4 manual reload check.
- New conversation resets to single-panel: covered by existing `resetConversation()` behavior plus Task 4 manual verification.
- Mobile remains unchanged: protected by Task 3 limiting changes to desktop main-grid rules and Task 4 manual smoke-check.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” shortcuts are present.
- Every code-changing task includes concrete snippets, exact commands, and expected outcomes.

### Type consistency

- The reveal signal is consistently named `hasPlanArtifact`.
- Final-plan source is consistently `chatPlan`.
- Hydrated-session fallback is consistently `(phase.value === "result" && currentPlan.value)`.
- The new CSS hook is consistently named `main-grid-panel-secondary`.
