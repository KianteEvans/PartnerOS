import type { ReactNode } from "react";
import { and, desc, eq, lt } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import { Badge, statusTone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { MetricCard, type MetricTrend } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { IconReports } from "@/components/ui/icons";
import { PreflightList } from "@/components/ui/PreflightList";
import {
  regenerateReport,
  submitReportForReview,
  approveReport,
  markReportExported,
} from "@/domain/reports/actions";
import { generateReportNarrative } from "@/domain/reports/narrative-actions";
import { isReportNarrativeAiEnabled } from "@/domain/reports/narrative-ai";
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS_LABELS,
  reportPreflight,
  canExport,
  healthFromSnapshot,
  snapshotDelta,
  type ReportType,
  type ReportStatus,
  type ReportSnapshot,
  type ReportHealthBand,
} from "@/domain/reports/metrics";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


const BAND_COLOR: Record<ReportHealthBand, string> = {
  strong: "var(--ok)",
  fair: "var(--warn)",
  at_risk: "var(--danger)",
};
const BAND_TONE: Record<ReportHealthBand, "ok" | "warn" | "danger"> = {
  strong: "ok",
  fair: "warn",
  at_risk: "danger",
};
const driverColor = (score: number): string =>
  score >= 70 ? "var(--ok)" : score >= 45 ? "var(--warn)" : "var(--danger)";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("reports");
  if (fenced) return <PackageFence feature="reports" previewTier={fenced} />;
  const canApprove = can(identity.role, "report:approve");
  const canUpdate = can(identity.role, "report:update");

  const data = await withTenant(identity, async (tx) => {
    const [report] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId)));
    if (!report) return null;
    // The immediately-prior report (for period-over-period deltas).
    const [prior] = await tx
      .select({ snapshot: reports.snapshot })
      .from(reports)
      .where(and(eq(reports.tenantId, identity.tenantId), lt(reports.createdAt, report.createdAt)))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    return { report, prior: prior ?? null };
  });
  if (!data) notFound();

  const { report } = data;
  const status = report.status as ReportStatus;
  const snapshot = report.snapshot as ReportSnapshot;
  const priorSnapshot = (data.prior?.snapshot as ReportSnapshot | undefined) ?? null;
  const preflight = reportPreflight(snapshot);
  const health = healthFromSnapshot(snapshot);
  const delta = snapshotDelta(snapshot, priorSnapshot);
  const dmap = new Map(delta.map((d) => [d.label, d]));

  const trendOf = (label: string): MetricTrend | undefined => {
    const d = dmap.get(label);
    if (!d || d.prior === null || d.delta === null) return undefined;
    return { values: [d.prior, d.current], delta: d.delta, invert: d.invert };
  };

  return (
    <PageShell width={960}>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/reports", label: "Reports" }, { label: report.title }]}
        title={report.title}
        subtitle={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {REPORT_TYPE_LABELS[report.reportType as ReportType]} ·{" "}
            <Badge tone={statusTone(status)}>{REPORT_STATUS_LABELS[status]}</Badge>
            {report.periodStart && report.periodEnd ? ` · ${report.periodStart} → ${report.periodEnd}` : ""}
          </span>
        }
      />

      {/* Partnership-health hero + headline KPIs (▲/▼ vs the previous report) */}
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 150 }}>
          <RingGauge value={health.score} color={BAND_COLOR[health.band]} caption="health" size={120} />
          <Badge tone={BAND_TONE[health.band]}>{health.band.replace("_", " ")}</Badge>
        </div>
        <div style={{ flex: 1, minWidth: 260, display: "grid", gap: 12 }}>
          <MetricStrip min={140}>
            <MetricCard label="MDF approved" value={money(snapshot.mdf.approved)} trend={trendOf("MDF approved")} />
            <MetricCard label="ACE open pipeline" value={money(snapshot.ace.openValue)} trend={trendOf("ACE open pipeline")} />
            <MetricCard label="Evidence" value={`${snapshot.evidence.percent}%`} trend={trendOf("Evidence %")} />
            <MetricCard label="Tier" value={snapshot.tier ? `${snapshot.tier.percent}%` : "—"} trend={trendOf("Tier %")} />
            <MetricCard
              label="Overdue tasks"
              value={String(snapshot.tasks.overdue)}
              tone={snapshot.tasks.overdue > 0 ? "danger" : "neutral"}
              {...(snapshot.tasks.overdue > 0 ? { tint: "danger" as const } : {})}
              trend={trendOf("Overdue tasks")}
            />
          </MetricStrip>
          {health.drivers.length > 0 && (
            <BarChart
              max={100}
              formatValue={(n) => String(n)}
              data={health.drivers.map((d) => ({ label: d.label, value: d.score, color: driverColor(d.score), display: String(d.score) }))}
            />
          )}
          {priorSnapshot === null && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>First report — generate another to see period-over-period change.</p>
          )}
        </div>
      </section>

      {report.summary && (
        <Panel title="Executive summary" accent="var(--section-accent)" icon={<IconReports size={16} />}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{report.summary}</p>
        </Panel>
      )}

      {/* Saved executive narrative (drizzle/0052) — graph-grounded story, drafted while
          in draft, frozen by the lifecycle, cleared on snapshot regeneration. */}
      {(report.narrative || (status === "draft" && canUpdate)) && (
        <Panel title="Executive narrative" accent="var(--section-accent)" icon={<IconReports size={16} />}>
          <div style={{ display: "grid", gap: 12 }}>
            {report.narrative ? (
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7 }}>{report.narrative}</div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                No narrative yet. Generate the partnership&apos;s story for this draft — grounded in the
                frozen snapshot and the value-flow graph, it survives review and prints on the packet.
              </p>
            )}
            {status === "draft" && canUpdate && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <MutationForm
                  action={generateReportNarrative}
                  submitLabel={report.narrative ? "Regenerate narrative" : "Generate narrative"}
                  variant="secondary"
                  hidden={{ reportId: report.id }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {isReportNarrativeAiEnabled()
                    ? "AI-drafted from the snapshot + value-flow graph."
                    : "Works without a key — saves the deterministic outline. Set ANTHROPIC_API_KEY for AI prose."}
                </span>
              </div>
            )}
          </div>
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Panel title="MDF" accent="var(--section-accent)">
          <BarChart
            data={[
              { label: "Requested", value: snapshot.mdf.requested, display: money(snapshot.mdf.requested) },
              { label: "Approved", value: snapshot.mdf.approved, color: "var(--accent-2)", display: money(snapshot.mdf.approved) },
              { label: "Claimed", value: snapshot.mdf.claimed, color: "var(--info)", display: money(snapshot.mdf.claimed) },
              { label: "Reimbursed", value: snapshot.mdf.reimbursed, color: "var(--ok)", display: money(snapshot.mdf.reimbursed) },
            ]}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Badge tone="info">ROI {snapshot.mdf.roi == null ? "—" : `${snapshot.mdf.roi}x`}</Badge>
            <Badge tone={snapshot.mdf.deadlineRisks > 0 ? "warn" : "neutral"}>{snapshot.mdf.deadlineRisks} deadline risk{snapshot.mdf.deadlineRisks === 1 ? "" : "s"}</Badge>
          </div>
        </Panel>

        <Panel title="ACE co-sell" accent="var(--section-accent)">
          <BarChart
            data={[
              { label: "Open value", value: snapshot.ace.openValue, color: "var(--accent-2)", display: money(snapshot.ace.openValue) },
              { label: "Won value", value: snapshot.ace.wonValue, color: "var(--ok)", display: money(snapshot.ace.wonValue) },
            ]}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Badge>{snapshot.ace.open} open</Badge>
            <Badge tone={snapshot.ace.atRisk > 0 ? "warn" : "neutral"}>{snapshot.ace.atRisk} at risk</Badge>
            <Badge tone={snapshot.ace.unrouted > 0 ? "warn" : "neutral"}>{snapshot.ace.unrouted} unrouted</Badge>
          </div>
        </Panel>

        <Panel title="Evidence" accent="var(--section-accent)">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <RingGauge value={snapshot.evidence.percent} color="var(--accent-2)" caption="approved" size={104} />
            <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 4 }}>
              <span><strong style={{ color: "var(--text)" }}>{snapshot.evidence.approved}</strong>/{snapshot.evidence.total} approved</span>
              <span>{snapshot.evidence.missing} missing</span>
            </div>
          </div>
        </Panel>

        <Panel title="Programs" accent="var(--section-accent)">
          <BarChart
            formatValue={(n) => String(n)}
            data={[
              { label: "Active", value: snapshot.programs.active, color: "var(--ok)" },
              { label: "In progress", value: snapshot.programs.pending, color: "var(--accent-2)" },
              { label: "Expired", value: snapshot.programs.expired, color: "var(--danger)" },
            ]}
          />
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>{snapshot.programs.total} total in portfolio</p>
        </Panel>

        <Panel title="Tier" accent="var(--section-accent)">
          {snapshot.tier ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <RingGauge value={snapshot.tier.percent} color="var(--accent-2)" caption="to target" size={104} />
              <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 4 }}>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{snapshot.tier.current} → {snapshot.tier.target}</span>
                <span><Badge tone={statusTone(snapshot.tier.status)}>{snapshot.tier.status}</Badge></span>
                <span>{snapshot.tier.met}/{snapshot.tier.total} requirements met</span>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No tier advancement plan.</p>
          )}
        </Panel>

        <Panel title="Tasks & assessments" accent="var(--section-accent)">
          <MetricStrip min={120}>
            <MetricCard label="Open tasks" value={String(snapshot.tasks.open)} />
            <MetricCard label="Overdue" value={String(snapshot.tasks.overdue)} tone={snapshot.tasks.overdue > 0 ? "danger" : "neutral"} />
            <MetricCard label="Scored" value={String(snapshot.assessments.scored)} />
            <MetricCard label="Latest score" value={snapshot.assessments.latestScore == null ? "—" : `${snapshot.assessments.latestScore}/100`} />
          </MetricStrip>
        </Panel>

        {snapshot.marketplace && snapshot.marketplace.listings > 0 && (
          <Panel title="AWS Marketplace" accent="var(--section-accent)">
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <RingGauge
                value={Math.round((snapshot.marketplace.published / snapshot.marketplace.listings) * 100)}
                color="var(--accent-2)"
                caption="published"
                size={104}
              />
              <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 4 }}>
                <span>
                  <strong style={{ color: "var(--text)" }}>{snapshot.marketplace.published}</strong>/
                  {snapshot.marketplace.listings} listings published
                </span>
                <span>{snapshot.marketplace.activeEntitlements} active entitlements</span>
                <span>
                  <strong style={{ color: "var(--text)" }}>
                    {money(Math.round(snapshot.marketplace.attributedRevenueCents / 100))}
                  </strong>{" "}
                  attributed revenue
                </span>
              </div>
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Approval preflight" accent={preflight.ready ? "ok" : "danger"} icon={<IconReports size={16} />}>
        <PreflightList checks={preflight.checks} />
      </Panel>

      <Panel title="Lifecycle" accent="var(--section-accent)">
        {status === "draft" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <MutationForm action={regenerateReport} submitLabel="Regenerate snapshot" variant="secondary" hidden={{ reportId: report.id }} />
            <MutationForm action={submitReportForReview} submitLabel="Submit for review" hidden={{ reportId: report.id }} />
          </div>
        )}
        {status === "reviewed" && (
          canApprove ? (
            <MutationForm action={approveReport} submitLabel="Approve report" hidden={{ reportId: report.id }} />
          ) : (
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Reviewed — awaiting approval by a manager, admin, or owner.</p>
          )
        )}
        {status === "approved" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <MutationForm action={markReportExported} submitLabel="Mark exported" variant="secondary" hidden={{ reportId: report.id }} />
          </div>
        )}
        {status === "exported" && (
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Approved and exported — locked.</p>
        )}
        <p style={{ marginTop: 12, fontSize: 13 }}>
          <a href={`/reports/${report.id}/print`} style={{ color: "var(--accent)", fontWeight: 600 }}>Print / PDF →</a>
          {canExport(status) && (
            <>
              {"  ·  Export: "}
              <a href={`/reports/${report.id}/export?format=json`} style={{ color: "var(--accent)" }}>JSON</a>
              {" · "}
              <a href={`/reports/${report.id}/export?format=csv`} style={{ color: "var(--accent)" }}>CSV</a>
            </>
          )}
        </p>
      </Panel>
    </PageShell>
  );
}
