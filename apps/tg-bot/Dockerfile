FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/tg-bot/package.json apps/tg-bot/
COPY libs/common/package.json libs/common/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build-libs
COPY libs/common libs/common
RUN pnpm --filter @direct-port/common build

FROM build-libs AS build
COPY apps/tg-bot apps/tg-bot
RUN pnpm --filter @direct-port/tg-bot build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/tg-bot/package.json apps/tg-bot/
COPY libs/common/package.json libs/common/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/tg-bot/node_modules apps/tg-bot/node_modules
COPY --from=build /app/apps/tg-bot/dist apps/tg-bot/dist
COPY --from=build /app/apps/tg-bot/package.json apps/tg-bot/package.json
COPY --from=prod-deps /app/libs/common/node_modules libs/common/node_modules
COPY --from=build /app/libs/common/dist libs/common/dist
COPY --from=build /app/libs/common/package.json libs/common/package.json

USER app
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "apps/tg-bot/dist/main.js"]
