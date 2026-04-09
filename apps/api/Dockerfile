FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY libs/tks-api/package.json libs/tks-api/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build-libs
COPY libs/tks-api libs/tks-api
RUN pnpm --filter @direct-port/tks-api build

FROM build-libs AS build
COPY apps/api apps/api
RUN pnpm --filter @direct-port/api build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY libs/tks-api/package.json libs/tks-api/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/libs/tks-api/dist libs/tks-api/dist
COPY --from=build /app/libs/tks-api/package.json libs/tks-api/package.json
COPY --from=build /app/apps/api/package.json apps/api/package.json

USER app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]
