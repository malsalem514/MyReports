# Server Access — srv-test-Office64

## Connection Details

| Field | Value |
|-------|-------|
| Hostname | srv-test-Office64 |
| IP | 172.16.30.77 |
| OS | Windows 11 Pro (VMware VM) |
| User | `malsalem@jestais.com` |
| Password | `Kool3ala6ool!@#$%` |

## SSH Connection

The password contains special characters (`!@#$%`) that break shell quoting. Use a file-based approach:

```bash
# 1. Create password file (once per session)
printf '%s' 'Kool3ala6ool!@#$%' > /tmp/.sshpw && chmod 600 /tmp/.sshpw

# 2. Connect
sshpass -f /tmp/.sshpw ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no 'malsalem@jestais.com'@172.16.30.77
```

> Use IP `172.16.30.77` — DNS for the hostname may not always resolve.
> `-o PubkeyAuthentication=no` is required to avoid pubkey auth failures.

## File Transfer (SCP)

```bash
sshpass -f /tmp/.sshpw scp -o StrictHostKeyChecking=no -o PubkeyAuthentication=no \
  /local/file 'malsalem@jestais.com'@172.16.30.77:'C:\remote\path\'
```

## Running Commands

The default SSH shell is **cmd.exe** (not bash). For complex commands with pipes or quotes, use base64-encoded PowerShell:

```bash
CMD='your-command-here 2>&1'
ENCODED=$(echo "$CMD" | iconv -t UTF-16LE | base64)
sshpass -f /tmp/.sshpw ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no \
  'malsalem@jestais.com'@172.16.30.77 "powershell -EncodedCommand $ENCODED"
```

> Windows has no `tail`, `grep`, or `head` — use PowerShell encoded commands for log viewing.

## Docker

Docker Desktop with WSL2 (nested virtualization enabled in VMware).

Credential helpers are disabled for SSH sessions (`docker-credential-desktop.exe` and `docker-credential-wincred.exe` renamed to `.bak`).

GHCR login already configured: `docker login ghcr.io -u malsalem514`

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
| SSL Proxy | nginx-ssl | 3000 (HTTPS), 8443 (HTTPS) | — | nginx:alpine |
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
Browser → nginx-ssl (HTTPS :3000) → MyReports (HTTP :3001)
Browser → nginx-ssl (HTTPS :8443) → ERPNext  (HTTP :8080)
```

## Credentials

### MyReports — Azure AD SSO
| Field | Value |
|-------|-------|
| App (Client) ID | `620f7434-4322-4d2a-8e44-14972f728a84` |
| Tenant ID | `e066e01b-f090-4220-8ac6-acf706a671aa` |
| Client Secret | `<see myreports.env on server or memory/server-access.md>` |
| NEXTAUTH_URL | `https://srv-test-office64:3000` |
| Redirect URI | `https://srv-test-office64:3000/api/auth/callback/microsoft-entra-id` |

### ERPNext
| Field | Value |
|-------|-------|
| Admin User | `Administrator` |
| Admin Password | `Admin2026Jestais` |
| MariaDB Root Password | `Frappe2026Jestais` |
| Site Name | `erp.localhost` |
| Target Domain | `myprojects.jestais.com` |

### ERPNext — Azure AD SSO
| Field | Value |
|-------|-------|
| App (Client) ID | `a338904d-64d6-4146-9c77-252b4d69e271` |
| Tenant ID | `e066e01b-f090-4220-8ac6-acf706a671aa` |
| Client Secret | `<see ERPNext Social Login Key or memory/server-access.md>` |
| Redirect URI | `https://myprojects.jestais.com/api/method/frappe.integrations.oauth2_logins.login_via_office365` |

## Common Operations

```bash
# Check all containers
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 "docker ps"

# Restart MyReports
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 \
  "docker stop myreports && docker rm myreports && docker run -d --name myreports --restart unless-stopped -p 3001:3000 --env-file C:\myreports\myreports.env --add-host srv-db-100:172.16.25.63 -v C:\myreports\google-sa.json:/run/secrets/google-sa.json:ro ghcr.io/malsalem514/myreports:latest"

# Restart ERPNext stack
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 \
  "cd C:\erpnext && docker compose -f docker-compose.erpnext.yml restart"

# Restart SSL proxy
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 "docker restart nginx-ssl"

# View MyReports logs
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 "docker logs myreports"

# ERPNext bench commands
sshpass -f /tmp/.sshpw ssh ... 'malsalem@jestais.com'@172.16.30.77 \
  "cd C:\erpnext && docker compose -f docker-compose.erpnext.yml exec backend bench --site erp.localhost <command>"
```

> In all examples above, `...` is shorthand for `-o StrictHostKeyChecking=no -o PubkeyAuthentication=no`
