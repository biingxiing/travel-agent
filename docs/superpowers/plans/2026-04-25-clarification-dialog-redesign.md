# Clarification Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded clarification strings with LLM-generated conversational questions. Add a "按默认走" chip to every clarification that has a sensible default (days: 5, travel dates: today+7). Add a Phase 0.5 check that asks for travel dates when they are missing.

**Architecture:** A new `clarifier.ts` agent generates natural question text + a concrete `defaultSuggestion` string. The `clarify_needed` event gains an optional `defaultSuggestion` field. `ClarifyCard.vue` renders the chip; clicking sends the suggestion text as a normal user message, which the extractor handles as a `clarify-answer` intent.

**Tech Stack:** TypeScript, Vitest, Vue 3 / Nuxt 3, Zod

**Prerequisite:** Multi-Destination refactor (Plan C) should be applied first, since this plan uses `destinations[]` from `TripBrief`.

---

## File Map

| Action | File | Change |
|---|---|---|
| Modify | `packages/shared/src/events.ts` | Add `defaultSuggestion?: string` to `clarify_needed` |
| Create | `apps/api/src/agents/clarifier.ts` | LLM-powered question + default generator |
| Create | `apps/api/src/agents/clarifier.test.ts` | 4 unit tests |
| Modify | `apps/api/src/agents/react-loop.ts` | Call clarifier; add Phase 0.5 |
| Modify | `apps/web/stores/chat.ts` | Extend `awaitingClarify` type |
| Modify | `apps/web/components/react/ClarifyCard.vue` | Add chip button |
| Modify | `apps/web/pages/index.vue` | Handle `use-default` event |

---

### Task 1: Extend `clarify_needed` event schema

**Files:**
- Modify: `packages/shared/src/events.ts`

- [ ] **Step 1: Add `defaultSuggestion` field**

Find the `clarify_needed` schema object (around line 83):

```ts
// before:
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
  }),
```
```ts
// after:
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
    defaultSuggestion: z.string().optional(),
  }),
```

- [ ] **Step 2: Build shared package**

```bash
cd packages/shared && pnpm build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/events.ts
git commit -m "feat(shared): add defaultSuggestion to clarify_needed event"
```

---

### Task 2: Write failing tests for `clarifier.ts`

**Files:**
- Create: `apps/api/src/agents/clarifier.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
import { generateClarification } from './clarifier.js'

const emptyBrief = { destinations: [], days: 0, travelers: 1, preferences: [] }
const briefWithDest = { destinations: ['成都'], days: 0, travelers: 1, preferences: [] }
const briefComplete = { destinations: ['成都'], days: 5, travelers: 1, preferences: [] }

beforeEach(() => vi.clearAllMocks())

describe('generateClarification', () => {
  it('missing destinations: returns non-empty question, null defaultSuggestion', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: '你想去哪里旅行？' } }],
    })
    const result = await generateClarification([], emptyBrief, 'missing_destination')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toBeNull()
  })

  it('missing days: returns non-empty question, defaultSuggestion includes "5"', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: '你打算玩几天？' } }],
    })
    const result = await generateClarification([], briefWithDest, 'missing_days')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toMatch(/5/)
  })

  it('missing dates: returns non-empty question, defaultSuggestion includes a date', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: '你打算什么时候出发？' } }],
    })
    const result = await generateClarification([], briefComplete, 'missing_dates')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('LLM failure: returns fallback string, does not throw', async () => {
    ;(llm.chat.completions.create as any).mockRejectedValue(new Error('network error'))
    const result = await generateClarification([], emptyBrief, 'missing_destination')
    expect(result.question).toBeTruthy()
    expect(result.defaultSuggestion).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
cd apps/api && pnpm test --run clarifier
```

Expected: `Error: Cannot find module './clarifier.js'`

---

### Task 3: Implement `clarifier.ts`

**Files:**
- Create: `apps/api/src/agents/clarifier.ts`

- [ ] **Step 1: Create the file**

```ts
import { llm, FAST_MODEL } from '../llm/client.js'
import type { Message, TripBrief } from '@travel-agent/shared'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

interface ClarifyResult {
  question: string
  defaultSuggestion: string | null
}

const FALLBACKS: Record<ClarifyReason, ClarifyResult> = {
  missing_destination: { question: '你想去哪里旅行？', defaultSuggestion: null },
  missing_days: { question: '你计划玩几天？', defaultSuggestion: '按 5 天规划' },
  missing_dates: { question: '你打算什么时候出发？', defaultSuggestion: null },
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
  if (brief.destinations?.length) parts.push(`目的地：${brief.destinations.join('、')}`)
  if (brief.days) parts.push(`${brief.days} 天`)
  if (brief.travelers && brief.travelers > 1) parts.push(`${brief.travelers} 人`)
  if (brief.originCity) parts.push(`从${brief.originCity}出发`)
  return parts.join('，') || '暂无'
}

export async function generateClarification(
  messages: Message[],
  brief: Partial<TripBrief>,
  reason: ClarifyReason,
): Promise<ClarifyResult> {
  const fieldLabel =
    reason === 'missing_destination' ? '目的地' :
    reason === 'missing_days' ? '出行天数' : '出发日期'

  const systemPrompt =
    `你是旅行规划助手。用户已知信息：${briefSummary(brief)}。` +
    `缺失字段：${fieldLabel}。` +
    `用一句口语化、温暖的中文问出这个字段。不超过20字，不重复用户已说过的内容。只输出问句。`

  let question: string = FALLBACKS[reason].question
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

  let defaultSuggestion: string | null = FALLBACKS[reason].defaultSuggestion
  if (reason === 'missing_dates') {
    const start = defaultStartDate()
    defaultSuggestion = `按 ${start} 出发规划`
  }

  return { question, defaultSuggestion }
}
```

- [ ] **Step 2: Run tests — verify they PASS**

```bash
cd apps/api && pnpm test --run clarifier
```

Expected: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/agents/clarifier.ts apps/api/src/agents/clarifier.test.ts
git commit -m "feat(clarifier): LLM-generated clarification questions with default suggestions"
```

---

### Task 4: Update `react-loop.ts` — call clarifier + Phase 0.5

**Files:**
- Modify: `apps/api/src/agents/react-loop.ts`

- [ ] **Step 1: Add import**

```ts
import { generateClarification } from './clarifier.js'
```

- [ ] **Step 2: Replace Phase 0 hardcoded clarification block**

Find (~lines 33–44):

```ts
  if (!isBriefMinimallyComplete(ext.brief)) {
    session.status = 'awaiting_user'
    session.pendingClarification = !ext.brief.destinations?.length
      ? '请告诉我目的地是哪里？'
      : '请告诉我打算玩几天？'
    yield {
      type: 'clarify_needed',
      question: session.pendingClarification,
      reason: !ext.brief.destinations?.length ? 'missing_destination' : 'missing_days',
    }
    return
  }
```

Replace with:

```ts
  if (!isBriefMinimallyComplete(ext.brief)) {
    const missingDest = !ext.brief.destinations?.length
    const reason = missingDest ? 'missing_destination' : 'missing_days'
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, reason,
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield {
      type: 'clarify_needed',
      question,
      reason,
      ...(defaultSuggestion !== null && { defaultSuggestion }),
    }
    return
  }
```

- [ ] **Step 3: Add Phase 0.5 — travelDates check**

After the `isBriefMinimallyComplete` block and before the `if (isCancelled(...))` check, insert:

```ts
  // Phase 0.5: ask for travel dates if missing
  if (!ext.brief.travelDates) {
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, 'missing_dates',
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield {
      type: 'clarify_needed',
      question,
      reason: 'missing_dates',
      ...(defaultSuggestion !== null && { defaultSuggestion }),
    }
    return
  }
```

- [ ] **Step 4: Build check**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/react-loop.ts
git commit -m "feat(react-loop): LLM clarification questions and Phase 0.5 travelDates check"
```

---

### Task 5: Update `chat.ts` store

**Files:**
- Modify: `apps/web/stores/chat.ts`

- [ ] **Step 1: Extend `awaitingClarify` type**

Find line ~128:

```ts
// before:
    awaitingClarify: null as { question: string; reason: string } | null,
```
```ts
// after:
    awaitingClarify: null as { question: string; reason: string; defaultSuggestion?: string } | null,
```

- [ ] **Step 2: Update `handleStreamEvent` case**

Find the `'clarify_needed'` case (~line 239):

```ts
// before:
        case 'clarify_needed':
          this.awaitingClarify = { question: event.question, reason: event.reason }
          this.canContinue = false
          ws.status = 'awaiting_user'
          break
```
```ts
// after:
        case 'clarify_needed':
          this.awaitingClarify = {
            question: event.question,
            reason: event.reason,
            defaultSuggestion: event.defaultSuggestion,
          }
          this.canContinue = false
          ws.status = 'awaiting_user'
          break
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/stores/chat.ts
git commit -m "feat(web/store): pass defaultSuggestion through awaitingClarify"
```

---

### Task 6: Update `ClarifyCard.vue` — add chip button

**Files:**
- Modify: `apps/web/components/react/ClarifyCard.vue`

- [ ] **Step 1: Replace the entire file**

```vue
<script setup lang="ts">
import { MessageCircleQuestion } from 'lucide-vue-next'

const props = defineProps<{
  question: string
  reason?: string
  defaultSuggestion?: string
}>()

const emit = defineEmits<{
  'use-default': [suggestion: string]
}>()
</script>

<template>
  <div class="clarify-card" role="dialog" aria-live="polite">
    <p class="clarify-kicker">
      <MessageCircleQuestion :size="14" :stroke-width="1.75" />
      需要补充信息
    </p>
    <p class="clarify-question">"{{ question }}"</p>
    <button
      v-if="defaultSuggestion"
      class="clarify-default-btn"
      type="button"
      @click="emit('use-default', defaultSuggestion!)"
    >
      {{ defaultSuggestion }}
    </button>
    <p class="clarify-hint">
      {{ reason || '在下方对话框中回复，方案会继续生成。' }}
    </p>
  </div>
</template>

<style scoped>
.clarify-card {
  background: var(--brand-blue-soft);
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
  animation: clarify-in 320ms var(--ease-out);
}
.clarify-kicker {
  margin: 0;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--brand-blue-deep);
  text-transform: uppercase;
}
.clarify-question {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}
.clarify-default-btn {
  align-self: flex-start;
  padding: 6px 14px;
  border: 1.5px solid var(--brand-blue);
  border-radius: var(--r-full, 999px);
  background: transparent;
  color: var(--brand-blue-deep);
  font-size: var(--type-body-sm-size);
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.clarify-default-btn:hover {
  background: var(--brand-blue);
  color: #fff;
}
.clarify-hint {
  margin: 0;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  line-height: 1.55;
}
@keyframes clarify-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .clarify-card { animation: none; }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/react/ClarifyCard.vue
git commit -m "feat(web): ClarifyCard chip button for default suggestion"
```

---

### Task 7: Update `index.vue` — handle `use-default`

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Find `ClarifyCard` usage (~line 481)**

```vue
<!-- before: -->
<ClarifyCard
  v-else-if="awaitingClarify"
  :question="awaitingClarify.question"
  :reason="awaitingClarify.reason"
/>
```
```vue
<!-- after: -->
<ClarifyCard
  v-else-if="awaitingClarify"
  :question="awaitingClarify.question"
  :reason="awaitingClarify.reason"
  :default-suggestion="awaitingClarify.defaultSuggestion"
  @use-default="onUseDefault"
/>
```

- [ ] **Step 2: Add `onUseDefault` handler in the script section**

The page already has `submitPrompt(value: string)` (~line 264) which handles the full send flow. Add after the `onContinue` handler:

```ts
function onUseDefault(suggestion: string) {
  submitPrompt(suggestion)
}
```

- [ ] **Step 3: Fix the robotic "已收到你的需求" close message**

In `submitPrompt`, find the `onClose` callback (~line 288):

```ts
// before:
      onClose: () => {
        chatStore.completePlannerResponse(
          currentPlan.value
            ? "已为你生成最新方案，右侧可以查看完整行程。"
            : "已收到你的需求，请继续补充信息。"
        )
      },
```
```ts
// after:
      onClose: () => {
        chatStore.completePlannerResponse(
          currentPlan.value
            ? "已为你生成最新方案，右侧可以查看完整行程。"
            : chatStore.awaitingClarify?.question ?? ""
        )
      },
```

This makes the chat bubble show the actual clarification question (same text as the ClarifyCard header), which feels like a natural conversational reply instead of the robotic fallback. When `awaitingClarify` is not set (e.g., stream closed without clarification), the bubble stays empty.

- [ ] **Step 4: Build web**

```bash
cd /Users/bill/travel-agent && pnpm build:web 2>&1 | tail -20
```

Expected: no TypeScript errors

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/bill/travel-agent && pnpm -r test --run
```

Expected: all tests PASS

- [ ] **Step 6: Final commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): submitPrompt for default chip; fix robotic onClose message"
```

---

### Task 8: Manual smoke test

- [ ] **Step 1: Start dev stack**

```bash
cd /Users/bill/travel-agent && pnpm dev
```

- [ ] **Step 2: Test missing days**

Send: `我想去成都`

Expected: ClarifyCard shows a natural question like "成都——好选择！你打算玩几天？" with a chip "按 5 天规划".

- [ ] **Step 3: Click the chip**

Click "按 5 天规划".

Expected: chat input submits "按 5 天规划" automatically, then a new ClarifyCard appears asking for travel dates with chip "按 YYYY-MM-DD 出发规划".

- [ ] **Step 4: Click date chip**

Click the date chip.

Expected: planning starts, agent_step events flow, plan appears in right panel.

- [ ] **Step 5: Test full input path**

Send: `我想去北京玩5天，5月10号出发` (has destination, days, and date).

Expected: no ClarifyCard appears — planning proceeds directly.
