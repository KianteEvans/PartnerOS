import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
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
import {
  regenerateReport,
  submitReportForReview,
  approveReport,
  markReportExported,
} from "@/domain/reports/actions";
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS_LABELS,
  reportPreflight,
  canExport,
  type ReportType,
  type ReportStatus,
  type ReportSnapshot,
} from "@/domain/reports/metrics";

const money = (n: number): string => `$${n.toLocaleString()}`;

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canApprove = can(identity.role, "report:approve");

  const [report] = await withTenant(identity, (tx) =>
    tx.select().from(reports).where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId))),
  );
  if (!report) notFound();

  const status = report.status as ReportStatus;
  const snapshot = report.snapshot as ReportSnapshot;
  const preflight = reportPreflight(snapshot);

  return (
    <PageShell width={880}>
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

      {report.summary && (
        <Panel title="Executive summary">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{report.summary}</p>
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <MetricPanel title="MDF" rows={[
          ["Requested", money(snapshot.mdf.requested)],
          ["Approved", money(snapshot.mdf.approved)],
          ["Claimed", money(snapshot.mdf.claimed)],
          ["Reimbursed", money(snapshot.mdf.reimbursed)],
          ["ROI", snapshot.mdf.roi == null ? "—" : `${snapshot.mdf.roi}x`],
          ["Deadline risks", String(snapshot.mdf.deadlineRisks)],
        ]} />
        <MetricPanel title="ACE" rows={[
          ["Open", String(snapshot.ace.open)],
          ["Open value", money(snapshot.ace.openValue)],
          ["Won value", money(snapshot.ace.wonValue)],
          ["At risk", String(snapshot.ace.atRisk)],
          ["Unrouted", String(snapshot.ace.unrouted)],
        ]} />
        <MetricPanel title="Evidence" rows={[
          ["Total", String(snapshot.evidence.total)],
          ["Approved", String(snapshot.evidence.approved)],
          ["Missing", String(snapshot.evidence.missing)],
          ["Complete", `${snapshot.evidence.percent}%`],
        ]} />
        <MetricPanel title="Programs" rows={[
          ["Total", String(snapshot.programs.total)],
          ["Active", String(snapshot.programs.active)],
          ["In progress", String(snapshot.programs.pending)],
          ["Expired", String(snapshot.programs.expired)],
        ]} />
        <MetricPanel title="Tier" rows={
          snapshot.tier
            ? [["Path", `${snapshot.tier.current} → ${snapshot.tier.target}`], ["Status", <Badge key="tier-status" tone={statusTone(snapshot.tier.status)}>{snapshot.tier.status}</Badge>], ["Progress", `${snapshot.tier.met}/${snapshot.tier.total} (${snapshot.tier.percent}%)`]]
            : [["Plan", "None"]]
        } />
        <MetricPanel title="Tasks & Assessments" rows={[
          ["Open tasks", String(snapshot.tasks.open)],
          ["Overdue", String(snapshot.tasks.overdue)],
          ["Assessments scored", String(snapshot.assessments.scored)],
          ["Latest score", snapshot.assessments.latestScore == null ? "—" : `${snapshot.assessments.latestScore}/100`],
        ]} />
      </div>

      <Panel title="Approval preflight">
        <div style={{ display: "grid", gap: 6 }}>
          {preflight.checks.map((c) => (
            <div key={c.label} style={{ fontSize: 13 }}>
              <span style={{ color: c.ok ? "var(--accent)" : "var(--muted)" }}>{c.ok ? "✓" : "○"}</span> {c.label}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Lifecycle">
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
        {canExport(status) && (
          <p style={{ marginTop: 12, fontSize: 13 }}>
            Export:{" "}
            <a href={`/reports/${report.id}/export?format=json`} style={{ color: "var(--accent)" }}>JSON</a>
            {" · "}
            <a href={`/reports/${report.id}/export?format=csv`} style={{ color: "var(--accent)" }}>CSV</a>
          </p>
        )}
      </Panel>
    </PageShell>
  );
}

function MetricPanel({ title, rows }: { title: string; rows: [string, ReactNode][] }): ReactNode {
  return (
    <Panel title={title}>
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, margin: 0, fontSize: 13 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--muted)" }}>{k}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
