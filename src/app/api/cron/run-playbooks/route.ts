import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants, users } from "@/db/schema";
import { authRunnerToken } from "@/domain/playbooks/cron-auth";
import { loadCommandData } from "@/domain/command/load";

/**
 * Scheduled playbook runner. An external scheduler (cron / EventBridge) POSTs here
 * with the bearer token; we iterate every tenant and re-derive its decision queue
 * (loadCommandData materializes playbooks as a side effect), firing time-based
 * rules and creating notifications even when no one is logged in. Delivery of
 * pending email/webhook notifications is flushed here too (see deliver-run).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!authRunnerToken(req)) return new NextResponse("Unauthorized", { status: 401 });

  const tenantRows = await withSystem((tx) => tx.select({ id: tenants.id }).from(tenants));
  let processed = 0;
  for (const t of tenantRows) {
    const owners = await withSystem((tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, t.id), eq(users.role, "owner")))
        .limit(1),
    );
    const owner = owners[0];
    if (!owner) continue;
    const identity = { tenantId: t.id, userId: owner.id, role: "owner" };
    try {
      await loadCommandData(identity); // materializes playbooks via maybeRunPlaybooks
      const { deliverPendingForTenant } = await import("@/domain/playbooks/deliver-run");
      await deliverPendingForTenant(identity);
      processed++;
    } catch {
      // One tenant failing must not stop the rest.
    }
  }
  return NextResponse.json({ ok: true, processed });
}
