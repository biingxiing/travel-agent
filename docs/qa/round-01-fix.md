# Round 01 Fix

## Addressed

- Lowered generator reasoning effort for the itinerary generation path so the first plan response is less likely to stall behind long reasoning latency.
- Added a frontend SSE idle watchdog so the workspace exits infinite loading and surfaces a clear retry error when the stream goes silent.
- Sanitized legacy oversized assistant history content during hydration so old sessions do not flood the chat pane.

## Files Changed

- `apps/api/src/agents/generator.ts`
- `apps/api/src/agents/generator.test.ts`
- `apps/web/composables/useChatStream.ts`
- `apps/web/composables/useChatStream.test.ts`
- `apps/web/stores/chat.ts`
- `apps/web/stores/chat.test.ts`

## Verification

- `pnpm --filter @travel-agent/api exec vitest run src/agents/generator.test.ts`
- `pnpm --filter @travel-agent/web exec vitest run stores/chat.test.ts composables/useChatStream.test.ts`
- Manual Playwright regression: a fresh prompt now reaches a rendered plan, and old history entries hydrate as `✅ 行程已生成` instead of dumping legacy prose.
