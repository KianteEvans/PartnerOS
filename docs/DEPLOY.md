# PartnerOS — Deployment Guide

Operator guide for running PartnerOS in production. Target shape: **one container
image** (Next.js standalone) behind a load balancer, plus **managed Postgres**,
**S3**, **Upstash Redis**, and an **external scheduler** for the three cron
endpoints. Local development is different and documented in the README (embedded
Postgres + OIDC stub under `PARTNEROS_LOCAL_DEV=true` — that flag is a hard boot
failure in any deployed environment, by design).

## 1. Build the image

```bash
docker build -t partneros:$(git rev-parse --short HEAD) .
```

The Dockerfile is three-stage (deps → build → runner), runs as a non-root user,
and bakes **no secrets** — the build stage uses schema-valid placeholders because
`next build` imports `src/env.ts`. All real values are injected at runtime.

## 2. Environment variables

Validated at boot by `src/env.ts` (invalid/missing = the process refuses to
start). Source of truth is that file; summary:

### Required in production

| Var | Notes |
|---|---|
| `NODE_ENV` | Must be `production` in any deployed env — boot fails otherwise (CSP/cookie hardening keys off it). |
| `PARTNEROS_DEPLOY_ENV` | Deployment marker set by the platform (e.g. `prod`). Presence forbids `PARTNEROS_LOCAL_DEV`. |
| `DATABASE_URL` | App connection (the `partneros_app` RLS role). **Append `?sslmode=require`** for managed Postgres (RDS etc.). |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` | One global OIDC provider for all tenants; redirect URI must be the exact public HTTPS callback URL. Per-tenant SAML (Enterprise) is configured in-app. |
| `SESSION_JWT_SECRET` | 32+ bytes base64url; from Secrets Manager; rotate ~90 days (rotating invalidates sessions). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate-limit backend. Boot fails without them outside local dev. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Evidence/object storage (presigned up/downloads). `S3_FORCE_PATH_STYLE=true` only for non-AWS S3 endpoints. |
| `MALWARE_SCAN_WEBHOOK_SECRET` | HMAC secret shared with the scanner calling `/api/storage/scan-callback`. Unscanned files are fail-closed. |

### Optional (feature-gating; blank = feature off, never a boot failure)

| Var | Enables |
|---|---|
| `DATABASE_MIGRATOR_URL` | Table-owner connection used only by `db:migrate` (keep out of the app task). |
| `ANTHROPIC_API_KEY` | All AI features (Ask AWS, drafting, narratives, copilot, advisors). |
| `EMAIL_DELIVERY_URL` | Outbound email relay (invitations, playbook notifications). |
| `PLAYBOOK_RUNNER_TOKEN` | Gates `/api/cron/run-playbooks` and `/api/cron/cleanup-retention`. |
| `BENCHMARK_AGGREGATOR_TOKEN` | Gates `/api/cron/aggregate-benchmarks`. |
| `ERROR_REPORT_URL` | Webhook receiving error-level structured log events (Sentry-style collector without an SDK). |
| `BD_SYNC_TOKEN` | Read-only `/api/integrations/bd-leads` feed for the standalone BDAgent app. |
| `GOOGLE_OAUTH_*` | BDAgent calendar scheduling (not needed by PartnerOS itself). |

## 3. Database

- Managed Postgres 15+ with TLS. Create the database and roles per
  `drizzle/0000_init.sql` expectations (the migration runner creates
  `partneros_app`; the migrator connection must be the table owner and must
  **not** have `BYPASSRLS`).
- **Apply migrations from a repo checkout** (the runtime image has no dev
  tooling): `npm ci && npm run db:migrate` with `DATABASE_MIGRATOR_URL` set.
  Forward-only, tracked in `_migrations`, one transaction per file. Run before
  rolling out an image that expects the new schema.
- Backups: enable automated snapshots (e.g. RDS 7–35 day retention) + PITR.
  The app never deletes audit rows; retention pruning covers only
  `idempotency_keys` (7d) and `metric_snapshots` (730d).

## 4. Scheduled jobs (external scheduler)

No in-process cron — schedule HTTPS POSTs (EventBridge Scheduler, cron, etc.):

| Endpoint | Cadence | Auth header |
|---|---|---|
| `POST /api/cron/run-playbooks` | every 15 min | `Authorization: Bearer $PLAYBOOK_RUNNER_TOKEN` |
| `POST /api/cron/cleanup-retention` | daily | `Authorization: Bearer $PLAYBOOK_RUNNER_TOKEN` |
| `POST /api/cron/aggregate-benchmarks` | daily (after midnight UTC) | `Authorization: Bearer $BENCHMARK_AGGREGATOR_TOKEN` |

All three are idempotent and constant-time-compare their tokens; unset token =
endpoint disabled (401).

## 5. Health, readiness, logging

- **Liveness** (container health check): `GET /api/health` — cheap DB ping,
  200/503.
- **Readiness** (LB target group / pre-cutover): `GET /api/ready` — DB +
  Upstash Redis, 200/503 with per-dependency status.
- **Logs**: one JSON object per line on stdout/stderr (ingest with CloudWatch
  Logs / any driver). At boot, one `boot.config` line records the effective
  security posture (secure cookies, strict CSP, adapters); server-side request
  errors emit `request.error` lines carrying the same `digest` users see on the
  error page ("Reference: …"). Set `ERROR_REPORT_URL` to also push error events
  to a collector.

## 6. First-deploy checklist

1. Secrets in Secrets Manager; task/service env includes `NODE_ENV=production`
   and `PARTNEROS_DEPLOY_ENV=prod`.
2. `DATABASE_URL` ends in `?sslmode=require`; migrations applied
   (`npm run db:migrate`).
3. Boot the service; confirm the `boot.config` log line shows
   `secureCookies:true, strictCsp:true, redis:true`.
4. `GET /api/health` and `GET /api/ready` both 200.
5. Sign in via the real OIDC provider (round-trip through
   `/api/auth/login` → IdP → `/api/auth/callback`).
6. On `/portfolio`: create a managed workspace, invite a test email, accept the
   invite from a clean browser, confirm the invited role + Essentials fences.
7. `curl` each cron endpoint with its bearer token → 200.
8. Negative test: run `npx tsx scripts/dev-seed.ts` against the deployed DB URL
   from a workstation — it must refuse (`PARTNEROS_LOCAL_DEV` guard).
