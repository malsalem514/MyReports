# Combined Docker Compose + SSO Design

**Date:** 2026-02-26
**Status:** Approved

## Overview

Two goals in one IT deployment request:

1. **Azure AD SSO** — already implemented in code, needs env vars from IT
2. **Combined Docker Compose** — single file running MyReports + Frappe/ERPNext together on one server

## SSO Status

Azure AD / Microsoft Entra ID SSO is **fully implemented**. No code changes needed.

| File | Purpose |
|------|---------|
| `auth.ts` | NextAuth v5 with Entra ID provider |
| `middleware.ts` | Protects all `/dashboard` routes, redirects to `/login` |
| `lib/access.ts` | Row-level security: self / team / all via BambooHR |
| `app/login/page.tsx` | Sign-in page with Azure AD button |
| `lib/dev-bypass.ts` | Local dev bypass via `DEV_BYPASS_AUTH=true` |

HR admin access is controlled by a hardcoded list in `lib/access.ts`:
```typescript
const HR_ADMIN_EMAILS = ['hr@jestais.com', 'malsalem@jestais.com']
```

IT needs to provide these env vars to activate SSO:
```
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=
NEXTAUTH_SECRET=          # any random 32+ char string
NEXTAUTH_URL=https://myreports.jestais.com
```

## Combined Docker Compose Architecture

### Services (11 total — one `docker compose up -d`)

| # | Service | Image | Purpose |
|---|---------|-------|---------|
| 1 | `traefik` | `traefik:v3.6` | Reverse proxy, routes both domains |
| 2 | `db` | `mariadb:11.8` | Database for Frappe only |
| 3 | `configurator` | `frappe/erpnext` | One-time Frappe site setup |
| 4 | `backend` | `frappe/erpnext` | Frappe app workers |
| 5 | `frontend` | `frappe/erpnext` | nginx serving ERPNext UI |
| 6 | `websocket` | `frappe/erpnext` | Frappe real-time |
| 7 | `queue-short` | `frappe/erpnext` | Background jobs |
| 8 | `queue-long` | `frappe/erpnext` | Background jobs |
| 9 | `scheduler` | `frappe/erpnext` | Scheduled tasks |
| 10 | `myreports` | `ghcr.io/malsalem514/myreports:latest` | Next.js dashboard |
| 11 | `watchtower` | `containrrr/watchtower` | Auto-deploy MyReports on push |

### Routing

```
projects.jestais.com   → frontend:8484    (Frappe/ERPNext)
myreports.jestais.com  → myreports:3773   (MyReports)
```

Traefik listens on **port 80** externally. Internal ports (8484, 3773) are container-to-container only — users see no port number in the URL.

### Networks

```
traefik-public   — shared by traefik, frontend, myreports (routing layer)
default          — internal: db, backend, websocket, queues, scheduler
```

### Volumes

```
db-data    — MariaDB persistence (Frappe)
sites      — Frappe bench sites (shared across Frappe services)
```

MyReports has no persistent volumes — all state is in Oracle (external) and Azure AD sessions.

## Files to Produce

| File | Action | Notes |
|------|--------|-------|
| `docker-compose.combined.yml` | Create | All 11 services, single file |
| `.env.combined.example` | Create | All env vars for both apps |
| `IT-HANDOFF.md` | Update | Combined deployment instructions |

`docker-compose.production.yml` remains untouched as a MyReports-only fallback.

## Environment Variables

### MyReports
```
# Azure AD SSO
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://myreports.jestais.com

# Oracle
ORACLE_USER=
ORACLE_PASSWORD=
ORACLE_CONNECTION_STRING=

# BambooHR
BAMBOOHR_API_KEY=
BAMBOOHR_SUBDOMAIN=

# App
NODE_ENV=production
PORT=3773
```

### Frappe/ERPNext
```
ERPNEXT_VERSION=
DB_PASSWORD=
SITE_NAME=projects.jestais.com
```

### Traefik
```
TRAEFIK_DOMAIN=traefik.jestais.com    # optional admin dashboard
HASHED_PASSWORD=                       # for Traefik dashboard auth
```

## Deployment Flow (IT)

```
1. git clone https://github.com/malsalem514/MyReports
2. Copy .env.combined.example → .env, fill in values
3. docker login ghcr.io (one-time, for Watchtower)
4. docker compose -f docker-compose.combined.yml up -d
5. Configure Frappe site (one-time bench setup)
```

## CI/CD (already live)

Push to `main` → GitHub Actions builds image → pushes to GHCR →
Watchtower detects new digest → pulls + restarts `myreports` container (~2 min).

Frappe updates are manual: pull new image tag, restart services.
