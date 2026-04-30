# Round 04 Fix

## Addressed

- Dropped stale persisted system-error bubbles when hydrating a session that already has a plan.

## Files Changed

- `apps/web/stores/chat.ts`
- `apps/web/stores/chat.test.ts`

## Verification

- `pnpm --filter @travel-agent/web exec vitest run stores/chat.test.ts`
- Manual Playwright refresh: the stale `连接中断，请重试` chat bubble no longer reappears next to a valid plan.
