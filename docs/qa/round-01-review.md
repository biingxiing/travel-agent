# Round 01 Frontend Review

## Startup

- Command: `WEB_PORT=3100 API_PORT=3101 pnpm dev:clean-port`
- Web URL: `http://localhost:3100`
- API URL: `http://127.0.0.1:3101`
- Key runtime notes:
  - app booted normally on `3100/3101`
  - auth flow worked with `apps/api/.env` credentials
  - planning flow hit a long-running generator path; server logs showed `call_generator` entering the `gpt-5.4` path after prefetch
  - environment is configured with `LLM_REASONING_EFFORT=xhigh` and `LLM_STREAM_IDLE_MS=420000`, which materially increases time-to-first-chunk risk for the planner stream

## Covered Pages And States

- Login page, desktop: [tests/screenshots/round-01/01-login-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/01-login-desktop.png)
- Empty workspace / landing, desktop: [tests/screenshots/round-01/02-empty-workspace-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/02-empty-workspace-desktop.png)
- New planning request in progress, desktop: [tests/screenshots/round-01/03-processing-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/03-processing-desktop.png)
- Planning still stuck in loading after waiting, desktop: [tests/screenshots/round-01/04-stuck-loading-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/04-stuck-loading-desktop.png)
- Existing finished plan loaded from history, desktop: [tests/screenshots/round-01/05-existing-plan-result-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/05-existing-plan-result-desktop.png)
- New session reset from existing plan, desktop: [tests/screenshots/round-01/06-new-session-reset-desktop.png](/Users/bill/travel-agent/tests/screenshots/round-01/06-new-session-reset-desktop.png)
- Workspace, mobile: [tests/screenshots/round-01/07-workspace-mobile.png](/Users/bill/travel-agent/tests/screenshots/round-01/07-workspace-mobile.png)
- Login page, mobile: [tests/screenshots/round-01/08-login-mobile.png](/Users/bill/travel-agent/tests/screenshots/round-01/08-login-mobile.png)
- Logout success landing, mobile: [tests/screenshots/round-01/09-logout-mobile.png](/Users/bill/travel-agent/tests/screenshots/round-01/09-logout-mobile.png)
- Mobile history drawer open: [tests/screenshots/round-01/10-workspace-mobile-sidebar-open.png](/Users/bill/travel-agent/tests/screenshots/round-01/10-workspace-mobile-sidebar-open.png)

## Functional Checks

| Feature | Result | Notes |
| --- | --- | --- |
| Login | Pass | `/login` form works; redirects to workspace |
| Logout | Pass with caveat | Works when API is stable; one earlier attempt failed during API hot restart |
| Start new session | Pass | `新建行程` resets current plan/workspace |
| Select history entry | Pass | existing completed plan loads successfully |
| Submit new planning prompt | Fail | request enters loading state but no new plan renders in reasonable time |
| Result rendering | Risk | existing persisted plan renders, but newly generated plan did not complete during review |
| Mobile navigation | Pass | hamburger opens drawer; base interaction is usable |
| Desktop/mobile baseline layout | Pass | no critical responsive breakage observed in reviewed states |

## Findings

### 1. Critical: new planning flow can remain in loading for minutes with no user-visible failure

- Severity: Critical
- Repro:
  1. Log in
  2. Start a new session
  3. Submit a real trip prompt
  4. Wait on the planning screen
- Observed:
  - chat panel stays on `规划中`
  - preview panel stays on `正在生成行程方案`
  - no error bubble is surfaced to the user
  - server logs show the flow entering `call_generator` after prefetch, while environment is configured with `LLM_REASONING_EFFORT=xhigh` and `LLM_STREAM_IDLE_MS=420000`
- Impact:
  - primary product path appears frozen
  - users cannot tell whether the request is still alive, retryable, or failed
- Suspected code areas:
  - `apps/api/src/agents/generator.ts`
  - `apps/api/src/agents/tools/generate-plan.tool.ts`
  - `apps/web/pages/index.vue`
  - `apps/web/stores/chat.ts`

### 2. Medium: loading historical plans can dump oversized assistant prose into the chat pane

- Severity: Medium
- Repro:
  1. Open an existing completed history entry
  2. Observe the chat panel
- Observed:
  - a very large assistant bubble is rendered before the structured plan
  - it contains long-form legacy itinerary prose, which visually overwhelms the workspace
- Impact:
  - history reopen is noisy and hard to scan
  - chat history competes with the structured result panel
- Suspected code areas:
  - `apps/web/stores/chat.ts`
  - possibly legacy data already persisted by older runs

## Optimization Opportunities

- Surface a deterministic planner failure state faster when the generator has not produced a first useful result within a bounded interval.
- Reduce planner latency by avoiding `xhigh` reasoning on the structured JSON generation path.
- Sanitize or collapse legacy assistant history when rehydrating a stored session.
- Consider suppressing or de-prioritizing empty/untitled sessions in the history list; the drawer is dominated by `未命名行程`, which reduces the value of history scanning.

## Recommendations For The Fix Pass

1. Adjust the generator path so the first planning pass does not use the slowest reasoning profile.
2. Ensure generator failure/no-plan outcomes can reach the frontend as an explicit error instead of silent indefinite loading.
3. Add a regression test around the generator request configuration or no-plan behavior.
4. Sanitize historical assistant content when hydrating session messages in the frontend, so old oversized responses do not dominate the chat column.
