import type { MarketplaceAttributionMethodId, MarketplaceAttributionStatusId } from "@/domain/marketplace/catalog";

/**
 * Pure Partner Revenue Measurement (PRM) rollups: attributed AWS-consumption revenue sliced
 * by AWS service and billing period, totals by attribution method, and per-listing method
 * readiness (how many of the three methods -- Marketplace Metering, Resource Tagging, User
 * Agent String -- are active). Money in integer cents. No DB, no clock. Testable.
 */

export interface AttributionLike {
  readonly awsService: string;
  readonly billingPeriod: string; // YYYY-MM
  readonly amount: number; // integer cents
  readonly method: MarketplaceAttributionMethodId;
}

export interface AttributionSlice {
  readonly key: string;
  readonly amountCents: number;
}

export function attributionByService(attributions: readonly AttributionLike[]): AttributionSlice[] {
  return groupSum(attributions, (a) => a.awsService).sort((x, y) => y.amountCents - x.amountCents);
}

export function attributionByPeriod(attributions: readonly AttributionLike[]): AttributionSlice[] {
  return groupSum(attributions, (a) => a.billingPeriod).sort((x, y) => x.key.localeCompare(y.key));
}

function groupSum(
  attributions: readonly AttributionLike[],
  keyOf: (a: AttributionLike) => string,
): AttributionSlice[] {
  const m = new Map<string, number>();
  for (const a of attributions) m.set(keyOf(a), (m.get(keyOf(a)) ?? 0) + a.amount);
  return [...m.entries()].map(([key, amountCents]) => ({ key, amountCents }));
}

export interface AttributionTotals {
  readonly totalCents: number;
  readonly byMethod: Readonly<Record<MarketplaceAttributionMethodId, number>>;
}

export function attributionTotals(attributions: readonly AttributionLike[]): AttributionTotals {
  const byMethod: Record<MarketplaceAttributionMethodId, number> = {
    marketplace_metering: 0,
    resource_tagging: 0,
    user_agent: 0,
  };
  let totalCents = 0;
  for (const a of attributions) {
    totalCents += a.amount;
    byMethod[a.method] += a.amount;
  }
  return { totalCents, byMethod };
}

export interface MethodConfigLike {
  readonly method: MarketplaceAttributionMethodId;
  readonly enabled: boolean;
  readonly status: MarketplaceAttributionStatusId;
}

export interface MethodReadiness {
  readonly active: number;
  readonly configured: number;
  readonly total: number;
  /** 0-100: share of the three methods that are active. */
  readonly percent: number;
}

export const PRM_METHODS: readonly MarketplaceAttributionMethodId[] = [
  "marketplace_metering",
  "resource_tagging",
  "user_agent",
];

/**
 * Readiness across the three PRM methods for one listing. A listing is well-instrumented
 * when at least one method is active; more methods improve attribution coverage.
 */
export function methodReadiness(configs: readonly MethodConfigLike[]): MethodReadiness {
  const active = configs.filter((c) => c.enabled && c.status === "active").length;
  const configured = configs.filter((c) => c.status !== "inactive").length;
  const total = PRM_METHODS.length;
  return { active, configured, total, percent: Math.round((active / total) * 100) };
}
