# Settle API. Runs the TypeScript source directly via tsx (no separate build
# step), keeping the money path identical to what is reviewed in source.
FROM node:22-alpine

RUN corepack enable
WORKDIR /app

# Install only the API workspace + its dependencies, leveraging layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile --filter "@settle/api..."

# Copy sources needed by the API.
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/apps/api
# The server applies migrations on boot, then serves + runs the outbox poller.
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
