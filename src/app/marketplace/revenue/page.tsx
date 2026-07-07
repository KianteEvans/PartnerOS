import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { RingGauge } from "@/components/ui/RingGauge";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout } from "@/components/ui/Callout";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { loadRevenue, loadMarketplaceTrends } from "@/domain/marketplace/load";
import {
  attributionByService,
  attributionByPeriod,
  attributionTotals,
  methodReadiness,
  PRM_METHODS,
} from "@/domain/marketplace/prm";
import { configureAttributionMethod } from "@/domain/marketplace/actions";
import { ATTRIBUTION_METHOD_LABELS } from "@/domain/marketplace/catalog";
import { loadAttributionAdvisor } from "@/domain/marketplace/advisor-load";
import { buildAttributionInsights, type FindingSeverity } from "@/domain/marketplace/attribution-insights";
import { isAttributionAdvisorEnabled } from "@/domain/marketplace/attribution-ai";
import { AttributionAdvisor } from "@/app/marketplace/revenue/AttributionAdvisor";
import { moneyFromCents } from "@/domain/format";
import { formLabel as labelStyle, formControl as control } from "@/components/ui/form-styles";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const money = (cents: number): string => moneyFromCents(cents, 0);

const SEVERITY_COLOR: Record<FindingSeverity, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};
const MAX_SHOWN_FINDINGS = 6;

export default async function RevenuePage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;
  const today = new Date().toISOString().slice(0, 10);

  const [data, trends, advisorData] = await Promise.all([
    loadRevenue(identity, today),
    loadMarketplaceTrends(identity, today),
    loadAttributionAdvisor(identity),
  ]);
  const canManage = can(identity.role, "marketplace:update");
  const insights = buildAttributionInsights(advisorData);
  const ratioTone =
    insights.ratioPercent === null
      ? ("neutral" as const)
      : insights.ratioPercent >= 100
        ? ("ok" as const)
        : insights.ratioPercent >= 50
          ? ("warn" as const)
          : ("danger" as const);
  const shownFindings = insights.findings.slice(0, MAX_SHOWN_FINDINGS);
  const totals = attributionTotals(data.attributions);
  const byService = attributionByService(data.attributions);
  const byPeriod = attributionByPeriod(data.attributions);
  const coverage = data.byListing.length
    ? Math.round(data.byListing.reduce((s, l) => s + methodReadiness(l.configs).percent, 0) / data.byListing.length)
    : 0;
  const methodMix = [
    { label: "Metering", value: totals.byMethod.marketplace_metering, display: money(totals.byMethod.marketplace_metering) },
    { label: "Tagging", value: totals.byMethod.resource_tagging, display: money(totals.byMethod.resource_tagging) },
    { label: "User Agent", value: totals.byMethod.user_agent, display: money(totals.byMethod.user_agent) },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Partner Revenue Measurement"
        subtitle="Attributed AWS-consumption revenue driven by your products, by service and billing period."
      />
      <MarketplaceNav />

      <MarketplaceHero
        ring={{ value: coverage, caption: "methods active" }}
        cards={[
          { label: "Attributed revenue", value: money(totals.totalCents), tint: "accent", trend: trends.revenue },
          { label: "via Metering", value: money(totals.byMethod.marketplace_metering) },
          { label: "via Tagging", value: money(totals.byMethod.resource_tagging) },
          { label: "via User Agent", value: money(totals.byMethod.user_agent) },
        ]}
      />

      {data.attributions.length === 0 && (
        <Callout tone="info" title="No attributed revenue yet">
          Configure at least one attribution method per listing below, then attributed revenue from the AWS
          Attributed Revenue dashboard appears here by service and billing period.
        </Callout>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {byService.length > 0 && (
          <Panel title="By AWS service" accent="var(--section-accent)">
            <BarChart data={byService.map((s) => ({ label: s.key, value: s.amountCents, display: money(s.amountCents) }))} formatValue={money} />
          </Panel>
        )}
        {byPeriod.length > 0 && (
          <Panel title="By billing period" accent="var(--section-accent)">
            <BarChart data={byPeriod.map((p) => ({ label: p.key, value: p.amountCents, display: money(p.amountCents) }))} formatValue={money} />
          </Panel>
        )}
        {totals.totalCents > 0 && (
          <Panel title="Revenue by attribution method" accent="var(--section-accent)">
            <BarChart data={methodMix} formatValue={money} />
          </Panel>
        )}
      </div>

      <Panel title="Attribution method readiness" accent="var(--section-accent)">
        {data.byListing.length === 0 ? (
          <EmptyState title="No listings" hint="Add listings to configure their Partner Revenue Measurement methods." />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {data.byListing.map((l) => {
              const readiness = methodReadiness(l.configs);
              const byMethod = new Map(l.configs.map((c) => [c.method, c]));
              return (
                <Card key={l.listingId}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <RingGauge value={readiness.percent} size={56} thickness={7} caption="active" />
                      <div>
                        <strong style={{ fontSize: 14 }}>{l.listingTitle}</strong>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {PRM_METHODS.map((m) => {
                            const c = byMethod.get(m);
                            const active = c?.enabled && c.status === "active";
                            return (
                              <Badge key={m} tone={active ? "ok" : "neutral"}>
                                {ATTRIBUTION_METHOD_LABELS[m]}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {canManage && (
                      <FormDrawer
                        triggerLabel="Configure"
                        triggerVariant="secondary"
                        title={`Attribution — ${l.listingTitle}`}
                        action={configureAttributionMethod}
                        submitLabel="Save method"
                        submitVariant="secondary"
                        hidden={{ listingId: l.listingId }}
                      >
                        <label style={labelStyle}>
                          Method
                          <select name="method" defaultValue="marketplace_metering" style={control}>
                            {PRM_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {ATTRIBUTION_METHOD_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input type="checkbox" name="enabled" defaultChecked />
                          Active for this listing
                        </label>
                        <label style={labelStyle}>
                          Notes
                          <textarea name="notes" rows={2} maxLength={1000} style={control} />
                        </label>
                      </FormDrawer>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Deterministic cross-table advice (attributed vs billed + config gaps), with the
          optional gated-AI read-out on top. Always-on — no API key required. */}
      <Panel title="Attribution advisor" accent="var(--section-accent)">
        {insights.attributedCents === 0 && insights.billedCents === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Nothing to analyze yet — once Marketplace bills a charge or attribution data syncs, the
            advisor compares them and flags measurement gaps.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>
                <strong>{money(insights.attributedCents)}</strong> attributed consumption vs{" "}
                <strong>{money(insights.billedCents)}</strong> Marketplace-billed
              </span>
              <Badge tone={ratioTone}>
                {insights.ratioPercent === null ? "nothing billed yet" : `${insights.ratioPercent}% of billed`}
              </Badge>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                Different measures — attributed consumption can exceed billed revenue.
              </span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {shownFindings.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: SEVERITY_COLOR[f.severity],
                      flexShrink: 0,
                      transform: "translateY(-1px)",
                    }}
                  />
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <strong>{f.title}.</strong> <span style={{ color: "var(--muted)" }}>{f.detail}</span>
                  </div>
                </div>
              ))}
              {insights.findings.length > shownFindings.length && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  +{insights.findings.length - shownFindings.length} more finding
                  {insights.findings.length - shownFindings.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {insights.recommendations.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Do next
                </span>
                <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                  {insights.recommendations.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                      {r}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <AttributionAdvisor enabled={isAttributionAdvisorEnabled()} />
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
