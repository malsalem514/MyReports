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
# Compile lib/ to CJS for instrumentation runtime imports
# (webpackIgnore in instrumentation.ts skips bundling these; they must exist
# at .next/server/lib/*.js for the dynamic import to resolve at runtime)
RUN npx tsc --outDir .next/standalone/.next/server \
    --rootDir . \
    --module commonjs --target es2022 \
    --esModuleInterop --skipLibCheck \
    --declaration false --sourceMap false \
    --moduleResolution node \
    lib/scheduler.ts && \
    # Copy packages that the lib files require but standalone tracing missed
    # (because webpackIgnore prevented webpack from tracing them)
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
