# MyReports Production Docker Audit Plan

Last updated: 2026-02-26
Owner: MyReports Engineering
Status: In Progress

## 1) Goal

Ship a production-safe Docker deployment package for MyReports that:
- starts reliably in containerized environments,
- enforces secure auth behavior in production,
- keeps data access scoped correctly by role,
- gives IT a clear runbook with validation and rollback steps.

## 2) Scope Reviewed

Reviewed areas:
- Docker packaging (`Dockerfile`, `.dockerignore`)
- Runtime startup and background sync wiring
- Auth and bypass controls
- Role-scoped reporting data paths
- Health endpoint behavior for production operations
- Handoff/deployment documentation

## 3) Current State (as of 2026-02-26)

### Completed in code

1. `DEV_BYPASS_*` is now hard-disabled when `NODE_ENV=production`, with explicit log message.
   - `lib/dev-bypass.ts`
   - `middleware.ts`
   - `app/login/page.tsx`
   - `lib/access.ts`

2. TBS “unmapped employees” data is now HR-only at data query level.
   - `lib/dashboard-data.ts`

### Still open

1. Docker runtime binding/health hardening not yet implemented.
2. Scheduler is not wired to server startup (`instrumentation.ts` missing).
3. `.dockerignore` still includes sensitive build-context risk (`.claude` not excluded).
4. No dedicated production compose file (`docker-compose.production.yml` missing).
5. `/api/health?deep=1` remains unauthenticated and returns detailed dependency diagnostics.
6. `HR_ADMIN_EMAILS` still contains placeholder `admin@company.com`.

## 4) Priority Plan

## Phase A — Critical

### A1. Harden Docker runtime

Files:
- Modify `Dockerfile`

Changes:
- Add `ENV HOSTNAME=0.0.0.0`.
- Keep `ENV PORT=3000`.
- Add image `HEALTHCHECK` against `/api/health`.
- Use `--chown=nextjs:nodejs` for copied runtime artifacts.

Acceptance:
- `docker run -p 3000:3000 myreports:latest` is reachable externally.
- `docker inspect` shows healthy container state after startup.

### A2. Wire scheduler and datastore init on startup

Files:
- Add `instrumentation.ts`

Changes:
- In `register()`, run only for `NEXT_RUNTIME=nodejs`.
- Call `initializeDataStore(false)` and `initializeScheduler()`.
- Log failures clearly without crashing app startup.

Acceptance:
- Container logs show schema/scheduler initialization (or explicit non-fatal failure).
- Cron schedules are registered once per process.

## Phase B — High

### B1. Fix build context hygiene

Files:
- Modify `.dockerignore`

Changes:
- Add `.claude/`.

Acceptance:
- Docker build context excludes local assistant/worktree metadata.

### B2. Create production compose entrypoint

Files:
- Add `docker-compose.production.yml`

Changes:
- Single service with `restart: unless-stopped`.
- `env_file: myreports.env`.
- Oracle host mapping via `extra_hosts`.
- Service-account mount as read-only volume.
- Optional healthcheck and log rotation options.

Acceptance:
- `docker compose -f docker-compose.production.yml config` succeeds.
- Service starts cleanly from image tar + env file.

### B3. Remove placeholder HR admin identity

Files:
- Modify `lib/access.ts`

Changes:
- Remove `admin@company.com` from `HR_ADMIN_EMAILS`.

Acceptance:
- Only real intended HR admin accounts remain.

## Phase C — Production Hardening

### C1. Restrict deep health diagnostics

Files:
- Modify `app/api/health/route.ts`

Changes:
- Keep `/api/health` lightweight and public.
- Gate `/api/health?deep=1` behind authenticated HR/admin or internal token.
- Avoid returning raw backend error messages in public responses.

Acceptance:
- Public check remains usable for liveness/readiness.
- Dependency internals are not exposed anonymously.

### C2. Typecheck reliability on clean checkout

Files:
- Modify `package.json` and/or `tsconfig.json`

Changes (choose one):
- Make `typecheck` run `next typegen` first, or
- remove hard dependency on `.next/types/**/*.ts` in clean CI path.

Acceptance:
- `npm run typecheck` passes on a clean checkout before `npm run build`.

## 5) Validation Matrix

Required command checks:

```bash
npm run build
npm run typecheck
npm run docker:build
docker run --rm -p 3000:3000 --env-file myreports.env myreports:latest
curl -s http://localhost:3000/api/health
docker compose -f docker-compose.production.yml config
```

Recommended runtime checks:
- Confirm scheduler startup log line(s).
- Confirm `/dashboard` requires auth in production.
- Confirm non-HR users do not receive unmapped employee lists in TBS compare.

## 6) Rollback Plan

If release issues occur:
- Revert to last known-good image tar (`myreports-latest-<date>.tar`).
- Keep database schema untouched (all schema init is idempotent).
- Disable scheduler by env (`ENABLE_SCHEDULER=false`) as a temporary safety valve.

## 7) Execution Order

1. Phase A (`A1`, `A2`)
2. Phase B (`B1`, `B2`, `B3`)
3. Phase C (`C1`, `C2`)
4. Re-run full validation matrix
5. Update `IT-HANDOFF.md` with exact production commands and troubleshooting notes

## 8) Notes

- This plan supersedes ad-hoc draft copies in local worktree metadata folders.
- `DEV_BYPASS_*` behavior is now explicitly fail-safe in production by code.
