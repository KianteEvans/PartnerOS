import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { solutions, opportunities, tenants } from "@/db/schema";
import { addMonths } from "@/domain/dates";
import { renewalReadiness, type RenewalBand, type RenewalStatus } from "@/domain/solutions/renewal";
import type { TierId } from "@/domain/tiers/catalog";

/** Read-only loaders for the Solutions pages. The launched-opportunity count is a
 *  rolling-12-month window (stage="launched" + close_date in window). `today` is a
 *  param so the loader stays clock-free. */

export interface SolutionListItem {
  readonly id: string;
  readonly title: string;
  readonly solutionType: string;
  readonly programType: string;
  readonly availability: string;
  readonly launchedCount: number;
  readonly band: RenewalBand;
  readonly renewalDate: string | null;
}

export async function loadSolutions(identity: DbIdentity, today: string): Promise<SolutionListItem[]> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const horizon = addMonths(today, -12);
    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, t));
    const currentTier = (tenant?.tier ?? "registered") as TierId;

    const rows = await tx
      .select({
        id: solutions.id,
        title: solutions.title,
        solutionType: solutions.solutionType,
        programType: solutions.programType,
        availability: solutions.availability,
        ftrStatus: solutions.ftrStatus,
        renewalDate: solutions.renewalDate,
        launchedCount: sql<number>`count(${opportunities.id})`,
      })
      .from(solutions)
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.solutionId, solutions.id),
          eq(opportunities.stage, "launched"),
          gte(opportunities.closeDate, horizon),
        ),
      )
      .where(eq(solutions.tenantId, t))
      .groupBy(solutions.id)
      .orderBy(desc(solutions.createdAt));

    return rows.map((r) => {
      const launchedCount = Number(r.launchedCount);
      const renewal = renewalReadiness(
        {
          availability: r.availability,
          programType: r.programType,
          solutionType: r.solutionType,
          ftrStatus: r.ftrStatus,
          currentTier,
          launchedCount,
          renewalDate: r.renewalDate,
        },
        today,
      );
      return {
        id: r.id,
        title: r.title,
        solutionType: r.solutionType,
        programType: r.programType,
        availability: r.availability,
        launchedCount,
        band: renewal.band,
        renewalDate: r.renewalDate,
      };
    });
  });
}

export interface SolutionOpp {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly status: string;
  readonly amount: number;
  readonly closeDate: string | null;
  readonly launched: boolean;
}

export interface SolutionDetail {
  readonly id: string;
  readonly title: string;
  readonly solutionType: string;
  readonly programType: string;
  readonly description: string;
  readonly sellingProposition: string;
  readonly availability: string;
  readonly ftrStatus: string;
  readonly url: string;
  readonly marketplaceUrl: string;
  readonly renewalDate: string | null;
  readonly opportunities: readonly SolutionOpp[];
  readonly launchedCount: number;
  readonly renewal: RenewalStatus;
}

export async function loadSolutionDetail(
  identity: DbIdentity,
  id: string,
  today: string,
): Promise<SolutionDetail | null> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const [s] = await tx.select().from(solutions).where(and(eq(solutions.id, id), eq(solutions.tenantId, t)));
    if (!s) return null;

    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        stage: opportunities.stage,
        status: opportunities.status,
        amount: opportunities.amount,
        closeDate: opportunities.closeDate,
      })
      .from(opportunities)
      .where(and(eq(opportunities.solutionId, id), eq(opportunities.tenantId, t)))
      .orderBy(desc(opportunities.closeDate));

    const horizon = addMonths(today, -12);
    const oppsOut: SolutionOpp[] = opps.map((o) => ({
      ...o,
      launched: o.stage === "launched" && o.closeDate !== null && o.closeDate >= horizon,
    }));
    const launchedCount = oppsOut.filter((o) => o.launched).length;

    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, t));
    const currentTier = (tenant?.tier ?? "registered") as TierId;
    const renewal = renewalReadiness(
      {
        availability: s.availability,
        programType: s.programType,
        solutionType: s.solutionType,
        ftrStatus: s.ftrStatus,
        currentTier,
        launchedCount,
        renewalDate: s.renewalDate,
      },
      today,
    );

    return {
      id: s.id,
      title: s.title,
      solutionType: s.solutionType,
      programType: s.programType,
      description: s.description,
      sellingProposition: s.sellingProposition,
      availability: s.availability,
      ftrStatus: s.ftrStatus,
      url: s.url,
      marketplaceUrl: s.marketplaceUrl,
      renewalDate: s.renewalDate,
      opportunities: oppsOut,
      launchedCount,
      renewal,
    };
  });
}

export interface SolutionOption {
  readonly id: string;
  readonly title: string;
}

export async function loadSolutionOptions(identity: DbIdentity): Promise<SolutionOption[]> {
  return withTenant(identity, (tx) =>
    tx
      .select({ id: solutions.id, title: solutions.title })
      .from(solutions)
      .where(eq(solutions.tenantId, identity.tenantId))
      .orderBy(desc(solutions.createdAt)),
  );
}
