# MyReports

MyReports is a Next.js dashboard for office attendance and TBS/BambooHR comparison reporting.

## Stack

- Next.js (App Router) + TypeScript
- NextAuth (Microsoft Entra ID)
- Oracle DB (reporting store)
- BigQuery (ActivTrak source)
- BambooHR API

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Run in development:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Production build

```bash
npm run build
npm start
```

## Docker

Build image:

```bash
docker build -t myreports:latest .
```

Run container:

```bash
docker run --rm -p 3000:3000 --env-file .env myreports:latest
```

Health checks:

```bash
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/health?deep=1
```

The public endpoint returns HTTP `503` when the latest sync failed, the last successful
sync is stale, or attendance/productivity data is more than the configured business-day
lag. The deep endpoint includes diagnostics and requires an authenticated admin session.

## E2E Integration Run

1. Create the E2E env file:

```bash
cp .env.e2e.example .env.e2e
```

2. Fill all real credentials and paths in `.env.e2e`.

3. Run preflight:

```bash
npm run e2e:preflight
```

4. Start E2E stack:

```bash
npm run e2e:up
```

5. Check dependencies:

```bash
curl -s http://localhost:3001/api/health?deep=1
```

## Required env vars

See `.env.example` for all variables.

Minimum for authentication:

- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `AZURE_AD_CLIENT_ID`
- `AZURE_AD_CLIENT_SECRET`
- `AZURE_AD_TENANT_ID`

Data integrations:

- Oracle: `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING`
- BigQuery: `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`, `GOOGLE_APPLICATION_CREDENTIALS`
- BambooHR: `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`

Production BigQuery credentials must be a Google JSON credential with
`"type": "service_account"`. OAuth user credentials (`authorized_user`) are rejected at
scheduler startup because they can be revoked or deleted without warning. Never commit the
credential file; mount it read-only at the path in `GOOGLE_APPLICATION_CREDENTIALS`.

Additional vars for container E2E setup:

- `ORACLE_DB_HOST`, `ORACLE_DB_IP` (for `extra_hosts` DNS mapping inside container)
- `GOOGLE_SA_JSON_PATH` (host path mounted to `/run/secrets/google-sa.json`)

Scheduler:

- `SYNC_DAYS_BACK` controls the daily refresh window. It defaults to 112 days so TBS-backed reports have data for every configured lookback option.
- `ENABLE_SCHEDULER=false` explicitly disables scheduling. Production defaults to enabled when the variable is omitted; development requires `true`.

Reliability controls:

- `BIGQUERY_QUERY_TIMEOUT_MS` defaults to 10 minutes.
- `EXTERNAL_HTTP_TIMEOUT_MS` defaults to 30 seconds for BambooHR and Duo calls.
- `ORACLE_CALL_TIMEOUT_MS` defaults to 2 minutes and `ORACLE_QUEUE_TIMEOUT_MS` to 30 seconds.
- `DATA_FRESHNESS_MAX_BUSINESS_DAYS` defaults to 2.
