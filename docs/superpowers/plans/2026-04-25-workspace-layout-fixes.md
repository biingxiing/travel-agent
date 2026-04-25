# Workspace Layout Fixes (A+B+C+D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four workspace-page layout pain points: empty right panel whitespace (A), oversized conversation topbar (B), oversized chat bubbles (C), and over-emphasized resize handles (D).

**Architecture:** Pure frontend change in `apps/web` (Nuxt 3 + Pinia). No API / shared schema impact. Driven by a single computed `hasPlanArtifact` for the right-panel visibility, plus targeted CSS adjustments. Each task is a single concern with its own commit so a regression can be reverted in isolation.

**Tech Stack:** Vue 3 SFC, Pinia, plain CSS (no Tailwind). Repo has no automated frontend test suite, so verification is browser + DOM inspection + `pnpm build:web`.

**Spec:** `docs/superpowers/specs/2026-04-25-workspace-layout-fixes-design.md`

**Branch / commit strategy:** Work directly on the current branch; one commit per task; final commit only if `pnpm build:web` needs a fix-up.

---

## File Map

| File | Touched by | Responsibility |
|---|---|---|
| `apps/web/pages/index.vue` | Tasks 1, 3, 5 | Workspace shell template + script: `hasPlanArtifact` computed; conditional right panel; topbar tagline visibility; deletion of bottom resize handle plus its state. |
| `apps/web/assets/css/main.css` | Tasks 2, 4, 6, 7 | Workspace shell CSS: default split ratio; `.is-single-panel` rule; conversation topbar collapse; deletion of `.resizable-panel*` / `.panel-resize-handle` styles; middle divider grip default-hidden. |
| `apps/web/components/ChatPanel.vue` | Task 5 | Bubble `max-width` per role + conversation list gap. |

No other files change.

---

## Task 1: Add `hasPlanArtifact` and gate right panel + middle divider in template

**Files:**
- Modify: `apps/web/pages/index.vue` (script setup near line 53; template lines 548–597)

- [ ] **Step 1: Read the current file to confirm line numbers**

Run: `sed -n '50,60p;545,605p' apps/web/pages/index.vue`
Expected: see `const { sessionId: workspaceSessionId, currentPlan } = storeToRefs(workspaceStore)` near line 53; the `<section ref="mainSplitRef" class="main-grid" :style="mainGridStyle">` block with two `main-grid-panel`s + `main-grid-divider`.

- [ ] **Step 2: Add the `hasPlanArtifact` computed**

In `apps/web/pages/index.vue`, just below the existing `const hasWorkspaceState = computed(...)` definition (currently around line 64), add:

```ts
const hasPlanArtifact = computed(() => Boolean(currentPlan.value))
```

- [ ] **Step 3: Wrap right-panel + middle divider in `v-if`, add `is-single-panel` class**

Replace the `<section ref="mainSplitRef" class="main-grid" :style="mainGridStyle"> … </section>` block with:

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

    <div class="main-grid-panel">
      <PlanningPreview
        :agent-status="agentStatus"
        :error-message="errorMessage"
        :phase="phase"
      />
    </div>
  </template>
</section>
```

(Bottom `<button class="panel-resize-handle">` is left untouched — Task 6 deletes it.)

- [ ] **Step 4: Verify in browser — no plan**

Run: `pnpm dev:web` (in another terminal `pnpm dev:api` for the SSE backend), open `http://localhost:3000`, log in if needed, send a message that errors out (e.g. with API stopped) so `currentPlan` stays null.

Expected:
- DOM has `<section class="main-grid is-single-panel">` (inspect via DevTools).
- Inside, only one `.main-grid-panel.main-grid-panel-primary` exists.
- No `.main-grid-divider` and no second `.main-grid-panel`.
- chat region visually still occupies the left ~54% of the row (because CSS isn't yet adjusted — that's Task 2).

- [ ] **Step 5: Verify in browser — with plan**

With API running, send a successful prompt. Once `currentPlan` lands:

Expected:
- `is-single-panel` class is removed from `.main-grid`.
- `.main-grid-divider` and second `.main-grid-panel` are present.
- Default left/right split ratio still 54/46 (Task 2 changes it).

- [ ] **Step 6: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): gate plan panel + divider on hasPlanArtifact"
```

---

## Task 2: Default split ratio 54% → 42% and `.is-single-panel` CSS

**Files:**
- Modify: `apps/web/assets/css/main.css:1101-1117`

- [ ] **Step 1: Update the default split variable**

In `apps/web/assets/css/main.css`, find:

```css
.main-grid {
  --main-grid-left: 54%;
  display: flex;
  ...
}
```

Change `54%` to `42%`:

```css
.main-grid {
  --main-grid-left: 42%;
  display: flex;
  gap: 0;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 2: Add the single-panel override**

Right after `.main-grid-panel:not(.main-grid-panel-primary) { flex: 1 1 0; }` (around line 1117), add:

```css
.main-grid.is-single-panel .main-grid-panel-primary { flex: 1 1 100%; }
```

- [ ] **Step 3: Verify in browser — single panel fills width**

Reload with `currentPlan === null` (e.g. fresh session that errored). Expected: `.main-grid-panel-primary` now stretches to 100% of the row; no whitespace to its right.

- [ ] **Step 4: Verify in browser — split ratio is 42/58 by default**

Clear `sessionStorage` (DevTools → Application → Storage → clear `travel-agent-panel-layout`). Reload, generate a successful plan.

Expected: chat panel ~42% width; plan panel ~58% width. Drag the divider — split persists in sessionStorage, reload preserves it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): rebalance plan/chat split to 42/58 + single-panel rule"
```

---

## Task 3: Conversation topbar collapse (Pain B)

**Files:**
- Modify: `apps/web/pages/index.vue:484-486`
- Modify: `apps/web/assets/css/main.css:946-980`

- [ ] **Step 1: Tagline visibility — landing only**

In `apps/web/pages/index.vue`, find:

```vue
<p v-else class="page-topbar-copy">
  输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。
</p>
```

Change `v-else` to `v-else-if="isLanding"` (the breadcrumb still uses `v-if="breadcrumbDestination"` and stays as-is; tagline only shows on landing now):

```vue
<p v-else-if="isLanding" class="page-topbar-copy">
  输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。
</p>
```

- [ ] **Step 2: Add conversation-mode topbar CSS**

In `apps/web/assets/css/main.css`, immediately after the existing `.page-topbar-actions { ... }` block (around line 968), add:

```css
.page-shell.is-conversation .page-topbar {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom-color: var(--border-subtle-2);
}

.page-shell.is-conversation .compact-brand {
  font-size: 16px;
}

.page-shell.is-conversation .compact-brand::before {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
```

- [ ] **Step 3: Verify in browser — landing**

Open landing page (no conversation, no plan).
Expected: tagline still visible; topbar height ≈ unchanged (~92px); brand logo still 24px square.

- [ ] **Step 4: Verify in browser — conversation**

Send a message to enter conversation mode.
Expected:
- Tagline gone.
- `.page-topbar` total height ≤ 56px (measure via DevTools: it's `header.page-topbar`'s `offsetHeight`).
- Compact brand text now 16px.
- Bottom border is the lighter `var(--border-subtle-2)` color (#F8F9FB).

- [ ] **Step 5: Commit**

```bash
git add apps/web/pages/index.vue apps/web/assets/css/main.css
git commit -m "feat(web): collapse topbar in conversation mode (drop tagline, smaller brand)"
```

---

## Task 4: Chat bubble max-width per role + tighter list gap (Pain C)

**Files:**
- Modify: `apps/web/components/ChatPanel.vue:130-200` (CSS only)

- [ ] **Step 1: Read current bubble CSS to confirm**

Run: `sed -n '130,200p' apps/web/components/ChatPanel.vue`
Expected: see `.bubble { ... max-width: 85%; ... }`, `.bubble-user`, `.bubble-assistant`, `.bubble-system`, plus `.conversation-list { ... gap: 12px; ... }`.

- [ ] **Step 2: Update `.bubble` + `.bubble-user` + `.bubble-assistant` max-widths and `.conversation-list` gap**

In `apps/web/components/ChatPanel.vue`, in the `<style scoped>` block:

a) `.conversation-list { gap: 12px; ... }` → change `gap` to `14px`.

b) `.bubble { ... max-width: 85%; ... }` → change `max-width: 85%` to `max-width: min(640px, 85%);`.

c) Add a `max-width` line inside `.bubble-user`:

```css
.bubble-user {
  align-self: flex-end;
  background: var(--brand-gradient);
  color: var(--text-inverse);
  border-color: transparent;
  border-radius: var(--r-md) var(--r-md) 4px var(--r-md);
  max-width: min(520px, 85%);
}
```

d) `.bubble-assistant` already inherits 640px from `.bubble`; for explicitness, add the same line:

```css
.bubble-assistant {
  align-self: flex-start;
  background: var(--bg-elevated);
  color: var(--text);
  border-color: var(--border);
  border-radius: var(--r-md) var(--r-md) var(--r-md) 4px;
  max-width: min(640px, 85%);
}
```

e) `.bubble-system` already overrides to `max-width: 100%` — leave it alone.

f) `@media (max-width: 640px) { .bubble { max-width: 94%; } }` already exists — leave it alone; it correctly overrides our pixel cap on narrow screens because 94% beats `min(640px, 85%)` only when 94% < 85% which never holds; we still need to ensure the user/assistant overrides also degrade. Add:

```css
@media (max-width: 640px) {
  .conversation-shell { padding: 18px 18px 16px; }
  .panel-title h2 { font-size: 18px; }
  .bubble { max-width: 94%; }
  .bubble-user,
  .bubble-assistant { max-width: 94%; }
}
```

(Replace the existing `@media (max-width: 640px)` block with the above so the role-specific overrides also degrade on narrow screens.)

- [ ] **Step 3: Verify in browser — wide viewport**

In a 1440px viewport, send a long user message (paste a paragraph) and wait for assistant reply.
Expected (measure in DevTools):
- User bubble visual width ≤ 520px and right-aligned.
- Assistant bubble visual width ≤ 640px and left-aligned.
- System (error) bubble still spans the full chat column.
- Vertical gap between bubbles ≈ 14px.

- [ ] **Step 4: Verify in browser — narrow viewport**

Resize window to ≤ 640px (or DevTools mobile preview).
Expected: both user and assistant bubbles fall back to 94% width.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ChatPanel.vue
git commit -m "feat(web): cap chat bubble widths per role (520/640/full)"
```

---

## Task 5: Delete bottom vertical resize handle and its state (Pain D, part 1)

**Files:**
- Modify: `apps/web/pages/index.vue` (script lines ~55-180 + template lines ~547-605)
- Modify: `apps/web/assets/css/main.css:1041-1098` (delete `.resizable-panel*` + `.panel-resize-handle` blocks)

- [ ] **Step 1: Delete the bottom resize handle from the template**

In `apps/web/pages/index.vue`, remove the entire block:

```vue
<button
  type="button"
  class="panel-resize-handle"
  aria-label="调整下方工作区高度"
  @pointerdown="startMainSectionResize"
/>
```

(Currently lines ~599–604.)

- [ ] **Step 2: Replace `.resizable-panel-main` wrapper with `<section class="main-section">`**

In the same template, replace:

```vue
<div
  ref="mainSectionRef"
  class="resizable-panel resizable-panel-main"
  :class="{ 'is-resizing': isResizingMainSection }"
  :style="mainSectionStyle"
>
  <section ref="mainSplitRef" class="main-grid" ...>
    ...
  </section>

  <!-- bottom resize handle button (already removed in Step 1) -->
</div>
```

with:

```vue
<section class="main-section">
  <section
    ref="mainSplitRef"
    class="main-grid"
    :class="{ 'is-single-panel': !hasPlanArtifact }"
    :style="mainGridStyle"
  >
    <!-- (unchanged inner content from Task 1) -->
  </section>
</section>
```

(Outer `<section class="main-section">` replaces the resizable wrapper. `mainSectionRef` and `mainSectionStyle` bindings are gone.)

- [ ] **Step 3: Delete dead script symbols**

In `apps/web/pages/index.vue` `<script setup lang="ts">`, delete these lines (paths approximate; search by name):

- `const mainSectionRef = ref<HTMLElement | null>(null)`
- `const mainSectionHeight = ref<number | null>(null)`
- `const isResizingMainSection = ref(false)`
- `const MAIN_SECTION_MIN_HEIGHT = 360`
- `const mainSectionStyle = computed(...)` (the whole computed)
- function `availableMainSectionHeight()`
- function `clampMainSectionHeight(value: number)`
- function `startMainSectionResize(event: PointerEvent)`

Then update these:

a) `function clearResizeState()` — delete the `isResizingMainSection.value = false` line. Resulting body:

```ts
function clearResizeState() {
  isResizingSplit.value = false
  document.body.classList.remove("is-panel-resizing")
}
```

b) `function syncPanelLayoutBounds()` — delete the trailing `if (mainSectionHeight.value !== null) { mainSectionHeight.value = clampMainSectionHeight(...) }` block. Resulting body:

```ts
function syncPanelLayoutBounds() {
  if (!import.meta.client || window.innerWidth <= 980) {
    return
  }

  leftPanelWidth.value = clampLeftPanelPercent(leftPanelWidth.value)
}
```

c) `function readStoredPanelLayout()` — delete the `mainSectionHeight` block; tolerate the field if present (just ignore it). Resulting body:

```ts
function readStoredPanelLayout() {
  if (!import.meta.client) return

  const raw = window.sessionStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw) as {
      leftPanelWidth?: number
    }

    if (typeof parsed.leftPanelWidth === "number") {
      leftPanelWidth.value = parsed.leftPanelWidth
    }
  } catch {
    window.sessionStorage.removeItem(PANEL_LAYOUT_STORAGE_KEY)
  }
}
```

d) `function writeStoredPanelLayout()` — write only `leftPanelWidth`:

```ts
function writeStoredPanelLayout() {
  if (!import.meta.client) return

  window.sessionStorage.setItem(
    PANEL_LAYOUT_STORAGE_KEY,
    JSON.stringify({
      leftPanelWidth: leftPanelWidth.value,
    }),
  )
}
```

- [ ] **Step 4: Delete dead CSS**

In `apps/web/assets/css/main.css`, delete these blocks (currently lines ~1041–1098):

- The `/* Resizable panels (kept for conversation mode) */` comment.
- `.resizable-panel { ... }`
- `.resizable-panel > .main-grid { ... }`
- `.resizable-panel-main { ... }`
- `.resizable-panel.is-resizing .panel-resize-handle::before { ... }`
- `.panel-resize-handle { ... }`
- `.panel-resize-handle::before { ... }`
- `.resizable-panel-main .panel-resize-handle { bottom: 2px; }`
- `.resizable-panel:hover .panel-resize-handle::before, .panel-resize-handle:hover::before { ... }`

Keep `body.is-panel-resizing { user-select: none; }` (still used during horizontal divider drag).

Add a minimal `.main-section` rule (replaces `.resizable-panel-main { flex: 1; padding-bottom: 18px; }`):

```css
.main-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-bottom: 18px;
}
```

- [ ] **Step 5: Verify — DOM clean**

Reload conversation mode. In DevTools:
- No element has class `panel-resize-handle`.
- No element has class `resizable-panel` or `resizable-panel-main`.
- The wrapper around `.main-grid` is `<section class="main-section">`.

- [ ] **Step 6: Verify — horizontal split still works**

Drag the middle divider (when a plan exists): split percentage updates and persists in sessionStorage (`travel-agent-panel-layout` value should be `{"leftPanelWidth":...}` only, no `mainSectionHeight`).

- [ ] **Step 7: Verify — backwards compat with old sessionStorage**

In DevTools, set `sessionStorage["travel-agent-panel-layout"] = '{"leftPanelWidth":48,"mainSectionHeight":520}'` then reload.
Expected: page loads without error; `leftPanelWidth` honored at 48%; `mainSectionHeight` silently ignored.

- [ ] **Step 8: Commit**

```bash
git add apps/web/pages/index.vue apps/web/assets/css/main.css
git commit -m "refactor(web): drop vertical resize handle + dead state"
```

---

## Task 6: Hide middle divider grip until hover (Pain D, part 2)

**Files:**
- Modify: `apps/web/assets/css/main.css:1134-1177`

- [ ] **Step 1: Soften default track color**

In `apps/web/assets/css/main.css`, find:

```css
.main-grid-divider-track {
  position: absolute;
  left: 50%;
  top: 16px;
  bottom: 16px;
  width: 1px;
  background: var(--border);
  transform: translateX(-50%);
  transition: background-color var(--dur-fast) var(--ease-out);
}
```

Change `background: var(--border);` to `background: var(--border-subtle-2);`.

- [ ] **Step 2: Default-hide the grip pill**

Replace the existing `.main-grid-divider-grip { ... }` block with:

```css
.main-grid-divider-grip {
  position: absolute;
  left: 50%;
  top: 50%;
  display: inline-flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  padding: 8px 6px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transform: translate(-50%, -50%);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
```

(Added `opacity: 0; pointer-events: none;` and `opacity` to the transition list.)

- [ ] **Step 3: Show grip on hover / resize**

The existing rule:

```css
.main-grid-divider:hover .main-grid-divider-grip,
.main-grid-divider.is-resizing .main-grid-divider-grip {
  border-color: var(--brand-blue);
}
```

Append `opacity: 1;` to that block so it becomes:

```css
.main-grid-divider:hover .main-grid-divider-grip,
.main-grid-divider.is-resizing .main-grid-divider-grip {
  border-color: var(--brand-blue);
  opacity: 1;
}
```

- [ ] **Step 4: Verify in browser**

Generate a plan so the divider is present.

Expected:
- Default state: only a faint vertical 1px line in `--border-subtle-2`; no grip pill.
- On hover: grip pill fades in (opacity 0 → 1) with brand-blue border; track becomes brand-blue (already handled by existing `:hover` rule on the track).
- During drag: grip stays visible until pointer up.

- [ ] **Step 5: Commit**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): de-emphasize divider — hide grip until hover"
```

---

## Task 7: Final verification — build, browser walk-through

**Files:** none modified unless build flags an issue.

- [ ] **Step 1: Type-check & build**

Run: `pnpm build:web`
Expected: build succeeds with no new warnings/errors.

If errors point at deleted symbols (e.g. `mainSectionRef` referenced from a leftover binding), fix the offending reference and amend the relevant task's commit (or add a follow-up commit).

- [ ] **Step 2: Browser walk-through (1440 viewport)**

Run `pnpm dev` and walk through:

1. Land on `/` (logged-in landing). **Expected:** tagline visible, topbar ~92px, hero card layout unchanged.
2. Submit prompt → conversation mode. **Expected:** topbar collapses to ≤ 56px, no tagline; only chat panel visible (no right panel because plan still planning); no middle divider; no bottom resize handle anywhere.
3. Plan arrives. **Expected:** right panel mounts; default split ≈ 42/58; middle divider faintly visible without grip.
4. Hover divider. **Expected:** grip pill fades in with brand-blue border.
5. Drag divider. **Expected:** ratio updates live, sessionStorage `travel-agent-panel-layout` only contains `leftPanelWidth`.
6. Send a message that errors (stop API). **Expected:** error appears as a system bubble in chat; right panel does NOT remount independently for the error.
7. Resize window to ≤ 980px. **Expected:** mobile breakpoint kicks in (existing behavior); no regressions.
8. Resize window to ≤ 640px. **Expected:** bubbles cap at 94% width.

- [ ] **Step 3: Commit (only if walk-through required fix-ups)**

If steps 1–2 of this task introduced any change, commit:

```bash
git add -A
git commit -m "fix(web): polish workspace layout fixes"
```

Otherwise, no commit needed for Task 7.

---

## Self-Review

Spec coverage check (sections in `2026-04-25-workspace-layout-fixes-design.md`):

- §3.1 (Pain A: `hasPlanArtifact` + conditional render + ratio) → Tasks 1, 2 ✓
- §3.2 (Pain B: tagline `v-if="isLanding"`, conversation topbar collapse) → Task 3 ✓
- §3.3 (Pain C: bubble max-width per role + gap) → Task 4 ✓
- §3.4 (Pain D part 1: delete bottom resize handle + state + sessionStorage compat) → Task 5 ✓
- §3.4 (Pain D part 2: hide middle grip + soften track) → Task 6 ✓
- §3.5 (ReAct/Clarify/MaxIter unchanged) → No task needed (deliberately not modified) ✓
- §4 (acceptance) → Task 7 walk-through ✓

No placeholders. Symbol names (`hasPlanArtifact`, `is-single-panel`, `main-section`, `mainSectionHeight` deletion list) are consistent across tasks.
