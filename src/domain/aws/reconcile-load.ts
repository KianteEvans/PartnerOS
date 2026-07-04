import { and, eq, isNotNull } from "drizzle-orm";
import type { MutationContext } from "@/gate/mutation-gate";
import { awsConnection, opportunities, partnerCentralOpportunities } from "@/db/schema";
import { reconcileOpportunities, driftCount } from "@/domain/aws/reconcile";
import type { AwsSyncInput } from "@/domain/aws/signals";

/**
 * Load the Partner Central connection freshness + opportunity-drift count for the
 * Command Center / notification-bell sync-health signals. Returns undefined when the
 * tenant has no AWS connection row (nothing to nag about). Runs inside the caller's
 * tenant-scoped transaction (RLS enforced upstream); reuses the pure reconcile diff.
 * Kept out of the pure reconcile.ts so its unit tests never import the DB schema.
 */
export async function loadAwsSyncInput(
  tx: MutationContext["tx"],
  tenantId: string,
): Promise<AwsSyncInput | undefined> {
  const [conn] = await tx
    .select({ status: awsConnection.status, lastSyncedAt: awsConnection.lastSyncedAt })
    .from(awsConnection)
    .where(eq(awsConnection.tenantId, tenantId));
  if (!conn) return undefined;

  const localRows = await tx
    .select({
      id: opportunities.id,
      externalId: opportunities.externalId,
      name: opportunities.name,
      accountName: opportunities.accountName,
      stage: opportunities.stage,
      status: opportunities.status,
      amount: opportunities.amount,
    })
    .from(opportunities)
    .where(and(eq(opportunities.tenantId, tenantId), isNotNull(opportunities.externalId)));

  const mirrorRows = await tx
    .select({
      externalId: partnerCentralOpportunities.externalId,
      name: partnerCentralOpportunities.name,
      accountName: partnerCentralOpportunities.accountName,
      stage: partnerCentralOpportunities.stage,
      status: partnerCentralOpportunities.status,
      amount: partnerCentralOpportunities.amount,
    })
    .from(partnerCentralOpportunities)
    .where(eq(partnerCentralOpportunities.tenantId, tenantId));

  const rows = reconcileOpportunities(localRows, mirrorRows);
  const lastSyncDate = conn.lastSyncedAt ? conn.lastSyncedAt.toISOString().slice(0, 10) : null;
  return { status: conn.status, lastSyncDate, driftCount: driftCount(rows) };
}
