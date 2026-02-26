# Combined Docker Compose Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a single `docker-compose.combined.yml` that runs MyReports + Frappe/ERPNext together on one server, routed by Traefik to `myreports.jestais.com` and `projects.jestais.com`.

**Architecture:** Traefik acts as the single reverse proxy listening on port 80, routing by domain to either the Frappe frontend (port 8080 internal) or MyReports (port 3773 internal). All Frappe internals share a private network; only `frontend` and `myreports` are on the Traefik-facing network. Watchtower auto-deploys MyReports on every push to `main`.

**Tech Stack:** Docker Compose v2, Traefik v3.6, frappe/erpnext, MariaDB 11.8, Redis 6.2, Next.js (GHCR), Watchtower

---

## Task 1: Create `docker-compose.combined.yml`

**Files:**
- Create: `docker-compose.combined.yml`

**Step 1: Create the file**

```yaml
# docker-compose.combined.yml
#
# ── ROUTING ──────────────────────────────────────────────────────────────────
#   projects.jestais.com   → Frappe/ERPNext  (frontend:8080 internal)
#   myreports.jestais.com  → MyReports       (myreports:3773 internal)
#
# ── FIRST-TIME SETUP ─────────────────────────────────────────────────────────
#   1. cp .env.combined.example .env  and fill in all values
#   2. docker login ghcr.io -u malsalem514 -p <github_token_read_packages>
#   3. docker compose -f docker-compose.combined.yml up -d
#   4. Run Frappe site creation (see IT-HANDOFF.md § Frappe Setup)
#
# ── CI/CD ─────────────────────────────────────────────────────────────────────
#   Push to main → GitHub Actions builds image → pushes to GHCR →
#   Watchtower detects new digest → restarts myreports (~2 min)

# ── Shared config for all Frappe services ────────────────────────────────────
x-frappe-image: &frappe-image
  image: ${CUSTOM_IMAGE:-frappe/erpnext}:${CUSTOM_TAG:-${ERPNEXT_VERSION:?Set ERPNEXT_VERSION in .env}}
  platform: linux/amd64

x-frappe-common: &frappe-common
  <<: *frappe-image
  restart: unless-stopped
  volumes:
    - sites:/home/frappe/frappe-bench/sites
  depends_on:
    configurator:
      condition: service_completed_successfully
  networks:
    - internal

services:

  # ── Traefik (reverse proxy) ───────────────────────────────────────────────
  traefik:
    image: traefik:v3.6
    container_name: traefik
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=traefik-public
      - --entrypoints.http.address=:80
      - --accesslog
      - --log
    ports:
      - "80:80"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - traefik-public
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "3"

  # ── MariaDB (Frappe only) ─────────────────────────────────────────────────
  db:
    image: mariadb:11.8
    container_name: frappe-db
    restart: unless-stopped
    healthcheck:
      test: mysqladmin ping -h localhost --password=${DB_PASSWORD:?Set DB_PASSWORD in .env}
      interval: 1s
      retries: 20
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    volumes:
      - db-data:/var/lib/mysql
    networks:
      - internal

  # ── Redis (Frappe only) ───────────────────────────────────────────────────
  redis-cache:
    image: redis:6.2-alpine
    container_name: frappe-redis-cache
    restart: unless-stopped
    networks:
      - internal

  redis-queue:
    image: redis:6.2-alpine
    container_name: frappe-redis-queue
    restart: unless-stopped
    networks:
      - internal

  # ── Frappe Configurator (runs once on first start) ────────────────────────
  configurator:
    <<: *frappe-image
    container_name: frappe-configurator
    restart: "no"
    entrypoint:
      - bash
      - -c
    command:
      - >
        ls -1 apps > sites/apps.txt;
        bench set-config -g db_host $$DB_HOST;
        bench set-config -gp db_port $$DB_PORT;
        bench set-config -g redis_cache "redis://$$REDIS_CACHE";
        bench set-config -g redis_queue "redis://$$REDIS_QUEUE";
        bench set-config -g socketio_port $$SOCKETIO_PORT;
    environment:
      DB_HOST: db
      DB_PORT: "3306"
      REDIS_CACHE: redis-cache:6379
      REDIS_QUEUE: redis-queue:6379
      SOCKETIO_PORT: "9000"
    volumes:
      - sites:/home/frappe/frappe-bench/sites
    depends_on:
      db:
        condition: service_healthy
    networks:
      - internal

  # ── Frappe Backend (app workers) ──────────────────────────────────────────
  backend:
    <<: *frappe-common
    container_name: frappe-backend

  # ── Frappe Frontend (nginx — serves ERPNext UI) ───────────────────────────
  frontend:
    <<: *frappe-common
    container_name: frappe-frontend
    command: nginx-entrypoint.sh
    environment:
      BACKEND: backend:8000
      SOCKETIO: websocket:9000
      FRAPPE_SITE_NAME_HEADER: $$host
      UPSTREAM_REAL_IP_ADDRESS: 127.0.0.1
      UPSTREAM_REAL_IP_RECURSIVE: "off"
      UPSTREAM_REAL_IP_HEADER: X-Forwarded-For
      PROXY_READ_TIMEOUT: "120"
      CLIENT_MAX_BODY_SIZE: "50m"
    depends_on:
      backend:
        condition: service_started
      websocket:
        condition: service_started
      configurator:
        condition: service_completed_successfully
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.frappe.rule=Host(`${FRAPPE_DOMAIN:?Set FRAPPE_DOMAIN in .env}`)"
      - "traefik.http.routers.frappe.entrypoints=http"
      - "traefik.http.services.frappe.loadbalancer.server.port=8080"
    networks:
      - internal
      - traefik-public

  # ── Frappe WebSocket ──────────────────────────────────────────────────────
  websocket:
    <<: *frappe-common
    container_name: frappe-websocket
    command:
      - node
      - /home/frappe/frappe-bench/apps/frappe/socketio.js

  # ── Frappe Queue Workers ──────────────────────────────────────────────────
  queue-short:
    <<: *frappe-common
    container_name: frappe-queue-short
    command: bench worker --num-workers 2 --queue short,default

  queue-long:
    <<: *frappe-common
    container_name: frappe-queue-long
    command: bench worker --num-workers 1 --queue long

  # ── Frappe Scheduler ──────────────────────────────────────────────────────
  scheduler:
    <<: *frappe-common
    container_name: frappe-scheduler
    command: bench schedule

  # ── MyReports (Next.js dashboard) ────────────────────────────────────────
  myreports:
    image: ghcr.io/malsalem514/myreports:latest
    container_name: myreports
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3773"
      NEXTAUTH_URL: "https://${MYREPORTS_DOMAIN:?Set MYREPORTS_DOMAIN in .env}"
      AUTH_SECRET: ${NEXTAUTH_SECRET:?Set NEXTAUTH_SECRET in .env}
      AZURE_AD_CLIENT_ID: ${AZURE_AD_CLIENT_ID:?Set AZURE_AD_CLIENT_ID in .env}
      AZURE_AD_CLIENT_SECRET: ${AZURE_AD_CLIENT_SECRET:?Set AZURE_AD_CLIENT_SECRET in .env}
      AZURE_AD_TENANT_ID: ${AZURE_AD_TENANT_ID:?Set AZURE_AD_TENANT_ID in .env}
      ORACLE_USER: ${ORACLE_USER:?Set ORACLE_USER in .env}
      ORACLE_PASSWORD: ${ORACLE_PASSWORD:?Set ORACLE_PASSWORD in .env}
      ORACLE_CONNECT_STRING: ${ORACLE_CONNECT_STRING:?Set ORACLE_CONNECT_STRING in .env}
      BAMBOOHR_API_KEY: ${BAMBOOHR_API_KEY:?Set BAMBOOHR_API_KEY in .env}
      BAMBOOHR_SUBDOMAIN: ${BAMBOOHR_SUBDOMAIN:-jestais}
      BIGQUERY_PROJECT_ID: ${BIGQUERY_PROJECT_ID:-}
      BIGQUERY_DATASET: ${BIGQUERY_DATASET:-}
      GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/google-sa.json
      ENABLE_SCHEDULER: "false"
    extra_hosts:
      - "${ORACLE_DB_HOST:-srv-db-100}:${ORACLE_DB_IP:?Set ORACLE_DB_IP in .env}"
    volumes:
      - "${GOOGLE_SA_JSON_PATH:?Set GOOGLE_SA_JSON_PATH in .env}:/run/secrets/google-sa.json:ro"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3773/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      start_period: 40s
      retries: 3
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.myreports.rule=Host(`${MYREPORTS_DOMAIN}`)"
      - "traefik.http.routers.myreports.entrypoints=http"
      - "traefik.http.services.myreports.loadbalancer.server.port=3773"
      - "com.centurylinklabs.watchtower.enable=true"
    networks:
      - traefik-public
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"

  # ── Watchtower (auto-deploy MyReports on push) ────────────────────────────
  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /root/.docker/config.json:/config.json:ro
    command: --interval 120 --cleanup --label-enable
    networks:
      - internal
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

# ── Volumes ───────────────────────────────────────────────────────────────────
volumes:
  db-data:
  sites:

# ── Networks ──────────────────────────────────────────────────────────────────
networks:
  traefik-public:
    name: traefik-public
  internal:
    name: jestais-internal
```

**Step 2: Verify the file parses correctly**

```bash
docker compose -f docker-compose.combined.yml config --quiet
```

Expected: no output, exit code 0. If it errors, fix the YAML and retry.

**Step 3: Commit**

```bash
git add docker-compose.combined.yml
git commit -m "feat: add combined docker-compose for MyReports + Frappe/ERPNext"
```

---

## Task 2: Create `.env.combined.example`

**Files:**
- Create: `.env.combined.example`

**Step 1: Create the file**

```bash
cat > .env.combined.example << 'EOF'
# ============================================================
# .env.combined.example
# Copy to .env and fill in all values before running:
#   cp .env.combined.example .env
# ============================================================

# ── Routing domains ──────────────────────────────────────────
FRAPPE_DOMAIN=projects.jestais.com
MYREPORTS_DOMAIN=myreports.jestais.com

# ── Frappe / ERPNext ─────────────────────────────────────────
ERPNEXT_VERSION=v15.x.x          # e.g. v15.30.2 — check https://github.com/frappe/erpnext/releases
DB_PASSWORD=change-me-strong-password

# ── MyReports — Azure AD SSO ─────────────────────────────────
# Get these from IT after they register the app in Entra ID
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=
NEXTAUTH_SECRET=                  # Run: openssl rand -base64 32

# ── MyReports — Oracle ────────────────────────────────────────
ORACLE_USER=timelogs
ORACLE_PASSWORD=
ORACLE_CONNECT_STRING=srv-db-100/suppops
ORACLE_DB_HOST=srv-db-100
ORACLE_DB_IP=                     # IP address of Oracle server (required)

# ── MyReports — BambooHR ─────────────────────────────────────
BAMBOOHR_API_KEY=
BAMBOOHR_SUBDOMAIN=jestais

# ── MyReports — BigQuery (optional) ──────────────────────────
BIGQUERY_PROJECT_ID=us-activtrak-ac-prod
BIGQUERY_DATASET=672561
GOOGLE_SA_JSON_PATH=/secure/path/to/google-sa.json

# ── Watchtower — GHCR pull access ────────────────────────────
# One-time login on the server (not in this file):
#   docker login ghcr.io -u malsalem514 -p <github_token_read_packages>
EOF
```

**Step 2: Verify it exists and looks right**

```bash
cat .env.combined.example
```

**Step 3: Commit**

```bash
git add .env.combined.example
git commit -m "feat: add combined env example for MyReports + Frappe deployment"
```

---

## Task 3: Update `IT-HANDOFF.md`

**Files:**
- Modify: `IT-HANDOFF.md`

**Step 1: Add a new "Combined Deployment" section**

Open `IT-HANDOFF.md` and add the following section after the existing "Production Deployment" section:

```markdown
---

## Combined Deployment (MyReports + Frappe/ERPNext)

Use this when hosting both apps on the same server.

### What You Get

| URL | App |
|-----|-----|
| `myreports.jestais.com` | MyReports attendance dashboard |
| `projects.jestais.com` | Frappe/ERPNext |

Both are routed by a single Traefik container on port 80.

### Prerequisites

1. **Azure AD app registration** (from IT/Entra ID admin):
   - `AZURE_AD_CLIENT_ID`
   - `AZURE_AD_CLIENT_SECRET`
   - `AZURE_AD_TENANT_ID`
   - Redirect URI set to: `https://myreports.jestais.com/api/auth/callback/azure-ad`

2. **GHCR login** (one-time, lets Watchtower auto-update MyReports):
   ```bash
   docker login ghcr.io -u malsalem514 -p <github_token_with_read:packages>
   ```

3. **DNS records** pointing both domains to the server IP.

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/malsalem514/MyReports
cd MyReports

# 2. Create and fill .env
cp .env.combined.example .env
nano .env   # fill in all values

# 3. Generate NEXTAUTH_SECRET if needed
openssl rand -base64 32

# 4. Start everything
docker compose -f docker-compose.combined.yml up -d

# 5. Verify all 11 containers are running
docker compose -f docker-compose.combined.yml ps
```

### Frappe First-Time Site Setup

After the stack is running, create the ERPNext site:

```bash
docker compose -f docker-compose.combined.yml exec backend \
  bench new-site projects.jestais.com \
  --mariadb-root-password <DB_PASSWORD> \
  --admin-password <FRAPPE_ADMIN_PASSWORD> \
  --install-app erpnext

docker compose -f docker-compose.combined.yml exec backend \
  bench --site projects.jestais.com set-config host_name https://projects.jestais.com
```

### Continuous Deployment (MyReports only)

```
git push to main
      ↓
GitHub Actions builds image → pushes to ghcr.io/malsalem514/myreports:latest
      ↓
Watchtower detects new digest (polls every 2 min)
      ↓
Pulls new image → restarts myreports container
```

No server access needed after initial setup.

### Common Operations

| Task | Command |
|------|---------|
| View all logs | `docker compose -f docker-compose.combined.yml logs -f` |
| MyReports logs only | `docker logs -f myreports` |
| Frappe logs | `docker logs -f frappe-backend` |
| Watchtower logs | `docker logs -f watchtower` |
| Restart MyReports | `docker compose -f docker-compose.combined.yml restart myreports` |
| Restart all Frappe | `docker compose -f docker-compose.combined.yml restart backend frontend websocket` |
| Stop everything | `docker compose -f docker-compose.combined.yml down` |
| Force pull latest MyReports | `docker compose -f docker-compose.combined.yml pull myreports && docker compose -f docker-compose.combined.yml up -d myreports` |
```

**Step 2: Verify the file looks correct**

```bash
grep -n "Combined Deployment" IT-HANDOFF.md
```

Expected: finds the new section heading.

**Step 3: Commit**

```bash
git add IT-HANDOFF.md
git commit -m "docs: add combined deployment section to IT-HANDOFF.md"
```

---

## Task 4: Push and verify

**Step 1: Push the branch**

```bash
git push origin claude/crazy-easley
```

**Step 2: Verify on GitHub that all 3 files appear in the branch**

Check:
- `docker-compose.combined.yml` ✅
- `.env.combined.example` ✅
- `IT-HANDOFF.md` updated ✅

**Step 3: Confirm `docker compose config` passes**

On the server (or locally with dummy env vars), validate the compose file:

```bash
# Use dummy values just to test YAML parsing
FRAPPE_DOMAIN=x MYREPORTS_DOMAIN=x ERPNEXT_VERSION=v15.0.0 DB_PASSWORD=x \
AZURE_AD_CLIENT_ID=x AZURE_AD_CLIENT_SECRET=x AZURE_AD_TENANT_ID=x \
NEXTAUTH_SECRET=x ORACLE_USER=x ORACLE_PASSWORD=x ORACLE_CONNECT_STRING=x \
ORACLE_DB_IP=1.2.3.4 BAMBOOHR_API_KEY=x GOOGLE_SA_JSON_PATH=/tmp/x \
docker compose -f docker-compose.combined.yml config --quiet
```

Expected: exits 0 with no errors.
