FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin-web/package.json apps/admin-web/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY apps/admin-web apps/admin-web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @direct-port/admin-web build

FROM node:24-alpine AS runtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/apps/admin-web/.next/standalone ./
COPY --from=build /app/apps/admin-web/.next/static apps/admin-web/.next/static

USER app
EXPOSE 3000
CMD ["node", "apps/admin-web/server.js"]
