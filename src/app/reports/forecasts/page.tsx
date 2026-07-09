import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { RingGauge } from "@/components/ui/RingGauge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectionChart } from "@/components/ui/ProjectionChart";
import { can } from "@/authz/permissions";
import { loadForecasts, REVENUE_HORIZON_DAYS, METRIC_HORIZON_DAYS, type SeriesForecast } from "@/domain/forecast/load";
import { MIN_POINTS } from "@/domain/forecast/project";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

/**
 * Forecasts (Wave 3). The forward view over the app's accumulated snapshot history:
 * Monte-Carlo marketplace-revenue projection with a P10-P90 confidence band, roadmap
 * completion-date distributions, an ROI-weighted MDF budget split, and health/win-rate
 * trajectories. Extrapolation under a stationarity assumption — labeled as such.
 */


function ProjectionPanel({
  title,
  fc,
  formatValue,
  horizonDays,
  unit,
}: {
  title: string;
  fc: SeriesForecast | null;
  formatValue: (n: number) => string;
  horizonDays: number;
  unit: string;
}): ReactNode {
  if (!fc || fc.history.length === 0) {
    return (
      <Panel title={title} accent="var(--section-accent)">
        <EmptyState title="No history yet" hint="Snapshots are captured as you use the app — this forecast unlocks once a series exists." />
      </Panel>
    );
  }
  return (
    <Panel title={title} accent="var(--section-accent)">
      {fc.projection ? (
        <>
          <ProjectionChart history={fc.history} band={fc.projection.band} formatValue={formatValue} />
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            Today <strong style={{ color: "var(--text)" }}>{fc.current == null ? "—" : formatValue(fc.current)}</strong> · in{" "}
            {horizonDays}d P50 <strong style={{ color: "var(--text)" }}>{formatValue(fc.projection.terminal.p50)}</strong>{" "}
            <span>
              ({formatValue(fc.projection.terminal.p10)} – {formatValue(fc.projection.terminal.p90)} {unit})
            </span>
          </p>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Collecting history — the projection unlocks after {MIN_POINTS} snapshots ({fc.history.length} so far).
        </p>
      )}
    </Panel>
  );
}

export default async function ForecastsPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("reports_forecasts");
  if (fenced) return <PackageFence feature="reports_forecasts" previewTier={fenced} />;
  if (!can(identity.role, "report:read")) redirect("/");

  const v = await loadForecasts(identity);

  return (
    <PageShell>
      <PageHeader
        title="Forecasts"
        subtitle="Where the numbers are heading — Monte-Carlo projections from your own history"
        breadcrumbs={[{ href: "/reports", label: "Reports" }, { label: "Forecasts" }]}
      />

      {/* Panel 1 — marketplace revenue (flagship) */}
      <ProjectionPanel
        title="Marketplace revenue — projected"
        fc={v.revenue}
        formatValue={money}
        horizonDays={REVENUE_HORIZON_DAYS}
        unit="P10–P90"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {/* Panel 2 — roadmap completion */}
        <Panel title="Roadmap completion — when do plans actually land?" accent="accent">
          {v.roadmaps.length === 0 ? (
            <EmptyState title="No finalized roadmaps" hint="Finalize a roadmap in Planning — its burn-up history feeds the completion forecast." />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {v.roadmaps.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  {r.mc?.hitProbability != null ? (
                    <RingGauge
                      value={Math.round(r.mc.hitProbability * 100)}
                      size={64}
                      thickness={8}
                      color={r.mc.hitProbability >= 0.7 ? "var(--ok)" : r.mc.hitProbability >= 0.4 ? "var(--warn)" : "var(--danger)"}
                      caption="on time"
                    />
                  ) : null}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                      {r.name} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12.5 }}>· {r.done}/{r.total} milestones</span>
                    </p>
                    {r.mc ? (
                      <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                        Likely done <strong style={{ color: "var(--text)" }}>{r.mc.p50Date ?? "beyond horizon"}</strong>
                        {r.mc.p90Date ? <> · worst-case {r.mc.p90Date}</> : null}
                        {r.plannedEnd ? <> · planned {r.plannedEnd}</> : null}
                        {r.linearDate ? <> · linear ETA {r.linearDate}</> : null}
                      </p>
                    ) : (
                      <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                        Collecting burn-up history ({r.snapshotCount}/{MIN_POINTS} snapshots)
                        {r.linearDate ? <> · linear ETA {r.linearDate}</> : null}
                        {r.plannedEnd ? <> · planned {r.plannedEnd}</> : null}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Panel 3 — MDF budget optimizer */}
        <Panel title="MDF budget optimizer" accent="accent">
          {!v.budget ? (
            <EmptyState title="No active budget" hint="Set an MDF budget for the current period — the optimizer splits its remaining dollars by observed ROI." />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                {v.budget.periodLabel}: {money(v.budget.status.committed)} committed of {money(v.budget.status.allocated)} ·{" "}
                <strong style={{ color: v.budget.status.remaining > 0 ? "var(--text)" : "var(--danger)" }}>
                  {money(Math.max(0, v.budget.status.remaining))} remaining
                </strong>
              </p>
              <BarChart
                formatValue={(n) => `${n}x`}
                data={v.budget.activities
                  .filter((a) => a.roi !== null)
                  .map((a) => ({ label: a.activityType, value: Math.round((a.roi ?? 0) * 10) / 10 }))}
              />
              {v.budget.plan ? (
                <>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                        <th style={{ padding: "4px 8px" }}>Activity</th>
                        <th style={{ padding: "4px 8px", textAlign: "right" }}>ROI</th>
                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Share</th>
                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Allocate</th>
                        <th style={{ padding: "4px 8px", textAlign: "right" }}>Expected pipeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.budget.plan.allocations.map((a) => (
                        <tr key={a.activityType} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "7px 8px", fontWeight: 600 }}>{a.activityType}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right" }}>{a.roi}x</td>
                          <td style={{ padding: "7px 8px", textAlign: "right" }}>{Math.round(a.share * 100)}%</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(a.amount)}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ok)" }}>
                            {money(a.expectedPipeline)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {v.budget.plan.upliftPct !== null && v.budget.plan.upliftPct > 0 ? (
                    <Callout tone="ok" title="ROI-weighted split pays">
                      Allocating by observed pipeline-per-dollar projects{" "}
                      <strong>{money(v.budget.plan.totalExpectedPipeline)}</strong> of pipeline —{" "}
                      <strong>+{v.budget.plan.upliftPct}%</strong> vs an equal split ({money(v.budget.plan.equalSplitPipeline)}).
                    </Callout>
                  ) : null}
                  {v.budget.plan.unmeasured.length > 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                      Unmeasured (no approved spend yet): {v.budget.plan.unmeasured.join(", ")} <Badge tone="neutral">no ROI data</Badge>
                    </p>
                  ) : null}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                  Nothing left to allocate (or no activity has measurable ROI yet).
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* Panel 4 — health & win-rate trajectory */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ProjectionPanel title="Partnership health — trajectory" fc={v.health} formatValue={(n) => String(Math.round(n))} horizonDays={METRIC_HORIZON_DAYS} unit="" />
        <ProjectionPanel title="Win rate — trajectory" fc={v.winRate} formatValue={(n) => `${Math.round(n)}%`} horizonDays={METRIC_HORIZON_DAYS} unit="" />
      </div>

      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
        Forecasts extrapolate your observed day-over-day history (Monte-Carlo resampling, P10–P90 band) and assume
        recent behavior continues — a lens, not a promise. Bands tighten as history accumulates; budget projections
        use expected pipeline-per-dollar from past MDF activities.
      </p>
    </PageShell>
  );
}
