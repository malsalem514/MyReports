# Server Access — srv-test-docker-musa

This file documents the old Windows Docker host.

MyReports production now runs on the Linux host documented in [`/Users/musaalsalem/.codex/worktrees/033d/MyReports/docs/LINUX-PRODUCTION-SERVER-ACCESS.md`](/Users/musaalsalem/.codex/worktrees/033d/MyReports/docs/LINUX-PRODUCTION-SERVER-ACCESS.md).

## Connection Details

| Field | Value |
|-------|-------|
| Hostname | srv-test-docker-musa |
| IP | 172.16.30.77 |
| OS | Windows 11 Pro (VMware VM) |
| User | `malsalem@jestais.com` |
| Credentials | Retrieve from the approved secret store or IT owner. Do not store passwords in this repo. |

## SSH Connection

This host is obsolete for MyReports production. If access is still needed for ERPNext or historical recovery, use your local SSH client and retrieve credentials from the approved secret store at runtime.

```bash
ssh 'malsalem@jestais.com'@172.16.30.77
```

> Use IP `172.16.30.77` if hostname resolution fails.
> Do not commit passwords or disable host key verification in repository examples.

## File Transfer (SCP)

```bash
scp /local/file 'malsalem@jestais.com'@172.16.30.77:'C:\remote\path\'
```

## Running Commands

The default SSH shell is **cmd.exe** (not bash). For complex commands with pipes or quotes, use base64-encoded PowerShell:

```bash
CMD='your-command-here 2>&1'
ENCODED=$(echo "$CMD" | iconv -t UTF-16LE | base64)
ssh 'malsalem@jestais.com'@172.16.30.77 "powershell -EncodedCommand $ENCODED"
```

> Windows has no `tail`, `grep`, or `head` — use PowerShell encoded commands for log viewing.

## Docker

Docker Desktop with WSL2 (nested virtualization enabled in VMware).

Credential helpers are disabled for SSH sessions (`docker-credential-desktop.exe` and `docker-credential-wincred.exe` renamed to `.bak`).

GHCR login already configured: `docker login ghcr.io -u malsalem514`

### Windows Host Hardening

The VM uses a scheduled task to recover Docker Desktop and the MyReports stack after boot:

- Task name: `MyReports Ensure Docker`
- Script path: `C:\myreports\scripts\ensure-docker-and-app.ps1`
- Log path: `C:\myreports\logs\ensure-docker-and-app.log`

What the script now does:

- starts `com.docker.service`
- launches Docker Desktop
- waits for the `desktop-linux` engine to become ready
- ensures `myreports`, `nginx-ssl`, and `watchtower` are running

Important behavior:

- `com.docker.service` may still show as `Manual` after Docker Desktop comes up
- do not rely on Windows service startup mode alone for recovery
- the real recovery mechanism is the scheduled task + script above

Reboot proof completed on March 11, 2026:

- VM boot changed to `March 11, 2026 12:29:21 AM`
- task auto-ran at `12:29:33 AM`
- public health recovered by about `12:30:50 AM`
- no interactive desktop/session was required to bring the site back

## Directory Layout

```
C:\myreports\
  myreports.env              # MyReports environment variables
  google-sa.json             # BigQuery credentials

C:\erpnext\
  .env                       # ERPNext environment (DB_PASSWORD, ADMIN_PASSWORD)
  docker-compose.erpnext.yml # ERPNext compose stack
  nginx-ssl\
    nginx.conf               # SSL reverse proxy config
    selfsigned.crt            # Self-signed cert
    selfsigned.key
```

## Running Services

| Service | Container(s) | External Port | Internal Port | Image |
|---------|-------------|---------------|---------------|-------|
| SSL Proxy | nginx-ssl | 443 (HTTPS) | — | nginx:alpine |
| MyReports | myreports | — | 3001 → 3000 | ghcr.io/malsalem514/myreports:latest |
| ERPNext Frontend | frappe-frontend | 8080 | 8080 | frappe/erpnext:v15.99.1 |
| ERPNext Backend | frappe-backend | — | 8000 | frappe/erpnext:v15.99.1 |
| ERPNext WebSocket | frappe-websocket | — | 9000 | frappe/erpnext:v15.99.1 |
| ERPNext Workers | frappe-queue-short, frappe-queue-long | — | — | frappe/erpnext:v15.99.1 |
| ERPNext Scheduler | frappe-scheduler | — | — | frappe/erpnext:v15.99.1 |
| MariaDB | frappe-db | — | 3306 | mariadb:11.8 |
| Redis | frappe-redis-cache, frappe-redis-queue | — | 6379 | redis:6.2-alpine |

### Traffic Flow

```
Browser → https://myreports.jestais.com  → nginx-ssl (:443) → MyReports (HTTP :3001)
Browser → https://myprojects.jestais.com → nginx-ssl (:443) → ERPNext  (HTTP :8080)
```

DNS: Both domains resolve to `172.16.30.77`. Nginx uses `server_name` to route traffic.

## Credentials

### MyReports — Azure AD SSO
| Field | Value |
|-------|-------|
| App (Client) ID | `620f7434-4322-4d2a-8e44-14972f728a84` |
| Tenant ID | `e066e01b-f090-4220-8ac6-acf706a671aa` |
| Client Secret | `<retrieve from approved secret store or server env>` |
| NEXTAUTH_URL | `https://myreports.jestais.com` |
| Redirect URI | `https://myreports.jestais.com/api/auth/callback/microsoft-entra-id` |

### ERPNext
| Field | Value |
|-------|-------|
| Admin User | `Administrator` |
| Admin Password | `<retrieve from approved secret store>` |
| MariaDB Root Password | `<retrieve from approved secret store>` |
| Site Name | `erp.localhost` |
| Target Domain | `myprojects.jestais.com` |

### ERPNext — Azure AD SSO
| Field | Value |
|-------|-------|
| App (Client) ID | `a338904d-64d6-4146-9c77-252b4d69e271` |
| Tenant ID | `e066e01b-f090-4220-8ac6-acf706a671aa` |
| Client Secret | `<retrieve from approved secret store or ERPNext Social Login Key>` |
| Redirect URI | `https://myprojects.jestais.com/api/method/frappe.integrations.oauth2_logins.login_via_office365` |

## Common Operations

```bash
# Check all containers
ssh 'malsalem@jestais.com'@172.16.30.77 "docker ps"

# Restart MyReports
ssh 'malsalem@jestais.com'@172.16.30.77 \
  "docker stop myreports && docker rm myreports && docker run -d --name myreports --restart unless-stopped -p 3001:3000 --env-file C:\myreports\myreports.env --add-host srv-db-100:172.16.25.63 -v C:\myreports\google-sa.json:/run/secrets/google-sa.json:ro ghcr.io/malsalem514/myreports:latest"

# Restart ERPNext stack
ssh 'malsalem@jestais.com'@172.16.30.77 \
  "cd C:\erpnext && docker compose -f docker-compose.erpnext.yml restart"

# Restart SSL proxy
ssh 'malsalem@jestais.com'@172.16.30.77 "docker restart nginx-ssl"

# View MyReports logs
ssh 'malsalem@jestais.com'@172.16.30.77 "docker logs myreports"

# View Windows Docker/bootstrap recovery log
ssh 'malsalem@jestais.com'@172.16.30.77 \
  "powershell -NoProfile -Command \"Get-Content C:\myreports\logs\ensure-docker-and-app.log -Tail 100\""

# ERPNext bench commands
ssh 'malsalem@jestais.com'@172.16.30.77 \
  "cd C:\erpnext && docker compose -f docker-compose.erpnext.yml exec backend bench --site erp.localhost <command>"
```
