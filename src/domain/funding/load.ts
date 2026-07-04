import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { fundingSubmissions, opportunities, programs, solutions, tenants } from "@/db/schema";
import type { TierId } from "@/domain/tiers/catalog";
import type { DealProfile, PartnerContext } from "@/domain/funding/eligibility";

/**
 * Read-only loaders for the AWS Funding section. All tenant-scoped via RLS. The matcher
 * loader builds each deal's DealProfile from its opportunity + linked solution/competency,
 * plus the PartnerContext (tenant tier + adopted competencies + solution types).
 */

export type SubmissionRow = typeof fundingSubmissions.$inferSelect;

export async function loadSubmissions(identity: DbIdentity): Promise<SubmissionRow[]> {
  return withTenant(identity, async (tx) =>
    tx
      .select()
      .from(fundingSubmissions)
      .where(eq(fundingSubmissions.tenantId, identity.tenantId))
      .orderBy(desc(fundingSubmissions.createdAt)),
  );
}

export interface SubmissionDetail {
  readonly submission: SubmissionRow;
  readonly opportunity: { readonly id: string; readonly name: string } | null;
}

export async function loadSubmissionDetail(identity: DbIdentity, id: string): Promise<SubmissionDetail | null> {
  return withTenant(identity, async (tx) => {
    const [submission] = await tx
      .select()
      .from(fundingSubmissions)
      .where(and(eq(fundingSubmissions.id, id), eq(fundingSubmissions.tenantId, identity.tenantId)));
    if (!submission) return null;
    let opportunity: { id: string; name: string } | null = null;
    if (submission.opportunityId) {
      const [o] = await tx
        .select({ id: opportunities.id, name: opportunities.name })
        .from(opportunities)
        .where(and(eq(opportunities.id, submission.opportunityId), eq(opportunities.tenantId, identity.tenantId)));
      opportunity = o ?? null;
    }
    return { submission, opportunity };
  });
}

export interface MatcherDeal {
  readonly id: string;
  readonly name: string;
  readonly accountName: string;
  readonly profile: DealProfile;
}

export interface FundingMatcherData {
  readonly deals: readonly MatcherDeal[];
  readonly context: PartnerContext;
  /** For the selected deal: programKey -> submission status, so the matcher shows what's already applied. */
  readonly applied: Readonly<Record<string, string>>;
}

/** Deals + partner context for the eligibility matcher. `oppId` narrows to one deal. */
export async function loadFundingMatcher(identity: DbIdentity, oppId?: string): Promise<FundingMatcherData> {
  return withTenant(identity, async (tx) => {
    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, identity.tenantId));

    const progRows = await tx
      .select({ id: programs.id, libraryKey: programs.libraryKey, programType: programs.programType, status: programs.status })
      .from(programs)
      .where(eq(programs.tenantId, identity.tenantId));
    const competencyKeys = progRows
      .filter((p) => p.status === "active" && p.programType === "Competency")
      .map((p) => p.libraryKey);
    const progKeyById = new Map(progRows.map((p) => [p.id, p.libraryKey]));

    const solRows = await tx
      .select({ id: solutions.id, solutionType: solutions.solutionType })
      .from(solutions)
      .where(eq(solutions.tenantId, identity.tenantId));
    const solTypeById = new Map(solRows.map((s) => [s.id, s.solutionType]));
    const solutionTypes = [...new Set(solRows.map((s) => s.solutionType))];

    const context: PartnerContext = {
      tier: (tenant?.tier ?? "registered") as TierId,
      competencyKeys,
      solutionTypes,
    };

    const oppRows = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountName: opportunities.accountName,
        amount: opportunities.amount,
        stage: opportunities.stage,
        status: opportunities.status,
        source: opportunities.source,
        solutionId: opportunities.solutionId,
        programId: opportunities.programId,
      })
      .from(opportunities)
      .where(
        oppId
          ? and(eq(opportunities.tenantId, identity.tenantId), eq(opportunities.id, oppId))
          : eq(opportunities.tenantId, identity.tenantId),
      )
      .orderBy(desc(opportunities.amount));

    const deals: MatcherDeal[] = oppRows.map((o) => ({
      id: o.id,
      name: o.name,
      accountName: o.accountName,
      profile: {
        amount: o.amount,
        stage: o.stage,
        status: o.status,
        source: o.source,
        solutionType: o.solutionId ? solTypeById.get(o.solutionId) ?? null : null,
        competencyKey: o.programId ? progKeyById.get(o.programId) ?? null : null,
      },
    }));

    // What has already been applied for the selected deal — the matcher badges these
    // so a user doesn't file a duplicate submission.
    const applied: Record<string, string> = {};
    if (oppId) {
      const subs = await tx
        .select({ programKey: fundingSubmissions.programKey, status: fundingSubmissions.status })
        .from(fundingSubmissions)
        .where(and(eq(fundingSubmissions.tenantId, identity.tenantId), eq(fundingSubmissions.opportunityId, oppId)));
      for (const s of subs) applied[s.programKey] = s.status;
    }

    return { deals, context, applied };
  });
}
