# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

- This repo is a `pnpm` monorepo for a travel-planning MVP.
- `apps/api` is a Hono-based API that streams planner output over SSE.
- `apps/web` is a Nuxt 3 frontend that consumes the chat stream and renders structured itineraries.
- `packages/shared` contains the shared `zod` schemas and event contracts used by both apps.

## Workspace Layout

- `apps/api/src/index.ts`: API entrypoint, CORS setup, route mounting, registry bootstrap.
- `apps/api/src/routes/chat.ts`: session endpoints and `/api/chat` SSE endpoint.
- `apps/api/src/agents/planner.ts`: planner agent prompt and stream-to-event translation.
- `apps/api/src/registry/*`: built-in skills/agents and optional skill loading from `SKILL_DIRS`.
- `apps/api/src/session/index.ts`: in-memory session store.
- `apps/web/pages/index.vue`: main planner page.
- `apps/web/composables/useChatStream.ts`: frontend SSE client.
- `apps/web/stores/chat.ts`: client-side chat/session/plan state.
- `packages/shared/src/plan.ts`: itinerary schema.
- `packages/shared/src/events.ts`: SSE event schema.
- `packages/shared/src/chat.ts`: chat request/message schema.

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
- Supported LLM env names are both `LLM_*` and legacy `OPENAI_*`.
- Important variables:
  - `LLM_API_KEY` / `OPENAI_API_KEY`
  - `LLM_BASE_URL` / `OPENAI_BASE_URL`
  - `LLM_MODEL_PLANNER` / `OPENAI_MODEL_PLANNER`
  - `LLM_MODEL_FAST` / `OPENAI_MODEL_FAST`
  - `PORT` for the API
  - `CORS_ORIGIN`
  - `SKILL_DIRS` for loading external skills from directories
- Nuxt can target an external API through `NUXT_PUBLIC_API_BASE`. In local dev, `/api/**` is proxied to `http://localhost:3001`.

## Architecture Notes

- The planner returns natural-language text first and may then emit a fenced `json` code block. `apps/api/src/agents/planner.ts` parses that block and emits a structured `plan` SSE event.
- Frontend behavior depends on the SSE event contract from `packages/shared/src/events.ts`. Keep backend and frontend aligned when changing event names or payloads.
- Structured itinerary shape lives in `packages/shared/src/plan.ts`. Update shared schemas first when changing plan shape.
- Chat request/message types live in `packages/shared/src/chat.ts`.
- Sessions are currently stored in memory only. Restarting the API clears all sessions.
- Built-in registry entries are defined in `apps/api/src/registry/bootstrap.ts`. External skills are loaded from directories containing `SKILL.md`.

## Working Guidelines

- Prefer targeted changes inside the relevant app/package instead of duplicating types locally.
- If you change API payloads or planner output shape, update `packages/shared` and both consumers in the same change.
- Preserve SSE compatibility unless the frontend is updated at the same time.
- Validate assumptions against the current code, not only `README.md`. The README still says `apps/web` has not been merged, but the frontend is present in this workspace.
- There is no dedicated test suite in the repo today. At minimum, run the relevant build command after code changes.
