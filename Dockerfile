FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Compile the startup-only lib modules into the standalone bundle.
# instrumentation.ts dynamically imports these files, so they must exist
# under .next/server/lib at runtime even though webpack does not trace them.
RUN npx tsc \
    --outDir .next/standalone/.next/server \
    --rootDir . \
    --module commonjs \
    --target es2022 \
    --esModuleInterop \
    --skipLibCheck \
    --declaration false \
    --sourceMap false \
    --moduleResolution node \
    lib/cache.ts \
    lib/bamboohr.ts \
    lib/bigquery.ts \
    lib/oracle.ts \
    lib/scheduler.ts \
    lib/sync.ts && \
    # Copy packages that the startup modules require but standalone tracing
    # misses because the imports happen through instrumentation eval().
    mkdir -p .next/standalone/node_modules/@google-cloud && \
    cp -r node_modules/@google-cloud/bigquery .next/standalone/node_modules/@google-cloud/ && \
    cp -r node_modules/node-cron .next/standalone/node_modules/ && \
    cp -r node_modules/zod .next/standalone/node_modules/

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
