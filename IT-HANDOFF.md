# IT Handoff: MyReports

## What You're Deploying

MyReports is a Next.js web application providing HR attendance and timesheet
reporting dashboards. It connects to four external services:

- **Oracle DB** — primary data store (on your network at `srv-db-100`)
- **Google BigQuery** — attendance source data (requires a service account JSON file)
- **BambooHR** — employee directory (cloud API, requires API key)
- **Microsoft Azure AD** — user login via Microsoft SSO

A scheduler inside the container syncs data at **6 AM, 12 PM, and 3 PM Toronto time** daily.

---

## What You Receive

```
docker-compose.production.yml  ← Start/stop the container (image pulled from GHCR automatically)
IT-HANDOFF.md                  ← This document
```

The Docker image is built and published automatically via GitHub Actions whenever code is
merged to `main`. You do not need to manually load any `.tar` file.

---

## Step 1 — One-time GHCR login (enables auto-updates)

The container image lives in GitHub Container Registry (GHCR). Log in once so Docker can
pull it and so Watchtower can check for updates automatically:

```bash
docker login ghcr.io -u malsalem514 -p <github_personal_access_token>
```

**Creating the token** (takes 2 minutes):
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Set scope: **Read access to packages** (repository: `malsalem514/MyReports`)
3. Paste the token as the password above

This is needed **once**. Credentials are saved to `/root/.docker/config.json` and
Watchtower reads them automatically for all future updates.

---

## Step 2 — Create the environment file (secrets)

Create a file called **`myreports.env`** in the same folder as `docker-compose.production.yml`.
This file holds all secrets. **Do not commit it to any repository. Set permissions to 600.**

```bash
chmod 600 myreports.env
```

Contents of `myreports.env`:

```env
# ── Authentication ──────────────────────────────────────────────────────────
AUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.com          # Exact URL users will visit

AZURE_AD_CLIENT_ID=<from Azure App Registration>
AZURE_AD_CLIENT_SECRET=<from Azure App Registration>
AZURE_AD_TENANT_ID=<your Azure tenant ID>

# ── Oracle Database ─────────────────────────────────────────────────────────
ORACLE_USER=timelogs
ORACLE_PASSWORD=<oracle password>
ORACLE_CONNECT_STRING=srv-db-100/suppops

# ── Google BigQuery ─────────────────────────────────────────────────────────
BIGQUERY_PROJECT_ID=us-activtrak-ac-prod
BIGQUERY_DATASET=672561
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-sa.json

# ── BambooHR ────────────────────────────────────────────────────────────────
BAMBOOHR_API_KEY=<bamboohr api key>
BAMBOOHR_SUBDOMAIN=jestais

# ── Scheduler ───────────────────────────────────────────────────────────────
ENABLE_SCHEDULER=true          # Syncs at 6 AM / 12 PM / 3 PM Toronto time

# ── DANGER — never set this in production ───────────────────────────────────
# DEV_BYPASS_AUTH=true         # Disables ALL login checks — setting this is a no-op in production
```

---

## Step 3 — Export shell variables

Run these in the same terminal before starting compose:

```bash
export ORACLE_DB_HOST=srv-db-100
export ORACLE_DB_IP=172.16.25.63          # IP address of Oracle server
export GOOGLE_SA_JSON_PATH=/secure/path/to/google-sa.json  # REQUIRED — no default
```

---

## Step 4 — Start the container

```bash
docker compose -f docker-compose.production.yml up -d
```

Expected:
```
✔ Container myreports   Started
✔ Container watchtower  Started
```

Docker will pull `ghcr.io/malsalem514/myreports:latest` automatically on first start.
After that, **Watchtower handles all future updates** — no manual steps needed when
developers push new code.

---

## Step 5 — Verify it's running

```bash
# Basic liveness check (public — no login required)
curl http://localhost:3000/api/health

# Full integration check (requires a logged-in session — see note below)
curl http://localhost:3000/api/health?deep=1
```

**Basic response** (always works if container started):
```json
{"status":"ok","service":"myreports","timestamp":"2026-02-26T10:00:00.000Z"}
```

**Deep response when all integrations are healthy:**
```json
{"status":"ok","checks":{"oracle":true,"bigQuery":true,"bambooHR":true}}
```

**Deep response when something is failing:**
```json
{"status":"degraded","checks":{"oracle":false,"bigQuery":true,"bambooHR":true},
 "details":{"oracle":{"ok":false,"error":"ORA-12541: no listener"}}}
```

> **Note:** `/api/health?deep=1` requires a valid login session. To use it for monitoring,
> log in via the browser first, then use browser devtools to copy the session cookie.
> For automated monitoring, use the basic `/api/health` endpoint instead.

---

## Step 6 — Configure reverse proxy

The container listens on **port 3000**. Point your reverse proxy (nginx, IIS, Traefik)
at `localhost:3000`. Do not expose port 3000 directly to the internet.

**Required nginx config** for Microsoft SSO redirects to work correctly:

```nginx
location / {
    proxy_pass         http://localhost:3000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

**Also required in Azure Portal** — add a redirect URI to your App Registration:
```
https://your-domain.com/api/auth/callback/microsoft-entra-id
```

`NEXTAUTH_URL` in `myreports.env` must exactly match the URL users visit (including `https://`).

---

## Scheduler

The container runs a built-in data sync scheduler:

| Time (Toronto) | Job |
|---|---|
| 6:00 AM | Full 7-day sync (employees, attendance, time-off) |
| 12:00 PM | 1-day refresh |
| 3:00 PM | 1-day refresh |

To confirm the scheduler started after deployment:
```bash
docker logs myreports | grep -i scheduler
```
Expected: `Scheduler initialized. Syncs at 6 AM, 12 PM, 3 PM ET.`

If `ENABLE_SCHEDULER` is not set to `true`, no syncs happen and data must be loaded manually.

---

## Continuous Deployment

Once the container is running, all future code updates are fully automatic:

```
Developer pushes to main
       ↓
GitHub Actions builds image (~3-5 min)
       ↓
Image pushed to ghcr.io/malsalem514/myreports:latest
       ↓
Watchtower detects new digest (within 2 min)
       ↓
Container restarted with new image automatically
```

To check if Watchtower updated the container:
```bash
docker logs watchtower --tail=50
```

---

## Common Operations

```bash
# View live app logs
docker logs myreports --tail=100 -f

# View Watchtower update logs
docker logs watchtower --tail=50

# Restart the app (e.g. after env change)
docker compose -f docker-compose.production.yml restart myreports

# Stop everything
docker compose -f docker-compose.production.yml down

# Force an immediate update (pull latest image and restart)
docker compose -f docker-compose.production.yml pull myreports
docker compose -f docker-compose.production.yml up -d myreports
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Page doesn't load at all | Reverse proxy not configured, or container not running | Check `docker ps`; check nginx/IIS config |
| Login redirect error | `NEXTAUTH_URL` doesn't match actual URL | Update and restart |
| Login works but dashboard is empty | Oracle or BigQuery unreachable | Log in, then run `/api/health?deep=1` in browser |
| `/api/health` returns connection refused | Container not running | `docker compose up -d` |
| Container exits immediately | Missing or invalid env var | `docker logs myreports` to see the error |
| Scheduler not syncing | `ENABLE_SCHEDULER` not `true` | Add to `myreports.env` and restart |
| `oracle: false` in health check | Oracle host not reachable | Verify `ORACLE_DB_IP`; check `extra_hosts` in compose |
| `bigQuery: false` in health check | Service account file missing or invalid | Verify `GOOGLE_SA_JSON_PATH` and file contents |
| `bambooHR: false` in health check | Invalid or expired API key | Verify `BAMBOOHR_API_KEY` in `myreports.env` |

---

## Security Notes

- `myreports.env` contains credentials — store it securely (`chmod 600 myreports.env`)
- The Google service account JSON is mounted read-only (`:ro`) — do not change this
- The container runs as a non-root user (uid 1001)
- `DEV_BYPASS_AUTH=true` is a development flag — it is automatically disabled in production even if set

---

## Pre Go-Live Checklist

**One-time server setup:**
- [ ] `docker login ghcr.io` completed with a GitHub token that has `read:packages` scope
- [ ] `myreports.env` created — no empty required fields
- [ ] `AUTH_SECRET` is a long random string (`openssl rand -base64 32`)
- [ ] `NEXTAUTH_URL` matches the exact URL users will visit (with `https://`)
- [ ] Azure AD redirect URI added: `https://your-domain.com/api/auth/callback/microsoft-entra-id`
- [ ] Oracle reachable from the server (`ping 172.16.25.63` or `ping srv-db-100`)
- [ ] Google SA JSON file exists at path in `GOOGLE_SA_JSON_PATH`

**Verification:**
- [ ] `docker ps` shows both `myreports` and `watchtower` running
- [ ] `curl http://localhost:3000/api/health` returns `"status":"ok"`
- [ ] Reverse proxy configured — `https://your-domain.com` loads the login page
- [ ] Login tested with a real Microsoft account
- [ ] `docker logs myreports | grep scheduler` shows scheduler initialized
- [ ] `ENABLE_SCHEDULER=true` confirmed in `myreports.env`
- [ ] `docker logs watchtower` shows no credential errors (GHCR pull working)

---

## Combined Deployment (MyReports + Frappe/ERPNext)

Use this when hosting both apps on the same server under one Docker Compose stack.

### What You Get

| URL | App |
|-----|-----|
| `myreports.jestais.com` | MyReports attendance dashboard |
| `projects.jestais.com` | Frappe/ERPNext |

Both are routed by a single Traefik container on port 80. The stack runs 13 containers total.

### Prerequisites

1. **Azure AD app registration** — ask your Entra ID admin to register an app and give you:
   - `AZURE_AD_CLIENT_ID`
   - `AZURE_AD_CLIENT_SECRET`
   - `AZURE_AD_TENANT_ID`
   - Set redirect URI to: `https://myreports.jestais.com/api/auth/callback/azure-ad`

2. **DNS records** — point both domains to the server IP before starting.

3. **GHCR login** (one-time — lets Watchtower auto-update MyReports):
   ```bash
   docker login ghcr.io -u malsalem514 -p <github_token_with_read:packages>
   ```

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/malsalem514/MyReports
cd MyReports

# 2. Create and fill .env
cp .env.combined.example .env
nano .env   # fill in all values

# 3. Generate NEXTAUTH_SECRET
openssl rand -base64 32
# paste the output into .env as NEXTAUTH_SECRET

# 4. Start everything (13 containers)
docker compose -f docker-compose.combined.yml up -d

# 5. Verify all containers are running
docker compose -f docker-compose.combined.yml ps
```

### Frappe First-Time Site Setup

Run these once after the stack is up:

```bash
# Create the ERPNext site
docker compose -f docker-compose.combined.yml exec backend \
  bench new-site projects.jestais.com \
  --mariadb-root-password <DB_PASSWORD from .env> \
  --admin-password <choose an ERPNext admin password> \
  --install-app erpnext

# Set the hostname
docker compose -f docker-compose.combined.yml exec backend \
  bench --site projects.jestais.com set-config host_name https://projects.jestais.com

# Set site as default
docker compose -f docker-compose.combined.yml exec backend \
  bench use projects.jestais.com

# ── CRITICAL: Enable Server Scripts ───────────────────────────────────────────
# This allows the ERPNext administrator to add custom business logic,
# validations, and automations entirely through the web interface — without
# needing server or container access after handoff.
# Must be set NOW, before handing over to the business admin.
docker compose -f docker-compose.combined.yml exec backend \
  bench --site projects.jestais.com set-config server_script_enabled 1

# Restart workers so the setting takes effect
docker compose -f docker-compose.combined.yml restart backend queue-short queue-long
```

### ERPNext Pre-Handoff Checklist

Complete this checklist **before** giving the admin credentials to the business team.
Once handed off, these steps require container access to undo.

**Site configuration (server-side — do once):**
- [ ] ERPNext site created and accessible at `https://projects.jestais.com`
- [ ] `server_script_enabled = 1` — set via command above
- [ ] `host_name` set correctly (HTTPS URL — affects cookies and email links)
- [ ] Admin password noted and ready to hand to business admin
- [ ] Backup confirmed working: `docker exec frappe-backend bench --site projects.jestais.com backup`

**What the business admin CAN do without server access (after handoff):**

| Task | Where in ERPNext |
|---|---|
| Add custom fields to any form | `Awesome Bar > Custom Field` |
| Add validation / automation logic | `Awesome Bar > Server Script` |
| Add UI show/hide / custom buttons | `Awesome Bar > Client Script` |
| Customize print format layout | `Awesome Bar > Print Format` |
| Set company branding / logo | `Company master > upload logo` |
| Manage users and roles | `Home > Users` |
| Configure modules per user | `Awesome Bar > Module Profile` |
| Set up workflows | `Awesome Bar > Workflow` |
| Schedule reports by email | `Awesome Bar > Auto Email Report` |

**What still requires container access (cannot be done via web UI):**

| Task | Why |
|---|---|
| Install a new Frappe app | `bench get-app` + `bench install-app` |
| White-label the Desk navbar/CSS | Requires custom app + `hooks.py` changes |
| Run database migrations | `bench migrate` |
| Change `server_script_enabled` toggle | Site config — requires `bench set-config` |
| Restore a backup | `bench --site … restore` |

### Metabase Setup (BI / Analytics)

Metabase starts automatically with the stack at `https://analytics.jestais.com`.
**First boot takes ~2 minutes** (Java + database migrations) — the health check will show
`starting` until it's ready.

#### Step 1 — Create a read-only MariaDB user for Metabase

Run this once after `bench new-site`. Replace `<password>` and the database name
(the database name matches your site name with dots replaced by underscores,
e.g. `projects_jestais_com`):

```bash
docker exec -it frappe-db mariadb -u root -p${DB_PASSWORD}
```

Then in the MariaDB prompt:

```sql
CREATE USER 'metabase_ro'@'%' IDENTIFIED BY '<choose a password>';
GRANT SELECT ON `projects_jestais_com`.* TO 'metabase_ro'@'%';
FLUSH PRIVILEGES;
EXIT;
```

> **Why read-only?** Metabase never needs to write to ERPNext's database. A read-only
> user prevents accidental data modification and limits blast radius if credentials leak.

#### Step 2 — First-time Metabase UI setup

1. Open `https://analytics.jestais.com` — you'll see the Metabase setup wizard
2. Create your admin account (email + password)
3. When asked **"Add your data"**, choose **MariaDB** and enter:
   - **Host:** `frappe-db`
   - **Port:** `3306`
   - **Database name:** `projects_jestais_com` (your ERPNext site db)
   - **Username:** `metabase_ro`
   - **Password:** the password you set above
4. Click **"Test connection"** → should show ✅
5. Finish setup

#### What you can do in Metabase

| Task | How |
|---|---|
| Browse ERPNext tables | Browse Data → frappe-db → pick any table |
| Write SQL queries | New → SQL query → select frappe-db |
| Build visual charts | New → Question → select table → pick chart type |
| Assemble dashboards | New → Dashboard → add saved questions/charts |
| Schedule email reports | Dashboard → `...` → Subscriptions → add email/Slack |
| Share a dashboard | Dashboard → Share → public link or embed |

#### Useful ERPNext tables in Metabase

| Table | Contains |
|---|---|
| `tabSales Invoice` | All sales invoices |
| `tabSales Invoice Item` | Line items per invoice |
| `tabProject` | Projects with billing/cost totals |
| `tabTimesheet Detail` | Individual time logs |
| `tabPayment Entry` | Payments received/made |
| `tabCustomer` | Customer master |
| `tabEmployee` | Employee master |
| `tabGL Entry` | Full general ledger (every accounting entry) |

> **Tip:** All ERPNext doctypes are stored as `tab<DocType Name>` in MariaDB.
> Use Metabase's table browser to explore — all fields are visible.

---

### Continuous Deployment (MyReports only)

```
git push to main
      ↓
GitHub Actions builds image → pushes to ghcr.io/malsalem514/myreports:latest
      ↓
Watchtower detects new digest (polls every 2 min)
      ↓
Pulls new image → restarts myreports container automatically
```

No server access needed after initial setup.

### Common Operations

| Task | Command |
|------|---------|
| View all logs | `docker compose -f docker-compose.combined.yml logs -f` |
| MyReports logs only | `docker logs -f myreports` |
| Frappe backend logs | `docker logs -f frappe-backend` |
| Watchtower logs | `docker logs -f watchtower` |
| Restart MyReports | `docker compose -f docker-compose.combined.yml restart myreports` |
| Restart Frappe services | `docker compose -f docker-compose.combined.yml restart backend frontend websocket` |
| Stop everything | `docker compose -f docker-compose.combined.yml down` |
| Force pull latest MyReports | `docker compose -f docker-compose.combined.yml pull myreports && docker compose -f docker-compose.combined.yml up -d myreports` |
| Update ERPNext version | Edit `ERPNEXT_VERSION` in `.env`, then `docker compose -f docker-compose.combined.yml up -d` |
