import { NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { authRunnerToken } from "@/domain/playbooks/cron-auth";
import { runRetentionOp } from "@/domain/retention/operations";

/**
 * Scheduled data-retention sweep. An external scheduler (cron / EventBridge)
 * POSTs here with the runner bearer token; we prune rows past their retention
 * window (see runRetentionOp — completed idempotency keys > 7d, metric snapshots
 * > 730d; the audit log is never pruned).
 *
 * Reuses the playbook runner token — a deployment typically shares one scheduler
 * credential across cron endpoints. Disabled (401) unless PLAYBOOK_RUNNER_TOKEN
 * is configured, exactly like /api/cron/run-playbooks.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!authRunnerToken(req)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await withSystem((tx) => runRetentionOp(tx));
  return NextResponse.json({ ok: true, ...result });
}
