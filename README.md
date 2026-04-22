# Travel Agent

Current repo state:
- `apps/api` is runnable now
- `apps/web` is present in this workspace and consumes the API in local dev
- `docker-compose.yml` prepares a demo deployment for the API plus a `Caddy` reverse proxy

## Local API Dev

1. Copy `apps/api/.env.example` to `apps/api/.env`
2. Set a real `OPENAI_API_KEY`
3. Configure `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_COOKIE_SECRET`
4. Run `pnpm dev`

API default address: `http://localhost:3001`

## Local Web + API Dev

1. Ensure `apps/api/.env` contains both the LLM settings and auth settings
2. Run `pnpm dev`
3. Open `http://localhost:3000`
4. Log in with the single username/password from `apps/api/.env`

Notes:
- In local dev, the frontend sends cookies with `credentials: include`
- `CORS_ORIGIN` should stay aligned with the browser origin, usually `http://localhost:3000`

## Demo Compose

1. Copy `.env.example` to `.env`
2. Set a real `OPENAI_API_KEY`
3. Configure `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_COOKIE_SECRET`
4. Run `docker compose up --build`

Endpoints:
- Direct API: `http://localhost:3001`
- Reverse proxy entry: `http://localhost:8080`
- Health check: `http://localhost:8080/health`

Notes:
- All `/api/**` endpoints except `/api/auth/*` require login
- Login state is stored in a signed `HttpOnly` cookie
- `OPENAI_MODEL_PLANNER` defaults to `gpt-5.4`
- `OPENAI_MODEL_FAST` defaults to `codex-mini-latest`
- `plugins/` is mounted into the container so future plugin installs can persist across restarts
- `CORS_ORIGIN` should match the frontend origin when web and API are on different origins
