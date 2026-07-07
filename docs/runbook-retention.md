# Runbook — Data retention sweep

Prunes rows that have outlived their usefulness so unbounded tables don't grow
forever in production. Safe, idempotent, deletion-only (never touches live data).

## Endpoint

`POST /api/cron/cleanup-retention`

- **Auth:** `Authorization: Bearer <PLAYBOOK_RUNNER_TOKEN>` (constant-time SHA-256
  compare; reuses the playbook runner token). Returns **401** if the header is
  missing/wrong, or if `PLAYBOOK_RUNNER_TOKEN` is unset (the endpoint is disabled
  by default — no token, no access).
- **Response:** `200 { "ok": true, "idempotencyDeleted": <n>, "snapshotsDeleted": <n> }`

## What it prunes

| Table | Rule | Why |
|---|---|---|
| `idempotency_keys` | **completed** rows older than **7 days** | The mutation gate only replays a committed response within a short window; older keys are dead weight. |
| `metric_snapshots` | rows with `captured_on` older than **730 days** (~2 years) | One row per tenant per day feeds hub trend charts; two years is plenty. |
| `audit_log` | **never pruned** | Immutable governance trail (append-only; UPDATE/DELETE revoked from `partneros_app`). Archival, if ever needed, is a separate deliberate operation. |

Windows are constants in `src/domain/retention/operations.ts`
(`IDEMPOTENCY_RETENTION_DAYS`, `SNAPSHOT_RETENTION_DAYS`).

## Schedule

Run **daily, off-peak** (e.g. 03:00 UTC). On AWS, an **EventBridge Scheduler**
rule targeting the ALB/HTTPS endpoint with the bearer token in the header is the
intended driver (same pattern as `/api/cron/run-playbooks` and
`/api/cron/aggregate-benchmarks`).

Example (curl, for manual runs / smoke tests):

```bash
curl -fsS -X POST https://<host>/api/cron/cleanup-retention \
  -H "Authorization: Bearer $PLAYBOOK_RUNNER_TOKEN"
```

## Failure / rollback

- The sweep is a single `withSystem` transaction of age-bounded `DELETE`s. If it
  fails, nothing is committed — just re-run on the next tick.
- There is **no rollback needed**: it only removes rows already past their
  retention window. If a window is later found too aggressive, widen the constant
  and redeploy; already-deleted rows are not recoverable, so change windows
  conservatively.
- A missed run is harmless — the next run prunes the accumulated backlog.
