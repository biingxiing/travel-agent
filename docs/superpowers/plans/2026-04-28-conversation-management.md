# Conversation Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent history sidebar with a "新建行程" button, and fix backend context so loading a history session and sending a new message refines the existing plan instead of starting from scratch.

**Architecture:** Frontend restructures `index.vue` into a sidebar + main-content flex layout; `TripHistoryGrid` gains `variant` and `activeSessionId` props for list display. Backend fixes `buildOrchestratorMessages` to use two system messages (prompt + session state) followed by real multi-turn conversation history; extractor receives a `latestMessage` field so intent is classified from the newest message rather than the full history blob.

**Tech Stack:** Vue 3, Nuxt 3, Pinia, Hono, Vitest, TypeScript, OpenAI-compatible SDK

---

## File Map

| File | Change |
|---|---|
| `apps/web/components/TripHistoryGrid.vue` | Add `variant` + `activeSessionId` props; list mode CSS |
| `apps/web/pages/index.vue` | Add sidebar layout; move TripHistoryGrid into sidebar |
| `apps/api/src/agents/tools/index.ts` | Rewrite `buildOrchestratorMessages` |
| `apps/api/src/agents/tools/index.test.ts` | New file — unit tests for `buildOrchestratorMessages` |
| `apps/api/src/agents/extractor.ts` | Add `latestMessage` field; update SYSTEM_PROMPT |
| `apps/api/src/agents/extractor.test.ts` | Add test for `latestMessage` intent classification |

---

## Task 1 — TripHistoryGrid: variant + activeSessionId props

**Files:**
- Modify: `apps/web/components/TripHistoryGrid.vue`

> No Vitest for Vue components — verify visually after Task 2.

- [ ] **Step 1: Add props and class bindings**

Replace the opening `<script setup>` block in `apps/web/components/TripHistoryGrid.vue`. Find this section (lines 1–28):

```typescript
// BEFORE — lines 10-13
const emit = defineEmits<{
  select: [entry: TripHistoryEntry]
  remove: [entry: TripHistoryEntry]
}>()
```

Replace with:

```typescript
interface Props {
  variant?: 'grid' | 'list'
  activeSessionId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'grid',
  activeSessionId: null,
})

const emit = defineEmits<{
  select: [entry: TripHistoryEntry]
  remove: [entry: TripHistoryEntry]
}>()
```

- [ ] **Step 2: Update template root and history-grid class**

Find this line in the template:
```html
<section class="trip-history">
```
Replace with:
```html
<section class="trip-history" :class="{ 'trip-history--list': props.variant === 'list' }">
```

Find:
```html
<div v-else class="history-grid">
```
Replace with:
```html
<div v-else class="history-grid">
```
(no change here — the grid div stays; styling is controlled by the parent class)

Find the `<Motion ... class="history-card"` line and add `:class`:
```html
<Motion
  v-for="(entry, index) in entries"
  :key="entry.sessionId"
  tag="article"
  :initial="{ y: 8, opacity: 0 }"
  :animate="{ y: 0, opacity: 1 }"
  :transition="{ duration: 0.32, ease: [0.2, 0.7, 0.25, 1], delay: Math.min(index * 0.04, 0.24) }"
  class="history-card"
  :class="{ 'is-active': entry.sessionId === props.activeSessionId }"
  role="button"
  tabindex="0"
  @click="onSelect(entry)"
  @keydown.enter.prevent="onSelect(entry)"
  @keydown.space.prevent="onSelect(entry)"
>
```

- [ ] **Step 3: Add list-mode layout inside the card**

The current card body shows a `history-band` (color strip at top) followed by `history-body`. In list mode we want a compact row with a 4px left strip instead. Add a conditional band element before the existing `history-band`:

Find inside the `<Motion>` article:
```html
<div
  class="history-band"
  :style="{ background: destinationColor(entry.destination || entry.title) }"
/>
```
Replace with:
```html
<div
  v-if="props.variant !== 'list'"
  class="history-band"
  :style="{ background: destinationColor(entry.destination || entry.title) }"
/>
<div
  v-else
  class="history-strip"
  :style="{ background: destinationColor(entry.destination || entry.title) }"
/>
```

- [ ] **Step 4: Add list-mode CSS to the `<style scoped>` block**

Append before the closing `</style>` tag:

```css
/* ── list variant ── */
.trip-history--list .history-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trip-history--list .history-card {
  flex-direction: row;
  align-items: center;
  border-radius: var(--r-md);
  min-height: 48px;
}

.history-strip {
  width: 4px;
  align-self: stretch;
  flex-shrink: 0;
  border-radius: var(--r-xs) 0 0 var(--r-xs);
}

.trip-history--list .history-body {
  padding: 8px 12px 8px 10px;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.trip-history--list .history-dest {
  font-size: var(--type-body-sm-size);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.trip-history--list .history-meta {
  gap: 8px;
  font-size: 11px;
}

.history-card.is-active {
  background: color-mix(in srgb, var(--brand-blue) 8%, var(--bg-elevated));
  border-color: color-mix(in srgb, var(--brand-blue) 30%, var(--border));
}

/* hide remove button on list variant to save space; show on hover */
.trip-history--list .history-remove {
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.trip-history--list .history-card:hover .history-remove {
  opacity: 1;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/TripHistoryGrid.vue
git commit -m "feat(web): add variant=list and activeSessionId props to TripHistoryGrid"
```

---

## Task 2 — index.vue: persistent sidebar layout

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Add Plus import and sidebarOpen ref**

In the `<script setup>` block, find the lucide import line:
```typescript
import { ChevronDown, History, LogOut, Settings, User } from "lucide-vue-next"
```
Replace with:
```typescript
import { ChevronDown, History, LogOut, Menu, Plus, Settings, User } from "lucide-vue-next"
```

After the line `const logoutPending = ref(false)`, add:
```typescript
const sidebarOpen = ref(false)
```

- [ ] **Step 2: Rename returnToLanding to startNewConversation**

Find the function:
```typescript
function returnToLanding() {
  chatStore.resetConversation()
  workspaceStore.reset()
  stream.setSessionId(null)
  workspaceStore.persistState()
}
```
Replace with:
```typescript
function startNewConversation() {
  chatStore.resetConversation()
  workspaceStore.reset()
  stream.setSessionId(null)
  workspaceStore.persistState()
  sidebarOpen.value = false
}
```

Also update every call site. Find:
```typescript
@click="returnToLanding"
```
Replace all occurrences with:
```typescript
@click="startNewConversation"
```

And in `submitLogout`:
```typescript
chatStore.resetConversation()
workspaceStore.reset()
stream.setSessionId(null)
workspaceStore.persistState()
```
(No rename needed there — that block stays as-is.)

- [ ] **Step 3: Wrap page body in sidebar + main layout**

In the `<template>`, find the `<template v-if="isLanding">` block and the `<template v-else>` block (everything after the `<header>`). Wrap them together in a new `.page-body` div that also contains the sidebar.

The current structure after `</header>` is:
```html
    <template v-if="isLanding">
      <div class="landing-stack">
        <HeroPlannerCard :loading="phase === 'planning'" @submit="submitPrompt" />
        <TripHistoryGrid @select="loadHistoryEntry" />
      </div>
    </template>

    <template v-else>
      <!-- ... ReAct cards + main-section ... -->
    </template>
```

Replace it with:
```html
    <div class="page-body">
      <!-- Sidebar -->
      <aside
        class="history-sidebar"
        :class="{ 'is-open': sidebarOpen }"
      >
        <button
          type="button"
          class="sidebar-new-btn"
          @click="startNewConversation"
        >
          <Plus :size="14" :stroke-width="2" />
          新建行程
        </button>
        <TripHistoryGrid
          variant="list"
          :active-session-id="workspaceSessionId"
          @select="loadHistoryEntry"
        />
      </aside>

      <!-- Overlay for mobile -->
      <div
        v-if="sidebarOpen"
        class="sidebar-overlay"
        @click="sidebarOpen = false"
      />

      <!-- Main content -->
      <div class="page-main">
        <template v-if="isLanding">
          <div class="landing-stack">
            <HeroPlannerCard :loading="phase === 'planning'" @submit="submitPrompt" />
          </div>
        </template>

        <template v-else>
          <!-- ReAct loop UI (mutually exclusive) -->
          <ReactProgressBar
            v-if="loopStatus"
            :loop-status="loopStatus"
            :iteration="iteration"
            :max-iterations="maxIterations"
            :display-score="displayScore"
            :target-score="targetScore"
          />
          <ClarifyCard
            v-else-if="awaitingClarify"
            :question="awaitingClarify.question"
            :reason="awaitingClarify.reason"
            :default-suggestion="awaitingClarify.defaultSuggestion"
            @use-default="onUseDefault"
          />
          <MaxIterCard
            v-else-if="canContinue && maxIterReached"
            :max-iterations="maxIterations"
            :current-score="maxIterReached.currentScore"
            :target-score="targetScore"
            @continue="onContinue"
          />

          <section class="main-section">
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
          </section>
        </template>
      </div>
    </div>
```

- [ ] **Step 4: Add hamburger button in header for mobile**

Find in the `<header class="page-topbar">` → `<div class="page-topbar-brand">`, after the closing `</div>` of the brand div but still inside `<header>`:

Find:
```html
      <div class="page-topbar-actions">
```
Replace with:
```html
      <button
        type="button"
        class="sidebar-hamburger"
        aria-label="打开历史记录"
        @click="sidebarOpen = !sidebarOpen"
      >
        <Menu :size="18" :stroke-width="1.75" />
      </button>

      <div class="page-topbar-actions">
```

- [ ] **Step 5: Add sidebar CSS to `<style scoped>`**

Find the existing `.landing-stack` CSS block. Replace:
```css
.landing-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 8px 0 40px;
}
```
With:
```css
.page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.history-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 8px;
  overflow-y: auto;
  background: var(--bg);
}

.sidebar-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.sidebar-new-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-surface);
}

.page-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.landing-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 8px 0 40px;
}

.sidebar-hamburger {
  display: none;
  appearance: none;
  background: transparent;
  border: 0;
  padding: 4px;
  cursor: pointer;
  color: var(--text);
}

.sidebar-overlay {
  display: none;
}

@media (max-width: 768px) {
  .history-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 200;
    width: 280px;
    transform: translateX(-100%);
    transition: transform 0.22s var(--ease-out);
    box-shadow: var(--shadow-xl);
  }
  .history-sidebar.is-open {
    transform: translateX(0);
  }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 199;
    background: rgba(0,0,0,0.3);
  }
  .sidebar-hamburger {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

Also remove the existing mobile media query for `.landing-stack` if it exists:
```css
@media (max-width: 640px) {
  .landing-stack { gap: 22px; padding-bottom: 24px; }
}
```
Replace with:
```css
@media (max-width: 640px) {
  .landing-stack { gap: 22px; padding-bottom: 24px; }
  .page-topbar-brand { gap: 4px; }
}
```

- [ ] **Step 5b: Update loadHistoryEntry for 404 handling and mobile close**

In `apps/web/pages/index.vue`, find the existing `loadHistoryEntry` function:

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
    console.error("[loadHistoryEntry] failed", err)
  }
}
```

Replace with:

```typescript
async function loadHistoryEntry(entry: TripHistoryEntry) {
  sidebarOpen.value = false
  try {
    const { session } = await stream.loadSession(entry.sessionId)
    stream.setSessionId(session.id)
    workspaceStore.hydrateFromSession(session)
    workspaceStore.persistState()
    chatStore.hydrateFromSessionMessages(session.messages)
    chatStore.setSession(session.id)
  } catch (err) {
    const isNotFound = err instanceof Error && err.message.includes('404')
    if (isNotFound) {
      $toast.error("该行程已失效，可能是服务重启导致，请重新规划。")
      const { remove } = useTripHistory()
      remove(entry.sessionId)
    } else {
      console.error("[loadHistoryEntry] failed", err)
      $toast.error("加载行程失败，请稍后再试。")
    }
  }
}
```

- [ ] **Step 6: Start dev server and verify visually**

```bash
pnpm dev
```

Check:
- [ ] Landing page: sidebar visible on left, "+ 新建行程" button + history list, HeroPlannerCard in main area (no TripHistoryGrid below it)
- [ ] Conversation page: sidebar still visible, active session highlighted in list
- [ ] Clicking "+ 新建行程" resets to landing
- [ ] Clicking a history entry loads it (active highlight updates)
- [ ] Mobile (resize browser to < 768px): sidebar hidden, hamburger appears, tap opens drawer, selecting entry closes drawer

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): add persistent history sidebar with new-conversation button"
```

---

## Task 3 — buildOrchestratorMessages: dual system + multi-turn history

**Files:**
- Create: `apps/api/src/agents/tools/index.test.ts`
- Modify: `apps/api/src/agents/tools/index.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/agents/tools/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildOrchestratorMessages } from './index.js'
import type { SessionState } from '@travel-agent/shared'

function baseSession(): SessionState {
  return {
    id: 's1', userId: 'u1', title: null, brief: null,
    messages: [], currentPlan: null, currentScore: null, status: 'draft',
    iterationCount: 0, lastRunId: null, pendingClarification: null,
    prefetchContext: [], language: 'zh',
    createdAt: 1, updatedAt: 1,
  }
}

describe('buildOrchestratorMessages', () => {
  it('produces exactly two system messages before conversation history', () => {
    const msgs = buildOrchestratorMessages(baseSession())
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('system')
    const stateMsg = msgs[1] as { role: string; content: string }
    expect(stateMsg.content).toContain('Session state:')
  })

  it('includes currentPlan in the state system message', () => {
    const session = baseSession()
    session.currentPlan = {
      title: 'test', destinations: ['北京'], days: 3, travelers: 1,
      pace: 'balanced', preferences: [], dailyPlans: [], tips: [], disclaimer: '',
    }
    const msgs = buildOrchestratorMessages(session)
    const stateContent = (msgs[1] as { content: string }).content
    expect(stateContent).toContain('"hasCurrentPlan":true')
    expect(stateContent).toContain('"currentPlan"')
  })

  it('appends user+assistant conversation as proper turns', () => {
    const session = baseSession()
    session.messages = [
      { role: 'user', content: '去上海3天', timestamp: 1 },
      { role: 'assistant', content: '已生成方案', timestamp: 2 },
      { role: 'user', content: '改一下第2天', timestamp: 3 },
    ]
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(5)
    expect(msgs[2]).toEqual({ role: 'user', content: '去上海3天' })
    expect(msgs[3]).toEqual({ role: 'assistant', content: '已生成方案' })
    expect(msgs[4]).toEqual({ role: 'user', content: '改一下第2天' })
  })

  it('limits conversation history to 20 messages', () => {
    const session = baseSession()
    session.messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `msg ${i}`,
      timestamp: i,
    }))
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(22) // 2 system + 20 conversation
  })

  it('filters out empty/whitespace-only messages', () => {
    const session = baseSession()
    session.messages = [
      { role: 'user', content: '去北京', timestamp: 1 },
      { role: 'assistant', content: '   ', timestamp: 2 },
      { role: 'user', content: '3天', timestamp: 3 },
    ]
    const msgs = buildOrchestratorMessages(session)
    expect(msgs).toHaveLength(4) // 2 system + 2 non-empty
    expect(msgs[3]).toEqual({ role: 'user', content: '3天' })
  })

  it('no longer puts user messages in a single flat blob', () => {
    const session = baseSession()
    session.messages = [{ role: 'user', content: '北京 3 天', timestamp: 1 }]
    const msgs = buildOrchestratorMessages(session)
    // Old format would be a single user message containing "User messages:"
    const hasOldFormat = msgs.some(m =>
      m.role === 'user' && typeof m.content === 'string' && m.content.includes('User messages:')
    )
    expect(hasOldFormat).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/index.test.ts
```

Expected: FAIL — tests checking `msgs[1].content` to contain `'Session state:'` fail because current code uses old format.

- [ ] **Step 3: Rewrite buildOrchestratorMessages in index.ts**

In `apps/api/src/agents/tools/index.ts`, find the `buildOrchestratorMessages` function (currently lines 43–69) and replace it entirely:

```typescript
export function buildOrchestratorMessages(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const stateContext = JSON.stringify({
    hasBrief: !!session.brief,
    brief: session.brief,
    hasCurrentPlan: !!session.currentPlan,
    currentPlan: session.currentPlan,
    currentScore: session.currentScore,
    language: session.language ?? 'zh',
    iterationCount: session.iterationCount,
    status: session.status,
    prefetchContextSize: session.prefetchContext?.length ?? 0,
  })

  const conversationHistory = session.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    { role: 'system', content: `Session state:\n${stateContext}` },
    ...conversationHistory,
  ]
}
```

- [ ] **Step 4: Run new tests + full API test suite**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/tools/index.test.ts
pnpm test:api
```

Expected: All pass. The existing `react-loop.test.ts` tests don't assert on message structure passed to `loggedStream`, so they continue to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/tools/index.test.ts apps/api/src/agents/tools/index.ts
git commit -m "fix(api): rewrite buildOrchestratorMessages with dual system + multi-turn history"
```

---

## Task 4 — Extractor: latestMessage for intent classification

**Files:**
- Modify: `apps/api/src/agents/extractor.ts`
- Modify: `apps/api/src/agents/extractor.test.ts`

- [ ] **Step 1: Write failing test**

Open `apps/api/src/agents/extractor.test.ts` and add this test inside the `describe` block, after the existing tests:

```typescript
  it('passes latestMessage separately so intent comes from newest message only', async () => {
    ;(loggedCompletion as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destinations: ['北京'], days: 4 },
        intent: 'refine',
        changedFields: ['days'],
      })}}],
    })

    await extractBrief([
      { role: 'user', content: '我想去北京3天', timestamp: 1 },
      { role: 'user', content: '改成4天吧', timestamp: 2 },
    ], { destinations: ['北京'], days: 3, travelers: 1, preferences: [] })

    const callParams = (loggedCompletion as any).mock.calls[0][1]
    const userMsgContent: string = callParams.messages[1].content
    expect(userMsgContent).toContain('allMessages:')
    expect(userMsgContent).toContain('latestMessage:')
    // latestMessage should be only the last message
    const latestSection = userMsgContent.split('latestMessage:')[1]
    expect(latestSection).toContain('改成4天吧')
    expect(latestSection).not.toContain('我想去北京3天')
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/extractor.test.ts
```

Expected: FAIL — `userMsgContent` currently contains `userMessages:` not `allMessages:` / `latestMessage:`.

- [ ] **Step 3: Update extractor.ts — LLM message structure**

In `apps/api/src/agents/extractor.ts`, find the LLM messages construction (lines 86–93):

```typescript
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nuserMessages:\n${userInput}`,
    },
  ]
```

Replace `userInput` variable declaration (line 84) and the llmMessages block:

```typescript
  const allUserText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n')
  const latestUserText = messages.filter((m) => m.role === 'user').at(-1)?.content ?? allUserText

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nallMessages:\n${allUserText}\n\nlatestMessage:\n${latestUserText}`,
    },
  ]
```

Also update the regex fallback line that used `userInput` — find:
```typescript
  const fallback = regexFallback(userInput)
```
Replace with:
```typescript
  const fallback = regexFallback(allUserText)
```

- [ ] **Step 4: Update SYSTEM_PROMPT in extractor.ts**

Find in `SYSTEM_PROMPT` the intent section:
```
Intent classification rules:
- User describes a trip for the first time ("go to X for N days") → "new"
- User answers a previous clarifying question ("departing from Shanghai") → "clarify-answer"
- User modifies an existing plan ("change the hotel", "add one more day") → "refine"
- User asks to continue optimizing ("keep refining", "try again") → "continue"

Merge rules: preserve unchanged fields from existingBrief; overwrite only the fields the user explicitly changed.`
```

Replace with:
```
Intent classification rules:
- User describes a trip for the first time ("go to X for N days") → "new"
- User answers a previous clarifying question ("departing from Shanghai") → "clarify-answer"
- User modifies an existing plan ("change the hotel", "add one more day") → "refine"
- User asks to continue optimizing ("keep refining", "try again") → "continue"
Determine intent from latestMessage only, not from the full message history.

Merge rules: preserve unchanged fields from existingBrief; overwrite only the fields the user explicitly changed. Use allMessages for brief field merging.`
```

- [ ] **Step 5: Run extractor tests**

```bash
pnpm --filter @travel-agent/api exec vitest run src/agents/extractor.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 6: Run full API test suite**

```bash
pnpm test:api
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/extractor.ts apps/api/src/agents/extractor.test.ts
git commit -m "fix(api): use latestMessage for intent classification in extractor"
```

---

## Task 5 — End-to-end smoke check

- [ ] **Step 1: Start the full stack**

```bash
pnpm dev
```

- [ ] **Step 2: New conversation flow**
  - Open `http://localhost:3000`
  - Verify sidebar shows "+ 新建行程" and history list
  - Type a trip request in HeroPlannerCard, submit, wait for plan
  - Verify new entry appears in sidebar, highlighted as active

- [ ] **Step 3: History continuation flow**
  - Reload the page (sidebar should still show the entry)
  - Click the history entry → chat and plan preview should restore
  - Type a follow-up message (e.g., "把第2天改成博物馆参观") and submit
  - Verify the response modifies the existing plan rather than starting fresh
  - Check API server logs — should show `[Extractor] intent=refine`

- [ ] **Step 4: New conversation from sidebar**
  - While in a conversation, click "+ 新建行程"
  - Verify UI resets to landing, active highlight clears in sidebar

- [ ] **Step 5: Run full test suite one final time**

```bash
pnpm -r test
```

Expected: All pass.

- [ ] **Step 6: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix(web/api): conversation management — sidebar + history context"
```
