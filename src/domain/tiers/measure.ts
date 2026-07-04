import { thresholdsForTier, type TierId, type DeriveSource } from "@/domain/tiers/catalog";

/**
 * Pure auto-measurement for tier requirements. The loader gathers the few signals
 * the platform can already compute — launched-opportunity count, adopted-competency
 * count, and months at the current tier — and this maps them onto the requirements
 * that carry a `derive` source. No DB, no clock. Only derivable requirements are
 * filled; everything else (certs, accredited individuals, MRR, Business Plan,
 * Exec Review) stays manually entered.
 */

export interface TierMeasurements {
  readonly launchedCount: number;
  readonly competencyCount: number;
  /** Months the tenant has held its current tier (for the sustained-attainment gate). */
  readonly sustainedMonths: number;
}

/** Months at the current tier required for the Premier "sustained attainment" boolean. */
export const SUSTAINED_MONTHS = 6;

/** The measured currentValue for a requirement's derive source, or null if it has none. */
export function measuredValueFor(
  derive: DeriveSource | undefined,
  m: TierMeasurements,
): number | null {
  switch (derive) {
    case "launched_count":
      return m.launchedCount;
    case "competency_count":
      return m.competencyCount;
    case "sustained":
      return m.sustainedMonths >= SUSTAINED_MONTHS ? 1 : 0;
    default:
      return null;
  }
}

/** requirementKey -> measured currentValue for every derivable requirement of a tier. */
export function deriveByKey(targetTier: TierId, m: TierMeasurements): Map<string, number> {
  const out = new Map<string, number>();
  for (const req of thresholdsForTier(targetTier)) {
    const v = measuredValueFor(req.derive, m);
    if (v !== null) out.set(req.key, v);
  }
  return out;
}
