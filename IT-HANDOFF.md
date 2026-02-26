# IT Handoff: MyReports Container

## 1) Build image

```bash
docker build -t myreports:latest .
```

## 2) Export image archive to share

```bash
docker save myreports:latest -o myreports-latest.tar
```

## 3) Run in IT environment

```bash
docker load -i myreports-latest.tar

docker run -d \
  --name myreports \
  -p 3000:3000 \
  --env-file /secure/path/myreports.env \
  --add-host srv-db-100:172.16.25.63 \
  -v /secure/path/google-sa.json:/run/secrets/google-sa.json:ro \
  myreports:latest
```

## 4) Required env vars

- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `AZURE_AD_CLIENT_ID`
- `AZURE_AD_CLIENT_SECRET`
- `AZURE_AD_TENANT_ID`
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS` (should be `/run/secrets/google-sa.json`)
- `BAMBOOHR_API_KEY`
- `BAMBOOHR_SUBDOMAIN`
- `ORACLE_DB_HOST` (optional for compose; default `srv-db-100`)
- `ORACLE_DB_IP` (required if Oracle host is not resolvable inside container)

## 5) Health checks

- App URL: `http://<host>:3000/login`
- Successful login redirects to `/dashboard`
- Dashboard pages load without 500 errors
- Basic health endpoint: `GET /api/health`
- Deep integration check: `GET /api/health?deep=1` (returns `503` if Oracle/BigQuery/BambooHR are unavailable, with failure reasons in `details`)

## 6) Missing-Items Checklist (before go-live)

- Oracle host resolvable inside container (either DNS works or `--add-host` is set)
- BigQuery service account file mounted and `GOOGLE_APPLICATION_CREDENTIALS` points to it
- Valid BambooHR API key
- Valid Azure Entra app credentials (if not using bypass mode)

## 7) Notes

- Scheduler is not auto-started by default in this web container.
- If scheduled sync is needed, run sync via an external cron job or dedicated worker process.
