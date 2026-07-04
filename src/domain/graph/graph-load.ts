import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { marketplaceListings, fundingSubmissions } from "@/db/schema";
import { loadProgramRoi } from "@/domain/programs/roi-load";
import type { AttributionExtra } from "@/domain/graph/attribution";

/**
 * Read-only loader for the extra cross-domain data the attribution flow needs beyond the
 * Command Center inputs: per-competency ROI (reusing the already-tested loadProgramRoi) +
 * the marketplace listing→solution links. Lazy — only invoked for the attribution view.
 * NO migration, NO new tables: every column pre-exists.
 */
export async function loadAttributionExtra(identity: DbIdentity): Promise<AttributionExtra> {
  const competencies = await loadProgramRoi(identity);
  const { listings, fundingApproved } = await withTenant(identity, async (tx) => {
    const listingRows = await tx
      .select({
        id: marketplaceListings.id,
        title: marketplaceListings.title,
        solutionId: marketplaceListings.solutionId,
        status: marketplaceListings.status,
      })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId));
    const fundingRows = await tx
      .select({ approvedAmount: fundingSubmissions.approvedAmount })
      .from(fundingSubmissions)
      .where(eq(fundingSubmissions.tenantId, identity.tenantId));
    return {
      listings: listingRows,
      fundingApproved: fundingRows.reduce((a, r) => a + (r.approvedAmount ?? 0), 0),
    };
  });
  return {
    competencies,
    listings: listings.map((l) => ({
      id: l.id,
      title: l.title,
      solutionId: l.solutionId,
      published: l.status === "published",
    })),
    funding: { approved: fundingApproved },
  };
}
