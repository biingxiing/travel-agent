# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

- This repo is a `pnpm` monorepo for a travel-planning MVP.
- `apps/api` is a Hono-based API that streams planner output over SSE.
- `apps/web` is a Nuxt 3 frontend that consumes the chat stream and renders structured itineraries.
- `packages/shared` contains the shared `zod` schemas and event contracts used by both apps.

## Workspace Layout

- `apps/api/src/index.ts`: API entrypoint, CORS setup, auth assert, route mounting, registry bootstrap, PG migrations.
- `apps/api/src/routes/auth.ts`: login / logout / `auth/me` endpoints.
- `apps/api/src/routes/sessions.ts`: REST CRUD for sessions plus the SSE endpoints `POST /:id/messages` and `POST /:id/continue` that drive the ReAct loop.
- `apps/api/src/routes/registry.ts`: read-only inspection of registered skills/agents.
- `apps/api/src/agents/react-loop.ts`: the orchestrator. Calls extractor → prefetch → generator (initial), then evaluator → generator (refine) until score ≥ `EVAL_THRESHOLD` or `EVAL_MAX_ITER`.
- `apps/api/src/agents/{extractor,prefetch,generator,evaluator,critic}.ts`: individual ReAct steps. There is no `planner.ts` — planning is split across these five.
- `apps/api/src/auth/{config,session,middleware}.ts`: signed-cookie auth (single user via `AUTH_USERNAME` / `AUTH_PASSWORD`); middleware mounted on `sessionsRouter`.
- `apps/api/src/llm/client.ts`: OpenAI-compatible client. `LLM_BASE_URL` and `LLM_API_KEY` are required at startup (no default).
- `apps/api/src/registry/*`: built-in skills/agents and optional skill loading from `SKILL_DIRS` directories that contain a `SKILL.md` manifest.
- `apps/api/src/session/store.ts`: session store. In-memory `Map`, optionally mirrored to Postgres when `DATABASE_URL` is set.
- `apps/api/src/persistence/pg.ts`: Postgres pool + migration runner (idempotent).
- `apps/web/pages/index.vue`: main workspace (chat panel + planning preview). Redirects to `/login` if unauthenticated.
- `apps/web/pages/login.vue`: standalone login page; preserves draft/plan in `sessionStorage` across the redirect.
- `apps/web/composables/useChatStream.ts`: frontend SSE client (POST `/api/sessions/:id/messages` or `/continue`, decodes `data:` lines).
- `apps/web/stores/{chat,workspace,auth}.ts`: client state. `chat` covers messages and ReAct loop status; `workspace` covers the current session/plan/score; `auth` covers login state.
- `packages/shared/src/plan.ts`: itinerary schema (`PlanSchema`, `DailyPlanSchema`, `PlanItemSchema`).
- `packages/shared/src/events.ts`: SSE event union (`ChatStreamEventSchema`, 14 variants) — the contract between API and web.
- `packages/shared/src/chat.ts`: chat request / message schema.
- `packages/shared/src/{evaluation,scoring,brief,session}.ts`: evaluation outputs, rule-based plan scoring, extracted brief shape, persisted session state.
- `packages/memory-pg/`: schema + migrations for the optional Postgres backing store.

## Common Commands

- Install deps: `pnpm install`
- Run API + web in parallel: `pnpm dev`
- Run only API: `pnpm dev:api`
- Run only web: `pnpm dev:web`
- Build all packages: `pnpm build`
- Build only web: `pnpm build:web`
- Demo stack: `docker compose up --build`

## Environment

- API local dev reads `apps/api/.env`.
- Demo Compose reads the repo-root `.env`.
- Supported LLM env names are both `LLM_*` and legacy `OPENAI_*`. There is **no public default** — the API throws on startup if base URL or API key is missing.
- Important variables:
  - `LLM_API_KEY` / `OPENAI_API_KEY` — required.
  - `LLM_BASE_URL` / `OPENAI_BASE_URL` — required. A warning is logged for non-localhost plain HTTP.
  - `LLM_MODEL_PLANNER` / `OPENAI_MODEL_PLANNER` — defaults to `gpt-5.4`.
  - `LLM_MODEL_FAST` / `OPENAI_MODEL_FAST` — defaults to `codex-mini-latest`.
  - `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_COOKIE_SECRET` (≥16 chars) — required; the API throws on startup if missing.
  - `AUTH_COOKIE_NAME` — defaults to `travel_agent_auth`.
  - `PORT` / `API_PORT` for the API; `API_BIND_HOST` for the bind address.
  - `CORS_ORIGIN` — production must be set explicitly. In dev, `localhost:<port>` is auto-allowed for convenience.
  - `DATABASE_URL` — optional. When set, sessions are mirrored to Postgres.
  - `EVAL_RULE_WEIGHT`, `EVAL_THRESHOLD`, `EVAL_MAX_ITER`, `EVAL_REQUIRED_CATEGORIES` — ReAct loop knobs.
  - `SKILL_DIRS` (colon-separated), `SKILL_EXEC_TIMEOUT_MS` — external skill loading.
- Nuxt can target an external API through `NUXT_PUBLIC_API_BASE`. In local dev, `/api/**` is proxied to the API port chosen by `pnpm dev`.

## Architecture Notes

- The planning pipeline is a multi-agent ReAct loop driven by `apps/api/src/agents/react-loop.ts`. One pass is: `extractor` (NL → structured `Brief`) → `prefetch` (calls flyai-style skills for transport/lodging/POI) → `generator.runInitial` (first plan) → `evaluator` (rule scoring + LLM critic) → `generator.runRefine`. Refine loops until score ≥ `EVAL_THRESHOLD` or iterations hit `EVAL_MAX_ITER`. Cancellation is via `lastRunId` (a new run on the same session preempts the prior one).
- Frontend behavior depends on the SSE event contract from `packages/shared/src/events.ts` (14 variants under `ChatStreamEventSchema`). Keep API emit code and `apps/web/composables/useChatStream.ts` + `apps/web/stores/chat.ts` aligned when changing event names or payloads.
- Structured itinerary shape lives in `packages/shared/src/plan.ts`. Update shared schemas first when changing plan shape; both apps consume the same zod schema.
- Chat request/message types live in `packages/shared/src/chat.ts`. Brief and evaluation payloads live in `packages/shared/src/{brief,evaluation,scoring}.ts`.
- Sessions live in an in-process `Map` (`apps/api/src/session/store.ts`). When `DATABASE_URL` is set, every save is mirrored to Postgres so a restart can re-hydrate. **No row locking yet** — concurrent requests on the same session can race.
- Built-in registry entries are defined in `apps/api/src/registry/bootstrap.ts`. External skills are loaded from `SKILL_DIRS`-listed directories that contain a `SKILL.md` manifest. Skill invocation goes through `execFile` with a timeout, so manifests must point at trusted binaries.
- Authentication is single-user via signed `HttpOnly` cookies (`apps/api/src/auth/`). `userId` is set to `AUTH_USERNAME` and is propagated through the Hono context for session-store ownership checks.

## Working Guidelines

- Prefer targeted changes inside the relevant app/package instead of duplicating types locally.
- If you change API payloads or planner output shape, update `packages/shared` and both consumers in the same change.
- Preserve SSE compatibility unless the frontend is updated at the same time.
- Validate assumptions against the current code, not only `README.md`. Older sections of the README may lag behind the actual layout.
- There is a vitest suite (`pnpm test` at the repo root, or `pnpm --filter @travel-agent/<pkg> test`). At minimum, run `pnpm -r test` and the relevant build command after code changes.
- Several `smoke:planner:*` scripts in the root `package.json` reference `tests/e2e/` which does not yet exist. Treat them as TODO infrastructure rather than working commands.
