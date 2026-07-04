import { and, asc, desc, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { agencyLinkRequests, tenants } from "@/db/schema";

/**
 * Read side of the agency claim/link consent flow (Bet C). Both reads use `withSystem`
 * with an explicit tenant filter (target = my tenant, or agency = my tenant) so the
 * approver can see the requesting agency's name and the agency can see its own roster
 * — neither of which is visible through the other's single-tenant RLS view.
 */

export interface IncomingLinkRequest {
  readonly id: string;
  readonly agencyName: string;
  readonly agencySlug: string;
  readonly status: string;
  readonly requestedAt: Date;
}

/** Pending requests from agencies asking to manage THIS workspace (approver side). */
export async function loadIncomingLinkRequests(identity: DbIdentity): Promise<IncomingLinkRequest[]> {
  return withSystem((tx) =>
    tx
      .select({
        id: agencyLinkRequests.id,
        agencyName: tenants.name,
        agencySlug: tenants.slug,
        status: agencyLinkRequests.status,
        requestedAt: agencyLinkRequests.requestedAt,
      })
      .from(agencyLinkRequests)
      .innerJoin(tenants, eq(tenants.id, agencyLinkRequests.agencyTenantId))
      .where(
        and(
          eq(agencyLinkRequests.targetTenantId, identity.tenantId),
          eq(agencyLinkRequests.status, "pending"),
        ),
      )
      .orderBy(desc(agencyLinkRequests.requestedAt)),
  );
}

export interface ManagedWorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly tier: string;
}

export interface OutgoingLinkRequest {
  readonly id: string;
  readonly targetName: string;
  readonly targetSlug: string;
  readonly status: string;
  readonly requestedAt: Date;
}

export interface AgencyRoster {
  readonly managed: ManagedWorkspaceRow[];
  readonly outgoing: OutgoingLinkRequest[];
}

/** The agency's own roster: managed workspaces + its pending outgoing link requests. */
export async function loadAgencyRoster(identity: DbIdentity): Promise<AgencyRoster> {
  return withSystem(async (tx) => {
    const managed = await tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.agencyId, identity.tenantId))
      .orderBy(asc(tenants.name));
    const outgoing = await tx
      .select({
        id: agencyLinkRequests.id,
        targetName: tenants.name,
        targetSlug: tenants.slug,
        status: agencyLinkRequests.status,
        requestedAt: agencyLinkRequests.requestedAt,
      })
      .from(agencyLinkRequests)
      .innerJoin(tenants, eq(tenants.id, agencyLinkRequests.targetTenantId))
      .where(
        and(
          eq(agencyLinkRequests.agencyTenantId, identity.tenantId),
          eq(agencyLinkRequests.status, "pending"),
        ),
      )
      .orderBy(desc(agencyLinkRequests.requestedAt));
    return { managed, outgoing };
  });
}
