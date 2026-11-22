# Next.js (frontend + API) i migracje bazy. Kontekst budowania: root repo (monorepo pnpm).
# Używane przez compose.yaml — targety `runner` (aplikacja) i `migrate` (migracje Drizzle).

FROM node:24.22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Najpierw same manifesty: warstwa z zależnościami przebudowuje się tylko po zmianie paczek.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# postinstall nic tu nie tworzy: wzorów .env.example jeszcze nie ma w obrazie, a git hooki (scripts/git-hooks)
# pomijają katalog bez repozytorium gita.
COPY scripts/env-init.mjs scripts/
COPY scripts/git-hooks/ scripts/git-hooks/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/api-ml/package.json packages/api-ml/
COPY services/ml/package.json services/ml/
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS build
RUN pnpm --filter @app/web build

# Jednorazowo przy `docker compose up`: migracje z packages/db/drizzle na bazę z kontenera `db`.
FROM deps AS migrate
WORKDIR /repo/packages/db
CMD ["node_modules/.bin/drizzle-kit", "migrate"]

FROM node:24.22-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Baza treści (CONTENT_STORE_DIR) — wolumen dziedziczy właściciela z obrazu przy pierwszym montowaniu.
RUN mkdir -p /data/content && chown node:node /data/content
USER node
# 3000: aplikacja i REST, 3001: Socket.io.
EXPOSE 3000 3001
CMD ["node", "apps/web/server.js"]
