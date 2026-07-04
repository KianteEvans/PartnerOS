import type { CSSProperties, ReactNode } from "react";
import { and, desc, eq, lt } from "drizzle-orm";
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
import { buildQbrPacket, type QbrKpi, type QbrMove, type QbrPacket } from "@/domain/reports/qbr";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { tierPath } from "@/domain/tiers/path";
import { TIER_LABELS, type TierId } from "@/domain/tiers/catalog";
import { PrintButton } from "@/app/plan/roadmaps/PrintButton";
import { money } from "@/domain/format";

/**
 * Clean, read-only print/PDF view of a leadership report. Print-isolation CSS hides
 * the app chrome so only the report prints; the Save-as-PDF button is screen-only.
 * Renders the partnership-health score + every section's frozen numbers as tables.
 */
const PRINT_CSS = `@media print { body * { visibility: hidden; } #report-print, #report-print * { visibility: visible; } #report-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`;


type Row = readonly [string, string];

const cell: CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "5px 8px",
  verticalAlign: "top",
  fontSize: 13,
};

const cellH: CSSProperties = {
  borderBottom: "2px solid var(--text)",
  padding: "4px 8px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--muted)",
  textAlign: "left",
};

const qbrH2: CSSProperties = {
  fontSize: 14,
  margin: "0 0 8px",
  borderBottom: "2px solid var(--text)",
  paddingBottom: 4,
};

// The snapshotDelta KPI labels carry different units; format each correctly for the
// QBR "committed vs achieved" table (Marketplace revenue is stored in cents).
const MONEY_KPIS = new Set(["MDF approved", "ACE open pipeline", "ACE won"]);
const PCT_KPIS = new Set(["Evidence %", "Tier %"]);
function formatKpi(label: string, value: number): string {
  if (label === "Marketplace revenue") return money(Math.round(value / 100));
  if (MONEY_KPIS.has(label)) return money(value);
  if (PCT_KPIS.has(label)) return `${value}%`;
  return String(value);
}
function kpiChange(k: QbrKpi): string {
  if (k.delta === null) return "New";
  if (k.delta === 0) return "No change";
  return `${k.direction === "up" ? "▲" : "▼"} ${formatKpi(k.label, Math.abs(k.delta))}`;
}
function kpiColor(k: QbrKpi): string {
  if (k.favorable === null) return "var(--muted)";
  return k.favorable ? "var(--ok)" : "var(--danger)";
}

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const fetched = await withTenant(identity, async (tx) => {
    const [r] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId)));
    if (!r) return null;
    // The immediately-prior report — period-over-period basis for the QBR arc.
    const [prior] = await tx
      .select({ snapshot: reports.snapshot })
      .from(reports)
      .where(and(eq(reports.tenantId, identity.tenantId), lt(reports.createdAt, r.createdAt)))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    return { report: r, prior: prior ?? null };
  });
  if (!fetched) notFound();
  const { report, prior } = fetched;

  const s = report.snapshot as ReportSnapshot;
  const priorSnapshot = (prior?.snapshot as ReportSnapshot | undefined) ?? null;
  const status = report.status as ReportStatus;
  const health = healthFromSnapshot(s);

  // For an AWS QBR, assemble the executive packet: the frozen snapshot supplies the
  // achieved results (vs the prior report), while the forward commitments are grounded
  // in the LIVE next-best-actions + tier path at render time.
  const isQbr = report.reportType === "qbr";
  let qbr: QbrPacket | null = null;
  if (isQbr) {
    const today = new Date().toISOString().slice(0, 10);
    const { inputs } = await loadCommandData(identity);
    const cc = buildCommandCenter(inputs, today);
    const moves: QbrMove[] = cc.nextBestActions.map((a) => ({ title: a.title, detail: a.detail, link: a.link }));
    const targetTierId = inputs.tier?.targetTier ?? s.tier?.target ?? null;
    const targetLabel = targetTierId ? TIER_LABELS[targetTierId as TierId] ?? targetTierId : "";
    const path = inputs.tier ? tierPath(inputs.tierRequirements, today, targetLabel) : null;
    qbr = buildQbrPacket(s, priorSnapshot, moves, path);
  }

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

        {/* Saved executive narrative — the graph-grounded story drafted on the report,
            rendered for every report type when present. */}
        {report.narrative && (
          <div style={{ breakInside: "avoid", marginBottom: 20 }}>
            <h2 style={qbrH2}>Executive narrative</h2>
            <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{report.narrative}</div>
          </div>
        )}

        {qbr && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px", lineHeight: 1.5 }}>{qbr.headline}</p>

            {/* Partnership-health arc — prior → current */}
            <div style={{ breakInside: "avoid", marginBottom: 20 }}>
              <h2 style={qbrH2}>Partnership health</h2>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
                  {qbr.healthArc.current.score}
                  <span style={{ fontSize: 15, color: "var(--muted)", fontWeight: 600 }}>/100</span>
                </span>
                <span style={{ textTransform: "capitalize", fontWeight: 600, fontSize: 15 }}>
                  {qbr.healthArc.current.band.replace("_", " ")}
                </span>
                {qbr.healthArc.delta !== null && (
                  <span style={{ color: qbr.healthArc.delta >= 0 ? "var(--ok)" : "var(--danger)", fontWeight: 700, fontSize: 14 }}>
                    {qbr.healthArc.delta >= 0 ? "▲" : "▼"} {Math.abs(qbr.healthArc.delta)} vs last quarter
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.5 }}>
                {qbr.healthArc.narrative}
              </p>
            </div>

            {/* Committed vs achieved — period-over-period KPI movement */}
            <div style={{ breakInside: "avoid", marginBottom: 20 }}>
              <h2 style={qbrH2}>This quarter — committed vs. achieved</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={cellH}>Metric</th>
                    <th style={{ ...cellH, textAlign: "right" }}>Last quarter</th>
                    <th style={{ ...cellH, textAlign: "right" }}>This quarter</th>
                    <th style={{ ...cellH, textAlign: "right" }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {qbr.achieved.map((k) => (
                    <tr key={k.label}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{k.label}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{k.prior === null ? "—" : formatKpi(k.label, k.prior)}</td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{formatKpi(k.label, k.current)}</td>
                      <td style={{ ...cell, textAlign: "right", color: kpiColor(k), fontWeight: 600 }}>{kpiChange(k)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Next-quarter commitments — forward plan from tier path + next-best-actions */}
            <div style={{ breakInside: "avoid" }}>
              <h2 style={qbrH2}>Next quarter — commitments</h2>
              {qbr.tierOutlook && (
                <p style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>{qbr.tierOutlook.narrative}</p>
              )}
              {qbr.commitments.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  No open commitments — the partnership is on track across every section.
                </p>
              ) : (
                <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                  {qbr.commitments.map((c, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <strong>{c.title}</strong>
                      {c.detail ? ` — ${c.detail}` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {isQbr && (
          <h2 style={{ fontSize: 13, margin: "0 0 12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Detailed metrics
          </h2>
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
