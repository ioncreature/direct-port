FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/client-bot/package.json apps/client-bot/
COPY libs/common/package.json libs/common/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build-libs
COPY libs/common libs/common
RUN pnpm --filter @direct-port/common build

FROM build-libs AS build
COPY apps/client-bot apps/client-bot
RUN pnpm --filter @direct-port/client-bot build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/client-bot/package.json apps/client-bot/
COPY libs/common/package.json libs/common/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/client-bot/node_modules apps/client-bot/node_modules
COPY --from=build /app/apps/client-bot/dist apps/client-bot/dist
COPY --from=build /app/apps/client-bot/package.json apps/client-bot/package.json
COPY --from=prod-deps /app/libs/common/node_modules libs/common/node_modules
COPY --from=build /app/libs/common/dist libs/common/dist
COPY --from=build /app/libs/common/package.json libs/common/package.json

USER app
ENV NODE_ENV=production
EXPOSE 3003
CMD ["node", "apps/client-bot/dist/main.js"]
