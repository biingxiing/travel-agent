# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- This repo is a `pnpm` monorepo for a travel-planning MVP.
- `apps/api` is a Hono-based API that streams planner output over SSE.
- `apps/web` is a Nuxt 3 frontend that consumes the chat stream and renders structured itineraries.
- `packages/shared` contains the shared `zod` schemas and event contracts used by both apps.

## Workspace Layout

### API (`apps/api/src/`)

- `index.ts`: API entrypoint, CORS, auth assert, route mounting, registry bootstrap, PG migrations.
- `routes/auth.ts`: login / logout / `auth/me`.
- `routes/sessions.ts`: REST CRUD for sessions plus the SSE endpoints `POST /:id/messages` and `POST /:id/continue` that drive the agent loop.
- `routes/registry.ts`: read-only inspection of registered skills/agents.
- `routes/dev-traces.ts`: dev-only `GET /dev/traces/:runId` HTML timeline (auth-required, mounted only when `NODE_ENV !== 'production'`).
- `agents/react-loop.ts`: the public entrypoint consumed by `routes/sessions.ts`. Constructs the orchestrator `QueryEngine`, attaches the runtime context (`__runtime__`) to the session, runs up to `MAX_TURNS = 10` turns, dispatches tool calls, and emits the SSE event stream. Cancellation is via `lastRunId` checked at every loop iteration. **Side-effect imports `'./personas/researcher.js'`** so the LocalAgent persona registers itself at module load.
- `agents/runtime/`: the v2.0 multi-agent harness — see "Multi-Agent Architecture" below.
- `agents/personas/`: per-agent prompt modules (`orchestrator.ts`, `researcher.ts`, `_compactor.ts`). Each persona module exports a static `SYSTEM_PROMPT as const`, zod `InputSchema` / `OutputSchema` (subagents only), `buildMessages(...)`, and a `TOOLS: ToolPool`. `_compactor.ts` is a runtime helper, not a SendMessage target — the leading underscore signals that.
- `agents/tools/orchestrator/`: tools available to the main agent. `extract-brief.tool.ts`, `generate-plan.tool.ts`, `ask-clarification.tool.ts` wrap LLM calls or pure event emissions. `start-research.tool.ts` is the bridge — it spawns a `Researcher` LocalAgent via `sendMessage`. The first three are NOT subagents; only `start_research` triggers the LocalAgent runtime.
- `agents/tools/researcher/`: tools available inside the Researcher subagent's pool. Currently just `prefetch-context.tool.ts`. Reserved for future real-world data-source tools (transport / weather / hotel / attractions).
- `agents/{extractor,generator,clarifier,prefetch}.ts`: legacy single-implementation modules that contain the actual LLM call logic. They are wrapped by the corresponding `tools/orchestrator/*.tool.ts` and `tools/researcher/*.tool.ts` files and stay in place — do not duplicate their logic into the tool wrappers.
- `auth/{config,session,middleware}.ts`: signed-cookie auth (single user via `AUTH_USERNAME` / `AUTH_PASSWORD`); middleware mounted on individual routers (`sessionsRouter`, `devTracesRouter`).
- `llm/client.ts`: OpenAI-compatible client. `LLM_BASE_URL` and `LLM_API_KEY` are required at startup (no default — module throws at import without them, which is why test files mock this module).
- `llm/logger.ts`: `loggedStream` / `loggedCompletion` wrappers — emit per-call structured logs and inject `reasoning_effort` from env.
- `registry/*`: built-in skills/agents and optional skill loading from `SKILL_DIRS` directories that contain a `SKILL.md` manifest. Skill invocation goes through `execFile` with a timeout — manifests must point at trusted binaries.
- `session/store.ts`: session store. In-memory `Map`, optionally mirrored to Postgres when `DATABASE_URL` is set. **No row locking** — concurrent requests on the same session can race.
- `persistence/pg.ts`: Postgres pool + migration runner (idempotent).
- `.traces/<runId>.jsonl` (gitignored): per-run JSONL trace written by `runtime/trace.ts`. Inspect via the dev endpoint or with `jq -c`.

### Web (`apps/web/`)

- `pages/index.vue`: main workspace (chat panel + planning preview). Redirects to `/login` if unauthenticated.
- `pages/login.vue`: standalone login page; preserves draft/plan in `sessionStorage` across the redirect.
- `components/{ChatPanel,PlanningPreview,PromptComposer,HeroPlannerCard,...}.vue`: workspace UI. `components/react/` renders agent progress / clarify cards; `components/states/` holds empty/error/loading/streaming bubbles; `components/ui/` is a small shadcn-style primitive set.
- `composables/useChatStream.ts`: frontend SSE client. Decodes `data:` lines from `POST /api/sessions/:id/messages` (or `/continue`).
- `stores/{chat,workspace,auth}.ts`: client state. `chat` covers messages + agent loop status; `workspace` covers the current session/plan; `auth` covers login state. The agent → label mapping for `agent_step` events lives in `stores/chat.ts` (`extractor`, `prefetch`, `generator`, `researcher`).
- `server/api/[...path].ts`: Nitro proxy that forwards browser `/api/**` requests to the API port (forwards cookies, so login works same-origin in dev).
- `assets/css/main.css`: design tokens (cool-white bg, Inter sans, purple→blue gradient CTA).

### Shared & infra

- `packages/shared/src/plan.ts`: itinerary schema (`PlanSchema`, `DailyPlanSchema`, `PlanItemSchema`).
- `packages/shared/src/events.ts`: SSE event union (`ChatStreamEventSchema`, **8 variants**) — the contract between API and web.
- `packages/shared/src/chat.ts`: chat request / message schema.
- `packages/shared/src/{brief,session}.ts`: extracted brief shape, persisted session state. `session.ts` includes `compactedHistory: string | null` (head-summary lock) and the `pendingClarification` shape.
- `packages/memory-pg/`: schema + migrations for the optional Postgres backing store.
- `scripts/dev.mjs`: spawned by `pnpm dev`; auto-picks free ports starting at web `3000` / api `3001` and forwards them via env to the two workspaces.
- `scripts/{smoke-auth.mjs,migrate-memory-pg.mjs}`: small one-off Node scripts (HTTP smoke + Postgres migration runner) used by the `smoke:auth` / `db:migrate:memory` package scripts.
- `Caddyfile` + `docker-compose.yml`: production-style stack — Caddy on `:8080` is the single same-origin entry, fronting both `web` and `api` so login cookies work without CORS.
- `apps/api/src/{skills,types}/`: empty placeholder dirs; treat as reserved namespaces, not load-bearing modules.

## Multi-Agent Architecture

The `apps/api/src/agents/runtime/` directory contains the v2.0 harness — a Claude-Code-style star topology with one main agent and on-demand `LocalAgent` subagents.

- `runtime/tool-pool.ts`: `Tool` interface (replaces the old `SubagentTool`), `ToolResult` discriminated union (`{type:'ok',output} | {type:'halt',reason}`), and `ToolPool` class. The `assertDisjoint(other)` invariant lets tests verify two pools share no tool names — that's the isolation guarantee.
- `runtime/query-engine.ts`: one `QueryEngine` instance per agent session. Owns `messages`, a `ToolPool`, the `runId`, and the `Trace`. Streams LLM completions through `loggedStream`, accumulates tool calls, and `dispatchToolCalls()` partitions them: consecutive `isConcurrencySafe()` tools batch into `Promise.all`, non-safe tools run serially. Emits `llm_call_start` / `llm_call_end` / `tool_call` / `tool_result` / `tool_halt` / `tool_error` to the trace. Halts every iteration if `session.lastRunId !== runId` so cancellation propagates.
- `runtime/send-message.ts`: typed parent → child dispatch. `registerPersona({name, systemPrompt, InputSchema, OutputSchema, buildMessages, tools})` pre-registers a persona; `sendMessage(target, rawInput, ctx)` validates `rawInput` against the persona's `InputSchema`, instantiates a fresh child `QueryEngine` (sharing the parent's `runId` and `Trace`), runs its tool loop up to `maxTurns` (default 6), and parses the final assistant message against the persona's `OutputSchema`. Subagent emit calls go to a `NOOP_EMIT` — only the parent's emit reaches the SSE stream. Multiple `sendMessage` calls in one orchestrator turn run concurrently (because `start_research` is `isConcurrencySafe: () => true`).
- `runtime/trace.ts`: per-`runId` JSONL writer. Buffered + serialized via a single in-flight write chain. Auto-creates `<cwd>/.traces/`. Closed at the end of every `runReactLoop` exit path.
- The session is adorned with a runtime-only `__runtime__: { trace, runId, childCounter }` field by `react-loop.ts` before each turn. The `start_research` tool reads this to allocate `childIndex` for spawned researchers (`researcher#0`, `researcher#1`, …) — so concurrent spawns get distinct trace identities.

**Tool vs Subagent — the load-bearing distinction:**
- A **Tool** is a function the LLM can call within its own thread. May wrap an LLM call, an event emission, or a pure transform. No isolated context.
- A **LocalAgent** (only `Researcher` in v2.0) is dispatched via `sendMessage` and gets its own `QueryEngine`, message thread, tool pool, and typed I/O boundary. Exposed to the orchestrator LLM as a regular `start_research` tool call so OpenAI tool-calling carries it; underneath the runtime instantiates a fresh agent.

## SSE Event Contract

`packages/shared/src/events.ts` defines 8 variants: `session`, `agent_step`, `token`, `plan_partial`, `plan`, `clarify_needed`, `done`, `error`. The `agent_step.agent` field is `z.string()` — the orchestrator emits values like `'extractor'`, `'researcher'`, `'generator'` to drive the frontend's progress UI. Subagent visibility (spawn / running / return) reuses `agent_step`; there are no separate `subagent_*` events.

When changing event names or payloads, update API emit sites and the web consumers (`stores/chat.ts`, `composables/useChatStream.ts`) in the same change. Sub-tool generators (e.g. `generator.ts`) **must NOT yield their own `done`** — that event is owned exclusively by the top-level `runReactLoop`. A historical bug emerged where the legacy `generator.ts` emitted `done` and prematurely terminated the SSE stream when invoked as a sub-tool.

## Common Commands

- Install deps: `pnpm install`
- Run API + web in parallel: `pnpm dev` (auto-picks free ports starting at 3000/3001)
- Run only API: `pnpm dev:api`
- Run only web: `pnpm dev:web`
- Build all packages: `pnpm build`
- Build only web: `pnpm build:web`
- Run all unit tests (vitest, recursive): `pnpm test` or `pnpm -r test`
- Run unit tests for one workspace: `pnpm test:api` / `pnpm test:web` / `pnpm test:shared`
- Run a single vitest file: `pnpm --filter @travel-agent/api exec vitest run src/agents/react-loop.test.ts` (swap path/filter as needed; tests are colocated as `*.test.ts` next to source)
- Coverage: `pnpm test:coverage`
- Migrate the optional Postgres memory store: `pnpm db:migrate:memory` (needs `DATABASE_URL`)
- Smoke scripts: `pnpm smoke:auth` (HTTP login loop), `pnpm smoke:auth:ui` / `pnpm smoke:planner` / `pnpm smoke:planner:ui` / `pnpm smoke:planner:states` / `pnpm smoke:restore:ui` / `pnpm smoke:planner:guangdong` (all Playwright; require a running stack and a `tests/e2e/` directory of specs — see Working Guidelines)
- Demo stack: `docker compose up --build` (Caddy on `http://localhost:8080`); use `./docker-deploy.sh` first to auto-generate secrets if running for the first time

## Environment

- API local dev reads `apps/api/.env`.
- Demo Compose reads the repo-root `.env`.
- Supported LLM env names are both `LLM_*` and legacy `OPENAI_*`. There is **no public default** — the API throws on startup if base URL or API key is missing.
- Important variables:
  - `LLM_API_KEY` / `OPENAI_API_KEY` — required.
  - `LLM_BASE_URL` / `OPENAI_BASE_URL` — required. A warning is logged for non-localhost plain HTTP.
  - `LLM_MODEL_PLANNER` / `OPENAI_MODEL_PLANNER` — defaults to `gpt-5.4`.
  - `LLM_MODEL_FAST` / `OPENAI_MODEL_FAST` — defaults to `codex-mini-latest`. Used by `personas/_compactor.ts` for head-summary compaction.
  - `LLM_REASONING_EFFORT` / `OPENAI_REASONING_EFFORT` — optional. Accepts `low` | `medium` | `high` | `xhigh`. When set, `apps/api/src/llm/logger.ts` injects `reasoning_effort` into every `llm.chat.completions.create` call. Caller-passed `reasoning_effort` in params overrides the env. Sub2API forwards it to the upstream Responses API and **gpt-5.4 actually honors it** (verified 2026-04-28: completion_tokens scales monotonically with effort — 5 → 120 → 156 → 216 for none/low/high/xhigh on a 1-character-answer prompt). Hidden reasoning tokens are folded into `completion_tokens`; there is no separate `reasoning_tokens` field.
  - `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_COOKIE_SECRET` (≥16 chars) — required; the API throws on startup if missing.
  - `AUTH_COOKIE_NAME` — defaults to `travel_agent_auth`.
  - `PORT` / `API_PORT` for the API; `API_BIND_HOST` for the bind address.
  - `CORS_ORIGIN` — production must be set explicitly. In dev, `localhost:<port>` is auto-allowed for convenience.
  - `DATABASE_URL` — optional. When set, sessions are mirrored to Postgres.
  - `NODE_ENV` — when not `production`, the dev `/dev/traces/:runId` endpoint is mounted.
  - `SKILL_DIRS` (colon-separated), `SKILL_EXEC_TIMEOUT_MS` — external skill loading.
- Nuxt can target an external API through `NUXT_PUBLIC_API_BASE`. In local dev, `/api/**` is proxied to the API port chosen by `pnpm dev`.

## Architecture Notes

- The agent loop entrypoint is `apps/api/src/agents/react-loop.ts`. Each turn it composes `[stable prefix, ...accumulated assistant+tool messages, fresh state-context user message]` and runs the orchestrator `QueryEngine`. The **stable prefix** comes from `personas/orchestrator.ts:buildMessages` and is computed exactly once per `runReactLoop`: `SYSTEM_PROMPT` + (optional) `compactedHistory` system message + the most recent 20 user/assistant turns. The **state-context** is regenerated by `buildStateContextMessage(session)` per turn and reflects the current `brief` / `currentPlan` / `prefetchContext` count. This split is what preserves prefix cache hits while letting the orchestrator see updated state.
- The expected orchestrator tool-call sequence is: `extract_brief` → (one or more concurrent) `start_research` → `generate_plan` → optional `ask_clarification` if a hard blocker is detected. `start_research` and `prefetch_context` are concurrency-safe; the others are not (they mutate session state).
- Frontend behaviour depends on the SSE event contract from `packages/shared/src/events.ts`. Keep API emit code and `apps/web/composables/useChatStream.ts` + `apps/web/stores/chat.ts` aligned when changing events.
- Structured itinerary shape lives in `packages/shared/src/plan.ts`. Update shared schemas first when changing plan shape; both apps consume the same zod schema.
- Sessions live in an in-process `Map` (`apps/api/src/session/store.ts`). When `DATABASE_URL` is set, every save is mirrored to Postgres. The runtime adornment `session.__runtime__` is intentionally NOT in the schema — it's a per-request handle, never persisted.
- Built-in registry entries are defined in `apps/api/src/registry/bootstrap.ts`. External skills are loaded from `SKILL_DIRS`-listed directories that contain a `SKILL.md` manifest.
- Authentication is single-user via signed `HttpOnly` cookies. `userId` is set to `AUTH_USERNAME` and propagated through the Hono context (typed as `Variables: { userId: string }`).
- Same-origin entry: in dev the Nuxt server proxies `/api/**` to the live API port; in compose Caddy on `:8080` fronts both services. Either way the browser only ever talks to one origin, so `HttpOnly` auth cookies survive without cross-site setup.

## Working Guidelines

- **Always use `stream: true` for every LLM call.** The configured LLM backend (Sub2API) has a server-side bug where `stream: false` returns `{"role":"assistant"}` with no `content`. Buffer the SSE delta chunks on the client side instead of relying on a non-streaming response. Never pass `stream: false` to `llm.chat.completions.create`. Also: `response_format` is silently dropped by this backend — enforce JSON output via system prompt constraints, not `response_format`.
- **LLM cache invariant**: every persona's first message (`messages[0]`) must be a static `const` string with no runtime interpolation. Each persona module enforces this structurally: `SYSTEM_PROMPT as const` + a `buildMessages(...)` builder that always places `SYSTEM_PROMPT` at index 0 and dynamic content after. The orchestrator additionally appends a fresh `state-context` user message at the *tail* of each turn so cache invalidation is bounded to the suffix.
- **Compaction is locked**: `personas/_compactor.ts` produces `session.compactedHistory` once and is never overwritten — preserve this lock semantics if you change the compactor. The compaction threshold is 10 user/assistant turns.
- **`extractor.ts` / `generator.ts` / `clarifier.ts` / `prefetch.ts`** stay as legacy implementation modules. Always wrap them through a `tools/orchestrator/*.tool.ts` or `tools/researcher/*.tool.ts` shim — never call them directly from `react-loop.ts`. Adding a new agent capability means adding a new persona under `personas/` and a new `start_<persona>.tool.ts` bridge in `tools/orchestrator/`.
- **Tests for runtime modules** must mock `'../../llm/client.js'` (in addition to whatever else they need) — the client module throws at import time without `LLM_BASE_URL`. See `runtime/query-engine.test.ts` for the canonical mock shape.
- Prefer targeted changes inside the relevant app/package instead of duplicating types locally.
- If you change API payloads or planner output shape, update `packages/shared` and both consumers in the same change.
- Preserve SSE compatibility unless the frontend is updated at the same time. Sub-tools must not emit terminal events (`done`/`error`) — those belong to the top-level loop.
- Validate assumptions against the current code, not only `README.md`. Older sections of the README may lag behind the actual layout.
- Vitest tests live next to source as `*.test.ts`. Run the whole suite with `pnpm -r test` and pair it with the relevant build after code changes.
- The `smoke:*` Playwright scripts in `package.json` (and `playwright.config.cjs`) point at `tests/e2e/`, but that directory is not committed in this checkout — only `tests/screenshots/` exists. Treat those scripts as opt-in infra: either restore the spec files first, or use `pnpm smoke:auth` (pure-Node HTTP smoke) which works without Playwright.
