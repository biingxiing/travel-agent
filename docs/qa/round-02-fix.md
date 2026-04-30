# Round 02 Fix

## Addressed

- Filtered irrecoverable draft shells out of the history index so the sidebar prioritizes usable sessions.

## Files Changed

- `apps/web/composables/useTripHistory.ts`
- `apps/web/composables/useTripHistory.test.ts`

## Verification

- `pnpm --filter @travel-agent/web exec vitest run composables/useTripHistory.test.ts`
- Manual Playwright check: after the sidebar refresh completes, history collapses to meaningful itineraries instead of pages of `未命名行程`.
