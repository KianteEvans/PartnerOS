import type { MarketplaceAttributionMethodId, MarketplaceAttributionStatusId } from "@/domain/marketplace/catalog";
import { ATTRIBUTION_METHOD_LABELS } from "@/domain/marketplace/catalog";
import { PRM_METHODS } from "@/domain/marketplace/prm";

/**
 * Pure attribution advisor: cross-reads the three PRM tables — attributed
 * AWS-consumption revenue, per-listing method config, and Marketplace-billed
 * charges — into deterministic findings + recommendations. This is BOTH the
 * always-on panel content and the grounding for the optional AI read-out.
 *
 * Honest framing: attributed consumption revenue is NOT a subset of billed
 * revenue (different measures), so the ratio may legitimately exceed 100%.
 * Money in integer cents. No DB, no clock. Testable.
 */

export interface InsightListing {
  readonly id: string;
  readonly title: string;
  readonly status: string; // marketplace listing status; findings gate on "published"
}

export interface InsightConfig {
  readonly listingId: string;
  readonly method: MarketplaceAttributionMethodId;
  readonly enabled: boolean;
  readonly status: MarketplaceAttributionStatusId;
}

export interface InsightAttribution {
  readonly listingId: string | null;
  readonly billingPeriod: string; // YYYY-MM
  readonly amount: number; // integer cents
  readonly method: MarketplaceAttributionMethodId;
}

export interface InsightCharge {
  readonly listingId: string | null;
  readonly period: string; // YYYY-MM
  readonly amount: number; // integer cents
}

export interface AttributionInsightsInput {
  readonly listings: readonly InsightListing[];
  readonly configs: readonly InsightConfig[];
  readonly attributions: readonly InsightAttribution[];
  readonly charges: readonly InsightCharge[];
}

export type FindingKey =
  | "unmeasured_listing"
  | "no_active_methods"
  | "dead_method"
  | "method_concentration"
  | "stale_attribution"
  | "healthy";

export type FindingSeverity = "ok" | "warn" | "danger";

export interface Finding {
  readonly key: FindingKey;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly listingTitle?: string;
}

export interface ListingInsight {
  readonly listingId: string;
  readonly title: string;
  readonly attributedCents: number;
  readonly billedCents: number;
  readonly activeMethods: number;
  readonly totalMethods: number;
  readonly findings: readonly Finding[];
}

export interface AttributionInsights {
  readonly attributedCents: number;
  readonly billedCents: number;
  /** Attributed-consumption vs Marketplace-billed; may exceed 100. Null when nothing billed. */
  readonly ratioPercent: number | null;
  readonly findings: readonly Finding[];
  readonly recommendations: readonly string[];
  readonly perListing: readonly ListingInsight[];
}

/** One method carrying at least this share of attributed cents (with another inactive) is fragile. */
const CONCENTRATION_SHARE = 0.8;
const MAX_RECOMMENDATIONS = 5;

const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function buildAttributionInsights(input: AttributionInsightsInput): AttributionInsights {
  const attributedCents = input.attributions.reduce((s, a) => s + a.amount, 0);
  const billedCents = input.charges.reduce((s, c) => s + c.amount, 0);
  const ratioPercent = billedCents > 0 ? Math.round((attributedCents / billedCents) * 100) : null;

  // Per-listing rollups first — listing-scoped findings hang off these.
  const attributedByListing = new Map<string, number>();
  for (const a of input.attributions) {
    if (a.listingId) attributedByListing.set(a.listingId, (attributedByListing.get(a.listingId) ?? 0) + a.amount);
  }
  const billedByListing = new Map<string, number>();
  for (const c of input.charges) {
    if (c.listingId) billedByListing.set(c.listingId, (billedByListing.get(c.listingId) ?? 0) + c.amount);
  }
  const configsByListing = new Map<string, InsightConfig[]>();
  for (const c of input.configs) {
    const list = configsByListing.get(c.listingId) ?? [];
    list.push(c);
    configsByListing.set(c.listingId, list);
  }

  const dangers: Finding[] = [];
  const warns: Finding[] = [];
  const perListing: ListingInsight[] = [];

  // Stable listing order: billed desc (the money at stake), then title.
  const ordered = [...input.listings].sort(
    (a, b) => (billedByListing.get(b.id) ?? 0) - (billedByListing.get(a.id) ?? 0) || a.title.localeCompare(b.title),
  );

  for (const listing of ordered) {
    const attributed = attributedByListing.get(listing.id) ?? 0;
    const billed = billedByListing.get(listing.id) ?? 0;
    const configs = configsByListing.get(listing.id) ?? [];
    const activeMethods = configs.filter((c) => c.enabled && c.status === "active").length;
    const published = listing.status === "published";
    const own: Finding[] = [];

    if (published && billed > 0 && attributed === 0) {
      own.push({
        key: "unmeasured_listing",
        severity: "danger",
        title: `${listing.title} bills with nothing measured`,
        detail: `${money(billed)} billed through Marketplace but zero attributed revenue recorded — configure a measurement method.`,
        listingTitle: listing.title,
      });
    }
    if (published && activeMethods === 0) {
      own.push({
        key: "no_active_methods",
        severity: "danger",
        title: `${listing.title} has no active measurement method`,
        detail: "None of the three PRM methods is enabled and active, so consumption driven by this listing goes unmeasured.",
        listingTitle: listing.title,
      });
    }
    for (const c of configs) {
      const label = ATTRIBUTION_METHOD_LABELS[c.method];
      if (c.enabled && c.status !== "active") {
        own.push({
          key: "dead_method",
          severity: "warn",
          title: `${label} is enabled but not collecting on ${listing.title}`,
          detail: `The method is switched on but its status is "${c.status}" — finish activation or it will keep measuring nothing.`,
          listingTitle: listing.title,
        });
      } else if (!c.enabled && c.status !== "inactive") {
        own.push({
          key: "dead_method",
          severity: "warn",
          title: `${label} is configured but switched off on ${listing.title}`,
          detail: "The method was set up and then disabled — re-enable it to resume measurement.",
          listingTitle: listing.title,
        });
      }
    }

    for (const f of own) (f.severity === "danger" ? dangers : warns).push(f);
    perListing.push({
      listingId: listing.id,
      title: listing.title,
      attributedCents: attributed,
      billedCents: billed,
      activeMethods,
      totalMethods: PRM_METHODS.length,
      findings: own,
    });
  }

  // Global: single-method concentration (fragile measurement).
  if (attributedCents > 0) {
    const byMethod = new Map<MarketplaceAttributionMethodId, number>();
    for (const a of input.attributions) byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + a.amount);
    const [topMethod, topCents] = [...byMethod.entries()].sort((x, y) => y[1] - x[1])[0]!;
    const share = topCents / attributedCents;
    const anotherInactive = PRM_METHODS.some(
      (m) => m !== topMethod && !input.configs.some((c) => c.method === m && c.enabled && c.status === "active"),
    );
    if (share >= CONCENTRATION_SHARE && anotherInactive) {
      warns.push({
        key: "method_concentration",
        severity: "warn",
        title: `${ATTRIBUTION_METHOD_LABELS[topMethod]} carries ${Math.round(share * 100)}% of attributed revenue`,
        detail: "Measurement hangs on a single method while another sits inactive — one sync problem and the attributed number collapses.",
      });
    }
  }

  // Global: attribution data lagging billing (YYYY-MM strings compare lexically).
  const latestAttributed = input.attributions.reduce<string>((m, a) => (a.billingPeriod > m ? a.billingPeriod : m), "");
  const latestBilled = input.charges.reduce<string>((m, c) => (c.period > m ? c.period : m), "");
  if (latestBilled && latestAttributed && latestAttributed < latestBilled) {
    warns.push({
      key: "stale_attribution",
      severity: "warn",
      title: "Attribution data lags billing",
      detail: `The latest attributed period is ${latestAttributed} but Marketplace has billed through ${latestBilled} — sync the Attributed Revenue dashboard.`,
    });
  }

  const findings: Finding[] =
    dangers.length + warns.length > 0
      ? [...dangers, ...warns]
      : [
          {
            key: "healthy",
            severity: "ok",
            title: "Attribution setup looks healthy",
            detail: "Every published listing that bills is measuring, no configured method is idle, and the data is current.",
          },
        ];

  return {
    attributedCents,
    billedCents,
    ratioPercent,
    findings,
    recommendations: recommend(findings),
    perListing,
  };
}

/** Deterministic imperative next steps derived from the findings, capped and deduped. */
function recommend(findings: readonly Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    let rec = "";
    if (f.key === "unmeasured_listing" && f.listingTitle) {
      rec = `Configure an attribution method for ${f.listingTitle} — it is billing through Marketplace with nothing measured.`;
    } else if (f.key === "no_active_methods" && f.listingTitle) {
      rec = `Activate at least one measurement method on ${f.listingTitle}.`;
    } else if (f.key === "dead_method" && f.listingTitle) {
      rec = `Finish setting up the idle measurement method on ${f.listingTitle}.`;
    } else if (f.key === "method_concentration") {
      rec = "Activate a second attribution method so measurement does not hang on one pipeline.";
    } else if (f.key === "stale_attribution") {
      rec = "Re-sync attribution data — it lags the latest billed period.";
    }
    if (rec && !out.includes(rec)) out.push(rec);
    if (out.length >= MAX_RECOMMENDATIONS) break;
  }
  return out;
}
