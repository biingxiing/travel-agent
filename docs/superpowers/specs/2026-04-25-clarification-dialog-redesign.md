# Clarification Dialog Redesign — Design Spec

**Date:** 2026-04-25
**Scope:** `apps/api/src/agents/`, `packages/shared/src/events.ts`, `apps/web/`
**Status:** Approved

---

## Problem

The current clarification flow has two issues:

1. **Robotic question text.** When required fields are missing, `react-loop.ts` emits hardcoded strings (`'请告诉我目的地是哪里？'` / `'请告诉我打算玩几天？'`). These ignore what the user already said and feel mechanical.

2. **No default escape hatch.** Users who haven't decided on certain details (days, travel dates) are blocked with no alternative. They should be able to say "just use a sensible default and start planning."

**Fix:** A new `clarifier` agent generates LLM-powered, context-aware question text. Every clarification now includes an optional "如果还没想好，可以按 XXX 来规划" chip. Clicking the chip sends the default as a normal user message, applying it through the existing extractor flow.

---

## Architecture

### New file: `apps/api/src/agents/clarifier.ts`

```
clarifier(messages: Message[], brief: Partial<TripBrief>, reason: BlockerType | 'missing_dates')
  → { question: string, defaultSuggestion: string | null }
```

- Uses `FAST_MODEL` with a short system prompt (≤ 30 words output target).
- `question` — natural, warm, context-aware Chinese. Acknowledges what the user already said. E.g., if destination is known: "成都——不错的选择！你打算玩几天？"
- `defaultSuggestion` — a complete, actionable string the frontend can send verbatim as the next user message:
  - `missing_days` → `"按 5 天规划"`
  - `missing_dates` → `"按 {YYYY-MM-DD} 出发规划"` (API computes: today + 7 days as start)
  - `missing_destinations` → `null` (no sensible default for destination)
- On LLM failure: falls back to pre-set Chinese strings, never throws.

**Clarifier system prompt:**
```
你是旅行规划助手。用户正在规划行程，已知信息：{brief_summary}。缺失字段：{field}。
用一句口语化、温暖的中文问出这个字段。不超过20字，不重复用户已说过的内容。
只输出问句，不要其他内容。
```

---

### `react-loop.ts` changes

**Phase 0 (required fields missing) — replaces hardcoded strings:**

```ts
const ext = await withLLMContext(
  { sessionId: session.id, runId, agent: 'extractor' },
  () => extractBrief(session.messages, session.brief),
)
session.brief = ext.brief

if (!isBriefMinimallyComplete(ext.brief)) {
  const { question, defaultSuggestion } = await clarifier(
    session.messages, ext.brief,
    !ext.brief.destinations?.length ? 'missing_destinations' : 'missing_days',
  )
  session.status = 'awaiting_user'
  session.pendingClarification = question
  yield { type: 'clarify_needed', question, reason: ..., defaultSuggestion: defaultSuggestion ?? undefined }
  return
}
```

**Phase 0.5 (required fields complete, travelDates missing) — new check before Phase 1:**

```ts
if (!ext.brief.travelDates) {
  const defaultStart = formatDate(addDays(new Date(), 7))  // YYYY-MM-DD
  const { question, defaultSuggestion } = await clarifier(
    session.messages, ext.brief, 'missing_dates',
  )
  session.status = 'awaiting_user'
  session.pendingClarification = question
  yield {
    type: 'clarify_needed',
    question,
    reason: 'missing_dates',
    defaultSuggestion: defaultSuggestion ?? `按 ${defaultStart} 出发规划`,
  }
  return
}
```

Phase 0.5 fires whenever `travelDates` is absent. Once dates are set (by user reply or default chip), the brief carries them forward and this check passes silently on all subsequent turns.

---

## Event Schema Change

**`packages/shared/src/events.ts` — `clarify_needed` gains optional field:**

```ts
z.object({
  type: z.literal('clarify_needed'),
  question: z.string(),
  reason: BlockerTypeEnum,
  defaultSuggestion: z.string().optional(),
})
```

`FollowupEventSchema` is untouched (retains existing definition, not used in this spec).

---

## Frontend Changes

### `apps/web/stores/chat.ts`

Extend `awaitingClarify` type:

```ts
awaitingClarify: null as {
  question: string
  reason: string
  defaultSuggestion?: string
} | null
```

In `handleStreamEvent`:

```ts
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

### `apps/web/components/react/ClarifyCard.vue`

Add `defaultSuggestion?: string` prop. When present, render a chip button below the question:

```
┌─────────────────────────────────────────────────────┐
│ ✦ 需要补充信息                                        │
│                                                     │
│ "成都——不错的选择！你打算玩几天？"                      │
│                                                     │
│ [ 按 5 天规划 ]          ← only when defaultSuggestion exists
│                                                     │
│ 在下方对话框中回复，方案会继续生成。                    │
└─────────────────────────────────────────────────────┘
```

Chip emits `use-default` event upward.

### `apps/web/pages/index.vue`

Handle `use-default` from ClarifyCard:

```ts
function onUseDefault(suggestion: string) {
  // identical to user typing and submitting the suggestion text
  sendMessage(suggestion)
}
```

`sendMessage` is the same function called by PromptComposer — no new store action needed.

---

## Full Click-to-Plan Flow

```
User clicks chip "按 2026-05-08 出发规划"
  → ClarifyCard emits 'use-default'
    → index.vue calls sendMessage("按 2026-05-08 出发规划")
      → beginPlanning("按 2026-05-08 出发规划")
        → POST /sessions/:id/messages { content: "按 2026-05-08 出发规划" }
          → extractor parses travelDates from the concrete date string
            → isBriefMinimallyComplete: true, travelDates now set
              → Phase 0.5 check passes (travelDates present)
                → react-loop proceeds to planning
```

The default value is embedded as a concrete date string in the button label, so the extractor can parse it reliably without special-casing.

---

## Testing

### New: `apps/api/src/agents/clarifier.test.ts`

| Test | Assertion |
|---|---|
| Missing destination | `question` non-empty, `defaultSuggestion === null` |
| Missing days | `question` non-empty, `defaultSuggestion` contains "5 天" |
| Missing travelDates | `question` non-empty, `defaultSuggestion` contains a date string |
| LLM failure | Returns fallback strings, does not throw |

### Modified: react-loop tests

- "brief incomplete → clarify_needed": assert `event.question` is non-empty string (no hardcoded content assertion); `event.reason` correct; `event.defaultSuggestion` present for `missing_days`, absent for `missing_destinations`.
- New: "travelDates missing with complete brief → Phase 0.5 emits clarify_needed with reason='missing_dates'".

---

## Fallback Strings (LLM failure)

| Field | Fallback question | Default suggestion |
|---|---|---|
| `missing_destinations` | `"你想去哪里旅行？"` | `null` |
| `missing_days` | `"你计划玩几天？"` | `"按 5 天规划"` |
| `missing_dates` | `"你打算什么时候出发？"` | `"按 {computed_date} 出发规划"` |

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/agents/clarifier.ts` | New: LLM-powered question generator with fallback |
| `apps/api/src/agents/clarifier.test.ts` | New: 4 unit tests |
| `apps/api/src/agents/react-loop.ts` | Replace hardcoded strings; add Phase 0.5 travelDates check |
| `packages/shared/src/events.ts` | Add `defaultSuggestion?: string` to `clarify_needed` |
| `apps/web/stores/chat.ts` | Extend `awaitingClarify` type with `defaultSuggestion` |
| `apps/web/components/react/ClarifyCard.vue` | Add `defaultSuggestion` prop + chip button |
| `apps/web/pages/index.vue` | Handle `use-default` event from ClarifyCard |
