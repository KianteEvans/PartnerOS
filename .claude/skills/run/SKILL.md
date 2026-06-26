---
name: run
description: Launch the PartnerOS Next.js app locally in the browser, with no Docker. Use when asked to run, start, preview, or screenshot the app. Boots an embedded Postgres, the OIDC stub, and `next dev`, then signs in and (optionally) seeds demo data.
---

# Run PartnerOS locally (no Docker)

This machine has **no Docker and no local `psql`**. PartnerOS still needs a real
Postgres at runtime (RLS is a genuine Postgres feature). The trick: reuse the
project's own `embedded-postgres` binary — the same engine the integration tests
use — for the dev runtime. Everything else (S3, Redis) auto-selects local
adapters under `PARTNEROS_LOCAL_DEV`, and a tiny OIDC stub handles login.

Verified working on Windows 11 (PowerShell + Git Bash), Node 24.

## One-time files (already committed)

- `scripts/dev-db.ts` — boots embedded Postgres on **:54329**, applies all
  `drizzle/*.sql` migrations, and stays alive. Data is **ephemeral** (temp dir);
  stopping the process wipes it.
- `scripts/dev-seed.ts` — fills the logged-in tenant with realistic
  cross-section demo data so dashboards light up. Idempotent.
- `.env` — gitignored; `DATABASE_URL` points at `:54329`. If missing, copy
  `.env.example` and change the two `DATABASE_*` URLs to
  `postgres://postgres:password@localhost:54329/partneros`.
- `.claude/launch.json` — preview config (`partneros-dev`, port 3000,
  `autoPort:false` because the OIDC callback URL is hardcoded to :3000).

## Launch sequence

Run these as **three long-lived background processes**, in order:

```bash
# 1. Embedded Postgres + migrations (wait for "[dev-db] ready on …")
npm run dev:db        # tsx scripts/dev-db.ts   -> :54329

# 2. OIDC stub (login). The CLI does not gate on PARTNEROS_LOCAL_DEV.
npm run dev:oidc      # tsx scripts/stubs/oidc-stub.ts   -> :4444

# 3. Next dev server (auto-loads .env). Wait for "Ready".
npx next dev          # -> http://localhost:3000
```

If using the **preview tool**: free port 3000 first (the app needs :3000 for the
OIDC callback), then `preview_start` the `partneros-dev` config — it will own
`next dev` on :3000. Steps 1 and 2 still run via Bash.

## Sign in + seed (the app redirects un-authed pages to `/`)

First login under `PARTNEROS_LOCAL_DEV` **auto-provisions a personal tenant with
an `owner` user** (`src/auth/provision.ts`). Drive the browser to:

```
http://localhost:3000/api/auth/login
```

It round-trips through the OIDC stub → `/api/auth/callback` → sets a signed
session cookie → lands on `/` as `dev@partneros.local`. Then make the dashboards
non-empty:

```bash
npm run dev:seed      # needs a tenant to exist first (i.e. log in once)
```

Now `/command`, `/mdf`, `/reports`, and every section render with live data.

## Smoke test (server-side, no browser needed)

```bash
J=$(mktemp)
curl -s -L -c "$J" -b "$J" http://localhost:3000/api/auth/login -o /dev/null \
  -w "login=%{http_code} %{url_effective}\n"          # expect 200 http://localhost:3000/
curl -s -b "$J" http://localhost:3000/command | grep -o 'Partnership health'   # authed render
```

## Drive it

- **Command Center** (`/command?mode=workbench`) — health score, decision queue,
  work summary. The headline aggregation surface.
- **MDF** (`/mdf`), **ACE** (`/ace`), **Programs** (`/programs`), **Reporting**
  (`/reports`) — each renders the seeded data.
- Look at the screenshot. A redirect back to `/` means the session cookie was
  lost — re-run the `/api/auth/login` navigation.

## Gotchas

- **Port 3000 is required** (hardcoded OIDC callback). Don't let the dev server
  fall back to another port.
- **DB is ephemeral.** Restarting `dev:db` wipes data; log in + `dev:seed` again.
- Navigations via `preview_eval(window.location.assign(...))` can race the first
  route compile — wait ~6s, then verify `window.location.href` before screenshotting.
