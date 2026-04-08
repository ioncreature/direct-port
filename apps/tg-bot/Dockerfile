FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/tg-bot/package.json apps/tg-bot/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY apps/tg-bot apps/tg-bot
RUN pnpm --filter @direct-port/tg-bot build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/tg-bot/package.json apps/tg-bot/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/tg-bot/node_modules apps/tg-bot/node_modules
COPY --from=build /app/apps/tg-bot/dist apps/tg-bot/dist
COPY --from=build /app/apps/tg-bot/package.json apps/tg-bot/package.json

USER app
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "apps/tg-bot/dist/main.js"]
