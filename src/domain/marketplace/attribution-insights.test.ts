import { describe, it, expect } from "vitest";
import {
  buildAttributionInsights,
  type AttributionInsightsInput,
  type InsightAttribution,
  type InsightCharge,
  type InsightConfig,
  type InsightListing,
} from "@/domain/marketplace/attribution-insights";
import { parseAttributionAdvice } from "@/domain/marketplace/attribution-ai-parse";

const listing = (over: Partial<InsightListing> = {}): InsightListing => ({
  id: "l1",
  title: "Analytics SaaS",
  status: "published",
  ...over,
});
const cfg = (over: Partial<InsightConfig> = {}): InsightConfig => ({
  listingId: "l1",
  method: "marketplace_metering",
  enabled: true,
  status: "active",
  ...over,
});
const attr = (over: Partial<InsightAttribution> = {}): InsightAttribution => ({
  listingId: "l1",
  billingPeriod: "2026-06",
  amount: 100_00,
  method: "marketplace_metering",
  ...over,
});
const chg = (over: Partial<InsightCharge> = {}): InsightCharge => ({
  listingId: "l1",
  period: "2026-06",
  amount: 100_00,
  ...over,
});
const input = (over: Partial<AttributionInsightsInput>): AttributionInsightsInput => ({
  listings: [listing()],
  configs: [cfg()],
  attributions: [attr()],
  charges: [chg()],
  ...over,
});

describe("buildAttributionInsights", () => {
  it("computes the attributed-vs-billed ratio honestly (can exceed 100, null when unbilled)", () => {
    const over = buildAttributionInsights(input({ attributions: [attr({ amount: 230_00 })], charges: [chg({ amount: 100_00 })] }));
    expect(over.ratioPercent).toBe(230);
    expect(over.attributedCents).toBe(230_00);
    expect(over.billedCents).toBe(100_00);

    const unbilled = buildAttributionInsights(input({ charges: [] }));
    expect(unbilled.ratioPercent).toBeNull();
  });

  it("flags a published listing that bills with zero attribution — and only then", () => {
    const firing = buildAttributionInsights(input({ attributions: [] }));
    expect(firing.findings.map((f) => f.key)).toContain("unmeasured_listing");

    // Not published -> quiet; no charges -> quiet.
    const draft = buildAttributionInsights(input({ listings: [listing({ status: "draft" })], attributions: [] }));
    expect(draft.findings.map((f) => f.key)).not.toContain("unmeasured_listing");
    const uncharged = buildAttributionInsights(input({ attributions: [], charges: [] }));
    expect(uncharged.findings.map((f) => f.key)).not.toContain("unmeasured_listing");
  });

  it("flags a published listing with no enabled+active method", () => {
    const none = buildAttributionInsights(input({ configs: [] }));
    expect(none.findings.map((f) => f.key)).toContain("no_active_methods");
    const disabledOnly = buildAttributionInsights(input({ configs: [cfg({ enabled: false, status: "inactive" })] }));
    expect(disabledOnly.findings.map((f) => f.key)).toContain("no_active_methods");
  });

  it("flags both dead-method variants: enabled-but-not-active and configured-but-disabled", () => {
    const enabledDead = buildAttributionInsights(input({ configs: [cfg(), cfg({ method: "resource_tagging", status: "configured" })] }));
    const dm1 = enabledDead.findings.find((f) => f.key === "dead_method");
    expect(dm1).toBeDefined();
    expect(dm1!.title).toContain("enabled but not collecting");

    const configuredOff = buildAttributionInsights(input({ configs: [cfg(), cfg({ method: "resource_tagging", enabled: false, status: "configured" })] }));
    const dm2 = configuredOff.findings.find((f) => f.key === "dead_method");
    expect(dm2).toBeDefined();
    expect(dm2!.title).toContain("configured but switched off");
  });

  it("flags single-method concentration at the 80% boundary only when another method is inactive", () => {
    const concentrated = buildAttributionInsights(
      input({
        attributions: [attr({ amount: 80_00 }), attr({ amount: 20_00, method: "resource_tagging" })],
        configs: [cfg(), cfg({ method: "resource_tagging" })], // user_agent inactive
      }),
    );
    expect(concentrated.findings.map((f) => f.key)).toContain("method_concentration");

    // Just under the boundary -> quiet.
    const under = buildAttributionInsights(
      input({
        attributions: [attr({ amount: 79_00 }), attr({ amount: 21_00, method: "resource_tagging" })],
        configs: [cfg(), cfg({ method: "resource_tagging" })],
      }),
    );
    expect(under.findings.map((f) => f.key)).not.toContain("method_concentration");

    // All three methods active -> concentration is a data fact, not a config gap -> quiet.
    const allActive = buildAttributionInsights(
      input({
        attributions: [attr({ amount: 90_00 }), attr({ amount: 10_00, method: "resource_tagging" })],
        configs: [cfg(), cfg({ method: "resource_tagging" }), cfg({ method: "user_agent" })],
      }),
    );
    expect(allActive.findings.map((f) => f.key)).not.toContain("method_concentration");
  });

  it("flags attribution data lagging the latest billed period", () => {
    const stale = buildAttributionInsights(
      input({ attributions: [attr({ billingPeriod: "2026-05" })], charges: [chg({ period: "2026-06" })] }),
    );
    expect(stale.findings.map((f) => f.key)).toContain("stale_attribution");

    const current = buildAttributionInsights(
      input({ attributions: [attr({ billingPeriod: "2026-06" })], charges: [chg({ period: "2026-06" })] }),
    );
    expect(current.findings.map((f) => f.key)).not.toContain("stale_attribution");
  });

  it("emits a single healthy finding when nothing is wrong", () => {
    // Genuinely healthy: revenue split across methods AND every method active —
    // the bare default fixture would (correctly) trip method_concentration.
    const healthy = buildAttributionInsights(
      input({
        attributions: [attr({ amount: 60_00 }), attr({ amount: 40_00, method: "resource_tagging" })],
        configs: [cfg(), cfg({ method: "resource_tagging" }), cfg({ method: "user_agent" })],
      }),
    );
    expect(healthy.findings).toHaveLength(1);
    expect(healthy.findings[0]!.key).toBe("healthy");
    expect(healthy.findings[0]!.severity).toBe("ok");
    expect(healthy.recommendations).toHaveLength(0);
  });

  it("orders dangers before warns and derives deduped imperative recommendations", () => {
    const messy = buildAttributionInsights(
      input({
        listings: [listing(), listing({ id: "l2", title: "Billed Silent" })],
        configs: [cfg(), cfg({ method: "resource_tagging", status: "configured" })],
        attributions: [attr({ billingPeriod: "2026-05" })],
        charges: [chg(), chg({ listingId: "l2", period: "2026-06", amount: 500_00 })],
      }),
    );
    const severities = messy.findings.map((f) => f.severity);
    const firstWarn = severities.indexOf("warn");
    expect(severities.lastIndexOf("danger")).toBeLessThan(firstWarn === -1 ? severities.length : firstWarn);
    expect(messy.recommendations.length).toBeGreaterThan(0);
    expect(messy.recommendations.length).toBeLessThanOrEqual(5);
    expect(new Set(messy.recommendations).size).toBe(messy.recommendations.length);
    expect(messy.recommendations.some((r) => r.includes("Billed Silent"))).toBe(true);
  });

  it("rolls up per-listing insights with own findings, ordered by billed cents", () => {
    const v = buildAttributionInsights(
      input({
        listings: [listing(), listing({ id: "l2", title: "Whale", status: "published" })],
        charges: [chg({ amount: 10_00 }), chg({ listingId: "l2", amount: 900_00 })],
      }),
    );
    expect(v.perListing.map((l) => l.listingId)).toEqual(["l2", "l1"]); // billed desc
    const whale = v.perListing[0]!;
    expect(whale.billedCents).toBe(900_00);
    expect(whale.attributedCents).toBe(0);
    expect(whale.activeMethods).toBe(0);
    expect(whale.totalMethods).toBe(3);
    expect(whale.findings.map((f) => f.key)).toEqual(
      expect.arrayContaining(["unmeasured_listing", "no_active_methods"]),
    );
    const l1 = v.perListing[1]!;
    expect(l1.activeMethods).toBe(1);
    expect(l1.findings).toHaveLength(0); // its own slate is clean
  });
});

describe("parseAttributionAdvice", () => {
  it("extracts headline + advice from a JSON reply with surrounding prose", () => {
    const parsed = parseAttributionAdvice(
      'Sure:\n{"headline": "Metering carries the load.", "advice": ["Activate tagging", "Sync monthly"]}\nDone.',
    );
    expect(parsed).toEqual({ headline: "Metering carries the load.", advice: ["Activate tagging", "Sync monthly"] });
  });

  it("clamps oversized fields and caps advice at five", () => {
    const parsed = parseAttributionAdvice(
      JSON.stringify({ headline: "h".repeat(500), advice: Array.from({ length: 8 }, (_, i) => `step ${i} ${"x".repeat(400)}`) }),
    );
    expect(parsed!.headline).toHaveLength(300);
    expect(parsed!.advice).toHaveLength(5);
    expect(parsed!.advice[0]!).toHaveLength(240);
  });

  it("returns null for malformed or empty replies", () => {
    expect(parseAttributionAdvice("no json")).toBeNull();
    expect(parseAttributionAdvice('{"headline": "", "advice": []}')).toBeNull();
    expect(parseAttributionAdvice('{"headline": "x"}')).toBeNull();
  });
});
