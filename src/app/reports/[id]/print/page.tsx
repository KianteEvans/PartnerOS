import type { CSSProperties, ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS_LABELS,
  healthFromSnapshot,
  type ReportType,
  type ReportStatus,
  type ReportSnapshot,
} from "@/domain/reports/metrics";
import { PrintButton } from "@/app/plan/roadmaps/PrintButton";

/**
 * Clean, read-only print/PDF view of a leadership report. Print-isolation CSS hides
 * the app chrome so only the report prints; the Save-as-PDF button is screen-only.
 * Renders the partnership-health score + every section's frozen numbers as tables.
 */
const PRINT_CSS = `@media print { body * { visibility: hidden; } #report-print, #report-print * { visibility: visible; } #report-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`;

const money = (n: number): string => `$${n.toLocaleString()}`;

type Row = readonly [string, string];

const cell: CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "5px 8px",
  verticalAlign: "top",
  fontSize: 13,
};

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const report = await withTenant(identity, async (tx) => {
    const [r] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId)));
    return r ?? null;
  });
  if (!report) notFound();

  const s = report.snapshot as ReportSnapshot;
  const status = report.status as ReportStatus;
  const health = healthFromSnapshot(s);

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: "Partnership health",
      rows: [
        ["Score", `${health.score} / 100`],
        ["Band", health.band.replace("_", " ")],
        ...health.drivers.map((d): Row => [d.label, `${d.score} / 100`]),
      ],
    },
    {
      title: "MDF",
      rows: [
        ["Requested", money(s.mdf.requested)],
        ["Approved", money(s.mdf.approved)],
        ["Claimed", money(s.mdf.claimed)],
        ["Reimbursed", money(s.mdf.reimbursed)],
        ["Remaining", money(s.mdf.remaining)],
        ["Expected pipeline", money(s.mdf.pipeline)],
        ["ROI", s.mdf.roi == null ? "—" : `${s.mdf.roi}x`],
        ["Deadline risks", String(s.mdf.deadlineRisks)],
      ],
    },
    {
      title: "ACE co-sell",
      rows: [
        ["Open opportunities", String(s.ace.open)],
        ["Open value", money(s.ace.openValue)],
        ["Won", String(s.ace.won)],
        ["Won value", money(s.ace.wonValue)],
        ["At risk", String(s.ace.atRisk)],
        ["Unrouted", String(s.ace.unrouted)],
      ],
    },
    {
      title: "Evidence",
      rows: [
        ["Total", String(s.evidence.total)],
        ["Approved", String(s.evidence.approved)],
        ["Missing", String(s.evidence.missing)],
        ["% approved", `${s.evidence.percent}%`],
      ],
    },
    {
      title: "Programs",
      rows: [
        ["Total", String(s.programs.total)],
        ["Active", String(s.programs.active)],
        ["In progress", String(s.programs.pending)],
        ["Expired", String(s.programs.expired)],
      ],
    },
    {
      title: "Tier",
      rows: s.tier
        ? [
            ["Current", s.tier.current],
            ["Target", s.tier.target],
            ["Status", s.tier.status],
            ["Requirements met", `${s.tier.met} / ${s.tier.total}`],
            ["% to target", `${s.tier.percent}%`],
          ]
        : [["Plan", "None"]],
    },
    {
      title: "Tasks",
      rows: [
        ["Total", String(s.tasks.total)],
        ["Open", String(s.tasks.open)],
        ["Done", String(s.tasks.done)],
        ["Overdue", String(s.tasks.overdue)],
      ],
    },
    {
      title: "Assessments",
      rows: [
        ["Count", String(s.assessments.count)],
        ["Scored", String(s.assessments.scored)],
        ["Latest score", s.assessments.latestScore == null ? "—" : `${s.assessments.latestScore} / 100`],
      ],
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />
      </div>
      <div id="report-print">
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>{report.title}</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 12px", fontSize: 13 }}>
          {REPORT_TYPE_LABELS[report.reportType as ReportType]} · {REPORT_STATUS_LABELS[status]}
          {report.periodStart && report.periodEnd ? ` · ${report.periodStart} → ${report.periodEnd}` : ""}
          {" · Health "}
          {health.score}/100 ({health.band.replace("_", " ")})
        </p>
        {report.summary && (
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 18px" }}>{report.summary}</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18 }}>
          {sections.map((sec) => (
            <div key={sec.title} style={{ breakInside: "avoid" }}>
              <h2 style={{ fontSize: 14, margin: "0 0 6px", borderBottom: "2px solid var(--text)", paddingBottom: 4 }}>{sec.title}</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {sec.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{k}</td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 600, textTransform: k === "Band" || k === "Status" ? "capitalize" : "none" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
