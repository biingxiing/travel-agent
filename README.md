# Travel Agent

Current repo state:
- `apps/api` is runnable now
- `apps/web` has not been merged into this workspace yet
- `docker-compose.yml` prepares a demo deployment for the API plus a `Caddy` reverse proxy

## Local API Dev

1. Copy `apps/api/.env.example` to `apps/api/.env`
2. Set a real `OPENAI_API_KEY`
3. Run `pnpm dev`

API default address: `http://localhost:3001`

## Demo Compose

1. Copy `.env.example` to `.env`
2. Set a real `OPENAI_API_KEY`
3. Run `docker compose up --build`

Endpoints:
- Direct API: `http://localhost:3001`
- Reverse proxy entry: `http://localhost:8080`
- Health check: `http://localhost:8080/health`

Notes:
- `OPENAI_MODEL_PLANNER` defaults to `gpt-5.4`
- `OPENAI_MODEL_FAST` defaults to `codex-mini-latest`
- `plugins/` is mounted into the container so future plugin installs can persist across restarts
- Once `apps/web` lands, add it as a Compose service and point `Caddyfile` root traffic to that service
