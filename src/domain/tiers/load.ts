import { and, eq, inArray, sql } from "drizzle-orm";
import { opportunities, programs } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import type { TierMeasurements } from "@/domain/tiers/measure";

/**
 * Gather the few tier-requirement signals the platform can actually compute, from
 * existing domain data: launched-opportunity count (ACE), adopted-Competency count
 * (Programs), and months at the current tier (the plan's achieved date). Feeds the
 * pure `deriveByKey` for the "Sync measured values" action; everything else stays
 * manually entered.
 */

const COMPETENCY_TYPES = ["Competency", "Specialization", "MSP"];
const MS_PER_MONTH = 30 * 86_400_000;

export async function gatherTierMeasurements(
  tx: MutationContext["tx"],
  tenantId: string,
  achievedAt: Date | null,
  today: string,
): Promise<TierMeasurements> {
  const [launched] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.stage, "launched")));
  const [comps] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(programs)
    .where(
      and(
        eq(programs.tenantId, tenantId),
        eq(programs.status, "active"),
        inArray(programs.programType, COMPETENCY_TYPES),
      ),
    );
  const sustainedMonths = achievedAt
    ? Math.max(0, Math.floor((Date.parse(today) - achievedAt.getTime()) / MS_PER_MONTH))
    : 0;
  return {
    launchedCount: launched?.n ?? 0,
    competencyCount: comps?.n ?? 0,
    sustainedMonths,
  };
}
