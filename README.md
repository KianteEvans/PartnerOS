# PartnerOS

Multi-tenant, compliance- and audit-heavy SaaS for AWS Partner management.

This repository currently contains the **foundation layer** — the security and
infrastructure floor every domain feature builds on. No domain features yet.

## Stack

- **Next.js (App Router) + TypeScript (strict)** — server components for data,
  small client islands.
- **PostgreSQL + Drizzle ORM** — the only datastore. Tenant isolation via
  **Row-Level Security** defined in raw SQL migrations (`drizzle/`).
- **OIDC** identity → signed, httpOnly **JWT session cookie**.
- **Upstash Redis** rate limiting, with an in-memory dev adapter.
- **S3-compatible** object storage with **fail-closed malware scanning** via a
  signed webhook.
- **Vitest** (unit + integration) and **Playwright** (E2E), **GitHub Actions** CI.

## The non-negotiable rules, and where they live

| Rule | Enforced by |
| ---- | ----------- |
| 1. Postgres is the only datastore; real typed tables | `src/db/schema.ts`, `drizzle/0000_init.sql` |
| 2. Tenant isolation by RLS, not app code | `drizzle/0000_init.sql` policies + `src/db/client.ts` (`withTenant`) |
| 3. Secure by default; `PARTNEROS_LOCAL_DEV` impossible in deploy | `src/env.ts` |
| 4. Server-derived identity only | `src/auth/session.ts` (`getServerIdentity`), ESLint guard in `eslint.config.mjs` |
| 5. Real adapters + runnable local stubs | `src/redis/`, `src/storage/`, `src/auth/oidc.ts`, `scripts/stubs/` |
| 6. One mutation gate (authz + idempotency + body-size + rate limit) | `src/gate/mutation-gate.ts` |
| 7. Shared UI primitives | `src/components/ui/{Table,Panel,Form,Drawer}.tsx` |

## How tenant isolation actually works

Every request-path query runs through `withTenant(identity, fn)`, which opens a
transaction, assumes the non-privileged `partneros_app` role (`SET LOCAL ROLE`),
and sets `app.tenant_id` transaction-locally. RLS policies compare each row's
`tenant_id` to `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. If the
GUC is unset (or reverted to empty on a pooled connection), the predicate is NULL
and **zero rows** are returned — fail closed. A query that forgets to scope can
never see another tenant's data. See `tests/integration/rls.test.ts`.

`withSystem(fn)` is the privileged, RLS-bypassing path, reserved for migrations
and pre-identity provisioning (tenant/user creation during OIDC callback).

## Local development

```bash
cp .env.example .env          # PARTNEROS_LOCAL_DEV=true on a dev machine only
npm install
npm run stub:all              # OIDC stub; Redis/S3 use in-memory/FS adapters
npm run db:migrate            # applies drizzle/*.sql (needs a local Postgres)
npm run dev
```

### Tests need no Docker

This machine has no Docker or local `psql`, so the integration tests start a
**real Postgres** via the `embedded-postgres` package (a downloaded binary) on an
OS-allocated free port. RLS is a genuine Postgres feature, so faking the database
(e.g. `pg-mem`) would make the isolation tests meaningless.

```bash
npm run typecheck
npm run lint
npm test          # unit + integration (spins up real Postgres)
```

> Windows note: `embedded-postgres` returns from `stop()` before the OS reaps the
> forked `postgres.exe` children. `tests/helpers/global-teardown.ts` cleans up any
> lingering console-session instances after the suite. The developer's own
> Postgres service (session 0) is never touched.

## Definition of Done

A change is done only when `typecheck`, `lint`, unit tests, and the relevant
integration test pass, and tenant isolation (RLS) still holds.
