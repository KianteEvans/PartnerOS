import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconTasks, IconClock, IconPrograms, IconTiers } from "@/components/ui/icons";
import { loadManagedWorkspace } from "@/domain/portfolio/load";
import { mkTrend } from "@/domain/trend";

const BAND_TONE: Record<string, Tone> = { strong: "ok", fair: "warn", at_risk: "danger" };
const BAND_COLOR: Record<string, string> = {
  strong: "var(--ok)",
  fair: "var(--warn)",
  at_risk: "var(--danger)",
};
const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--danger)",
  high: "var(--danger)",
  medium: "var(--warn)",
  low: "var(--muted)",
};

/**
 * Read-only drill-in for one managed workspace (Bet C). Shows the workspace's health
 * + decision queue as the agency sees it, with a prominent "Open workspace" control
 * that switches the operator into an act-as session to actually work inside it.
 */
export default async function ManagedWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const { id } = await params;
  const view = await loadManagedWorkspace(identity, id);
  if (!view) redirect("/portfolio"); // not an agency, or not managed by this agency
  const { meta, cc, trends } = view;

  const openButton = (
    <form method="post" action="/api/portfolio/switch" style={{ margin: 0 }}>
      <input type="hidden" name="tenantId" value={meta.id} />
      <button
        type="submit"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: "var(--radius)",
          padding: "8px 16px",
          cursor: "pointer",
        }}
      >
        Open workspace →
      </button>
    </form>
  );

  return (
    <PageShell>
      <PageHeader
        title={meta.name}
        breadcrumbs={[{ href: "/portfolio", label: "Portfolio" }, { label: meta.name }]}
        subtitle="Read-only overview — open the workspace to act inside it"
        actions={openButton}
      />

      <section
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
          background: "var(--surface-hero)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 130 }}>
          <RingGauge value={cc.health.score} color={BAND_COLOR[cc.health.band] ?? "var(--accent-2)"} size={110} />
          <Badge tone={BAND_TONE[cc.health.band] ?? "neutral"}>{cc.health.band.replace("_", " ")}</Badge>
        </div>
        <MetricStrip min={140} style={{ flex: 1, minWidth: 244 }}>
          <MetricCard label="Open work" value={String(cc.work.open)} sub="tasks in flight" icon={<IconTasks size={15} />} trend={mkTrend(trends.openWork)} />
          <MetricCard
            label="Overdue"
            value={String(cc.work.overdue)}
            tone={cc.work.overdue > 0 ? "danger" : "neutral"}
            tint={cc.work.overdue > 0 ? "danger" : undefined}
            icon={<IconClock size={15} />}
            trend={mkTrend(trends.overdue, { invert: true })}
          />
          <MetricCard
            label="Active programs"
            value={`${cc.progress.programsActive}/${cc.progress.programsTotal}`}
            sub="competencies & tiers"
            icon={<IconPrograms size={15} />}
            trend={mkTrend(trends.activePrograms)}
          />
          <MetricCard
            label="Tier progress"
            value={cc.progress.tierPercent == null ? "—" : `${cc.progress.tierPercent}%`}
            sub="to next tier"
            icon={<IconTiers size={15} />}
            trend={cc.progress.tierPercent == null ? undefined : mkTrend(trends.tierProgress, { suffix: "%" })}
          />
        </MetricStrip>
      </section>

      <Panel title="Needs attention">
        {cc.decisions.length === 0 ? (
          <EmptyState title="All clear" hint="No open decisions in this workspace." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {cc.decisions.slice(0, 8).map((d) => (
              <div
                key={d.id}
                style={{
                  display: "grid",
                  gap: 2,
                  borderLeft: `3px solid ${SEVERITY_COLOR[d.severity] ?? "var(--border)"}`,
                  paddingLeft: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{d.title}</span>
                  <span style={{ fontSize: 11, color: SEVERITY_COLOR[d.severity] ?? "var(--muted)", textTransform: "capitalize" }}>
                    {d.severity}
                  </span>
                </div>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{d.detail}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
