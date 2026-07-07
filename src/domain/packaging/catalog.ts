/**
 * Service-package catalog for the preview mode ("view as Essentials / Growth /
 * Enterprise"). This is the SINGLE source of truth mapping product features to
 * the packaging tiers defined in docs/service-packages.md (v2, stage-anchored).
 *
 * Preview-only: nothing here enforces entitlements — the app stays fully
 * unlocked. A per-user cookie (src/domain/packaging/preview.ts) simulates a
 * tier; surfaces consult `isIncluded`/`featureForPath` to hide or fence.
 *
 * NOT the AWS partner tier (src/domain/tiers, Select/Advanced/Premier) — that
 * models the partner's standing with AWS; this models PartnerOS packaging.
 *
 * Standing rules encoded by OMISSION (no FeatureKey => never fenced): the
 * ACE records layer, evidence, case studies, competency applications (incl.
 * AI drafting), assessments/roadmaps, tier tracking, benchmarking, connector
 * sync, command core + tasks, settings core. "Records open, management
 * fenced" — fences sit on volume machinery and cross-module fusion only.
 *
 * Client-safe on purpose: Sidebar and CommandPalette (client components)
 * import this module. Keep it free of server-only imports.
 */

export const PACKAGE_TIERS = ["essentials", "growth", "enterprise"] as const;
export type PackageTier = (typeof PACKAGE_TIERS)[number];

export const PACKAGE_META: Record<PackageTier, { readonly label: string; readonly stage: string }> = {
  essentials: { label: "Essentials", stage: "Establish" },
  growth: { label: "Growth", stage: "Scale" },
  enterprise: { label: "Enterprise", stage: "Operate" },
};

export type FeatureKey =
  | "deal_desk"
  | "ace_management"
  | "ace_reps"
  | "ace_insights"
  | "mdf"
  | "funding"
  | "marketplace"
  | "reports"
  | "reports_forecasts"
  | "playbooks"
  | "playbooks_auto"
  | "command_graph"
  | "scenario_planning"
  | "copilot"
  | "settings_governance";

/** Lowest tier that includes the feature (tiers are cumulative). */
export const MIN_TIER: Record<FeatureKey, PackageTier> = {
  deal_desk: "growth",
  ace_management: "growth",
  ace_reps: "growth",
  ace_insights: "growth",
  mdf: "growth",
  funding: "growth",
  marketplace: "growth",
  reports: "growth",
  playbooks: "growth",
  playbooks_auto: "enterprise",
  copilot: "enterprise",
  command_graph: "enterprise",
  scenario_planning: "enterprise",
  reports_forecasts: "enterprise",
  settings_governance: "enterprise",
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  deal_desk: "The Deal Desk",
  ace_management: "Pipeline management",
  ace_reps: "AWS Sales-Org intelligence",
  ace_insights: "Win/loss insights",
  mdf: "MDF lifecycle",
  funding: "AWS Funding",
  marketplace: "AWS Marketplace",
  reports: "Reports & exports",
  reports_forecasts: "Forecasting suite",
  playbooks: "Playbooks",
  playbooks_auto: "Automated playbooks",
  command_graph: "Partnership graph",
  scenario_planning: "Scenario planning",
  copilot: "Alliance Copilot",
  settings_governance: "Governance suite",
};

const TIER_ORDER: Record<PackageTier, number> = { essentials: 0, growth: 1, enterprise: 2 };

/** Is the feature part of the simulated tier? `null` = full platform (no preview). */
export function isIncluded(preview: PackageTier | null, feature: FeatureKey): boolean {
  if (preview === null) return true;
  return TIER_ORDER[preview] >= TIER_ORDER[MIN_TIER[feature]];
}

export function requiredTier(feature: FeatureKey): PackageTier {
  return MIN_TIER[feature];
}

/** The lower (more restrictive) of two tiers by cumulative order. Used to clamp
 *  a preview so it can only ever DOWNGRADE the real entitlement, never exceed it. */
export function lowerOf(a: PackageTier, b: PackageTier): PackageTier {
  return TIER_ORDER[a] <= TIER_ORDER[b] ? a : b;
}

/**
 * Route -> feature map for nav/palette/search filtering. Longest prefix wins
 * (the array is checked in order). A trailing "/" means "descendants only":
 * `/ace/` fences deal-desk detail pages while `/ace` itself (the records
 * workspace, open in every tier) stays unfenced.
 */
const ROUTE_FEATURES: ReadonlyArray<{ readonly prefix: string; readonly feature: FeatureKey }> = [
  { prefix: "/reports/forecasts", feature: "reports_forecasts" },
  { prefix: "/reports", feature: "reports" },
  { prefix: "/playbooks/channels", feature: "playbooks_auto" },
  { prefix: "/playbooks", feature: "playbooks" },
  { prefix: "/command/graph", feature: "command_graph" },
  { prefix: "/marketplace", feature: "marketplace" },
  { prefix: "/funding", feature: "funding" },
  { prefix: "/mdf", feature: "mdf" },
  { prefix: "/ace/", feature: "deal_desk" },
];

function prefixMatches(path: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return path.startsWith(prefix) && path.length > prefix.length;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Feature a path belongs to, or null when the path is never fenced. Ignores the query string. */
export function featureForPath(pathname: string): FeatureKey | null {
  const path = pathname.split("?")[0] ?? pathname;
  for (const r of ROUTE_FEATURES) {
    if (prefixMatches(path, r.prefix)) return r.feature;
  }
  return null;
}

/** Convenience for nav/palette filters: is this href visible under the preview? */
export function isPathIncluded(preview: PackageTier | null, href: string): boolean {
  const feature = featureForPath(href);
  return feature === null || isIncluded(preview, feature);
}
