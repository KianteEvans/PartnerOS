import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { metricSnapshots } from "@/db/schema";
import { loadProgramFit } from "@/domain/evidence/fit-load";
import type { CompetencyOption } from "@/domain/tiers/path";

/**
 * Extra signals the Tier Path view needs on top of the plan's requirements: the daily
 * tier-% series (`metric_snapshots`) for the velocity reality-check, and the program-fit
 * competency options (fewest-gap ranking) for a competency-count requirement. Lazy —
 * only called when the Path view is active. No new table (metric_snapshots exists).
 */
export interface TierPathData {
  readonly history: readonly { readonly capturedOn: string; readonly percent: number }[];
  readonly competencyOptions: readonly CompetencyOption[];
  readonly adoptedKeys: ReadonlySet<string>;
}

export async function loadTierPath(identity: DbIdentity, today: string): Promise<TierPathData> {
  const rows = await withTenant(identity, (tx) =>
    tx
      .select({ capturedOn: metricSnapshots.capturedOn, tierPercent: metricSnapshots.tierPercent })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(metricSnapshots.capturedOn))
      .limit(60),
  );
  const history = rows
    .filter((r): r is { capturedOn: string; tierPercent: number } => r.tierPercent !== null)
    .map((r) => ({ capturedOn: r.capturedOn, percent: r.tierPercent }))
    .reverse(); // oldest -> newest for a forward velocity read

  const fit = await loadProgramFit(identity, today);
  const competencyOptions: CompetencyOption[] = fit.fits.map((f) => ({
    programKey: f.programKey,
    name: f.name,
    programType: f.programType,
    gapCount: f.gapCount,
    coveragePercent: f.coveragePercent,
  }));
  return { history, competencyOptions, adoptedKeys: fit.adoptedKeys };
}
