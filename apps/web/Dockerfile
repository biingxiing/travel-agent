FROM node:20-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN pnpm install --frozen-lockfile --filter @travel-agent/web...

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain

WORKDIR /app/apps/web

RUN pnpm build

ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
