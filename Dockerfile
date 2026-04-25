FROM node:20-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/memory-pg/package.json packages/memory-pg/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --filter @travel-agent/api...

COPY apps/api ./apps/api
COPY packages/memory-pg ./packages/memory-pg
COPY packages/shared ./packages/shared
COPY plugins ./plugins

WORKDIR /app/apps/api

EXPOSE 3001

CMD ["npx", "tsx", "src/index.ts"]
