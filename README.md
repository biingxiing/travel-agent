# Travel Agent

This repo now follows the same two deployment/auth principles that work well in `sub2api`:
- browser traffic enters through a single same-origin entry (`Caddy -> web/api`), so cookies do not depend on cross-origin setup
- login state lives in a signed `HttpOnly` cookie with a fixed secret, so sessions stay valid across restarts as long as the secret does not change

## Local API Dev

1. Copy `apps/api/.env.example` to `apps/api/.env`
2. Set a real `OPENAI_API_KEY`
3. Configure `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_COOKIE_SECRET`
4. Run `pnpm dev`

API default address: `http://localhost:3001`

## Local Web + API Dev

1. Ensure `apps/api/.env` contains both the LLM settings and auth settings
2. Run `pnpm dev`
3. Open the Web URL printed in the terminal (starts at `http://localhost:3000`)
4. Log in with the single username/password from `apps/api/.env`

Notes:
- in local dev, the frontend sends cookies with `credentials: include`
- `pnpm dev` auto-picks free ports for both services, starting from Web `3000` and API `3001`
- `apps/web/server/api/[...path].ts` proxies local `/api/*` requests to the API port selected by `pnpm dev`
- `CORS_ORIGIN` should stay aligned with the browser origin, usually the Web URL printed by `pnpm dev`
- unauthenticated access to `/` now redirects to `/login`, and successful login returns to the original workspace route
- interrupted login flow keeps draft/plan context in `sessionStorage`, so returning from `/login` can continue the current workspace state

Quick check:
- run `pnpm smoke:auth` to verify `auth/me -> login -> auth/me -> logout -> auth/me`
- run `pnpm smoke:auth:ui` to verify browser login, forced auth interruption, and draft restoration after re-login
- phase C planner smoke defaults to `http://localhost:3000`; override with `BASE_URL=...` if your entry differs

## Docker Deploy

### Quick Start

1. Run `./docker-deploy.sh`
2. Edit `.env` and set a real `OPENAI_API_KEY`
3. Run `docker compose up --build -d`
4. Open `http://localhost:8080`
5. Log in with `AUTH_USERNAME` / `AUTH_PASSWORD` from `.env`

What `docker-deploy.sh` does:
- copies `.env.example` to `.env` if needed
- generates a fixed `AUTH_COOKIE_SECRET` when the placeholder is still present
- generates a one-time `AUTH_PASSWORD` when the placeholder is still present

### Manual Compose

1. Copy `.env.example` to `.env`
2. Set a real `OPENAI_API_KEY`
3. Configure `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_COOKIE_SECRET`
4. Run `docker compose up --build`

Endpoints:
- Primary entry: `http://localhost:8080`
- Direct API (optional debug, loopback only by default): `http://127.0.0.1:3001`
- Health check: `http://localhost:8080/health`

Notes:
- compose now runs three services: `web`, `api`, `caddy`
- all browser traffic should go through `http://localhost:8080`, which keeps login on one origin
- API is bound to `127.0.0.1` by default in compose; if you really need LAN/public access, override `API_BIND_HOST`
- all `/api/**` endpoints except `/api/auth/*` require login
- login state is stored in a signed `HttpOnly` cookie
- keep `AUTH_COOKIE_SECRET` fixed after first deployment, or existing login cookies will be invalidated after restart
- `OPENAI_MODEL_PLANNER` defaults to `gpt-5.4`
- `OPENAI_MODEL_FAST` defaults to `codex-mini-latest`
- `plugins/` is mounted into the API container so future plugin installs can persist across restarts
- after services are up, you can validate the auth loop with `pnpm smoke:auth` or `BASE_URL=http://localhost:8080 pnpm smoke:auth`
- browser-level restore flow can be checked with `pnpm smoke:auth:ui` or `BASE_URL=http://localhost:8080 pnpm smoke:auth:ui`
- planner closed-loop checks:
  - `pnpm smoke:planner`
  - `pnpm smoke:planner:ui`
  - `pnpm smoke:planner:states`
  - `pnpm smoke:restore:ui`

## Auth Shape

- `GET /api/auth/me` checks the current signed cookie
- `POST /api/auth/login` validates the single configured account and sets the cookie
- `POST /api/auth/logout` clears the cookie
- all protected planner APIs are behind `authMiddleware`

This is intentionally simpler than `sub2api`'s full user system, but the deployment shape is the same: fixed secret, same-origin entry, and browser-side auth restoration through `/api/auth/me`.

## Services

- `apps/web`: Nuxt 3 UI, served behind Caddy in compose
- `apps/api`: Hono API, planner runtime, auth endpoints
- `Caddy`: same-origin reverse proxy for `/` and `/api/*`
