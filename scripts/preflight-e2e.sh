#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.e2e}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create it from .env.e2e.example"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

missing=0

require_nonempty() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[MISSING] $var_name"
    missing=1
    return
  fi
  local lower
  lower="$(echo "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *dummy* || "$lower" == *replace* ]]; then
    echo "[INVALID] $var_name contains placeholder value"
    missing=1
  else
    echo "[OK] $var_name"
  fi
}

echo "== Checking required variables =="
require_nonempty AUTH_SECRET
require_nonempty NEXTAUTH_URL
require_nonempty ORACLE_USER
require_nonempty ORACLE_PASSWORD
require_nonempty ORACLE_CONNECT_STRING
require_nonempty BAMBOOHR_API_KEY
require_nonempty BAMBOOHR_SUBDOMAIN
require_nonempty BIGQUERY_PROJECT_ID
require_nonempty BIGQUERY_DATASET
require_nonempty GOOGLE_APPLICATION_CREDENTIALS
require_nonempty GOOGLE_SA_JSON_PATH

if [[ "${DEV_BYPASS_AUTH:-false}" != "true" ]]; then
  require_nonempty AZURE_AD_CLIENT_ID
  require_nonempty AZURE_AD_CLIENT_SECRET
  require_nonempty AZURE_AD_TENANT_ID
else
  echo "[INFO] DEV_BYPASS_AUTH=true, Azure credentials optional"
fi

echo "== Checking local files =="
if [[ -f "${GOOGLE_SA_JSON_PATH:-}" ]]; then
  echo "[OK] GOOGLE_SA_JSON_PATH file exists"
else
  echo "[MISSING] GOOGLE_SA_JSON_PATH file not found: ${GOOGLE_SA_JSON_PATH:-<unset>}"
  missing=1
fi

# Oracle host check from ORACLE_CONNECT_STRING: host[/service] or host:port/service
oracle_host="${ORACLE_DB_HOST:-${ORACLE_CONNECT_STRING%%/*}}"
oracle_host="${oracle_host%%:*}"

echo "== Checking Oracle DNS from host =="
python3 - <<PY
import socket
host = "${oracle_host}"
try:
    ip = socket.gethostbyname(host)
    print(f"[OK] Oracle host resolves on host machine: {host} -> {ip}")
except Exception as e:
    print(f"[WARN] Oracle host does not resolve on host machine: {host} ({e})")
PY

echo "== Checking Docker availability =="
if docker info >/dev/null 2>&1; then
  echo "[OK] Docker daemon reachable"
else
  echo "[MISSING] Docker daemon not reachable"
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  echo ""
  echo "Preflight failed. Fix items above, then rerun: scripts/preflight-e2e.sh $ENV_FILE"
  exit 1
fi

echo ""
echo "Preflight passed. Start E2E stack with: docker compose --env-file $ENV_FILE -f docker-compose.e2e.yml up -d --build"
