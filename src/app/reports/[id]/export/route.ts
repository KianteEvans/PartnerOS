import { and, desc, eq, lt } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import {
  canExport,
  healthFromSnapshot,
  snapshotDelta,
  type ReportHealth,
  type KpiDelta,
  type ReportSnapshot,
  type ReportStatus,
} from "@/domain/reports/metrics";
import { AppError } from "@/http/errors";
import { money } from "@/domain/format";

/**
 * Report export. The snapshot is point-in-time data, so it can only be exported
 * once the report is approved. ?format=json (default) or csv. Read-only,
 * tenant-scoped via RLS. Includes the derived partnership-health composite and the
 * period-over-period change vs the immediately-prior report.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const identity = await getServerIdentity();
    requirePermission(identity, "report:read");
    const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";

    const data = await withTenant(identity, async (tx) => {
      const [report] = await tx
        .select({
          title: reports.title,
          status: reports.status,
          summary: reports.summary,
          snapshot: reports.snapshot,
          createdAt: reports.createdAt,
        })
        .from(reports)
        .where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId)));
      if (!report) return null;
      const [prior] = await tx
        .select({ snapshot: reports.snapshot })
        .from(reports)
        .where(and(eq(reports.tenantId, identity.tenantId), lt(reports.createdAt, report.createdAt)))
        .orderBy(desc(reports.createdAt))
        .limit(1);
      return { report, prior: (prior?.snapshot as ReportSnapshot | undefined) ?? null };
    });
    if (!data) return new Response("Not found", { status: 404 });

    const { report } = data;
    if (!canExport(report.status as ReportStatus)) {
      return new Response("Report must be approved before export", { status: 409 });
    }
    const snapshot = report.snapshot as ReportSnapshot;
    const health = healthFromSnapshot(snapshot);
    const delta = snapshotDelta(snapshot, data.prior);

    if (format === "json") {
      const body = JSON.stringify(
        { title: report.title, summary: report.summary, health, snapshot, delta },
        null,
        2,
      );
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="report.json"',
          "cache-control": "private, no-store",
        },
      });
    }

    const csv = snapshotToCsv(snapshot, health, delta);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="report.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}


/** Flatten the snapshot to section,metric,value rows with human labels, plus the
 *  partnership-health composite and a change-vs-previous block. */
function snapshotToCsv(s: ReportSnapshot, health: ReportHealth, delta: KpiDelta[]): string {
  const lines = ["section,metric,value"];
  const row = (section: string, metric: string, value: string) =>
    lines.push([section, metric, value].map(cell).join(","));

  row("Partnership health", "Score", `${health.score}/100`);
  row("Partnership health", "Band", health.band.replace("_", " "));
  for (const d of health.drivers) row("Partnership health", d.label, `${d.score}/100`);

  row("MDF", "Requested", money(s.mdf.requested));
  row("MDF", "Approved", money(s.mdf.approved));
  row("MDF", "Claimed", money(s.mdf.claimed));
  row("MDF", "Reimbursed", money(s.mdf.reimbursed));
  row("MDF", "Remaining", money(s.mdf.remaining));
  row("MDF", "Expected pipeline", money(s.mdf.pipeline));
  row("MDF", "ROI", s.mdf.roi == null ? "" : `${s.mdf.roi}x`);
  row("MDF", "Deadline risks", String(s.mdf.deadlineRisks));

  row("ACE", "Open opportunities", String(s.ace.open));
  row("ACE", "Open value", money(s.ace.openValue));
  row("ACE", "Won", String(s.ace.won));
  row("ACE", "Won value", money(s.ace.wonValue));
  row("ACE", "At risk", String(s.ace.atRisk));
  row("ACE", "Unrouted", String(s.ace.unrouted));

  row("Evidence", "Total", String(s.evidence.total));
  row("Evidence", "Approved", String(s.evidence.approved));
  row("Evidence", "Missing", String(s.evidence.missing));
  row("Evidence", "% approved", `${s.evidence.percent}%`);

  row("Programs", "Total", String(s.programs.total));
  row("Programs", "Active", String(s.programs.active));
  row("Programs", "In progress", String(s.programs.pending));
  row("Programs", "Expired", String(s.programs.expired));

  if (s.tier) {
    row("Tier", "Current", s.tier.current);
    row("Tier", "Target", s.tier.target);
    row("Tier", "Status", s.tier.status);
    row("Tier", "Requirements met", `${s.tier.met}/${s.tier.total}`);
    row("Tier", "% to target", `${s.tier.percent}%`);
  } else {
    row("Tier", "Plan", "None");
  }

  row("Tasks", "Total", String(s.tasks.total));
  row("Tasks", "Open", String(s.tasks.open));
  row("Tasks", "Done", String(s.tasks.done));
  row("Tasks", "Overdue", String(s.tasks.overdue));

  row("Assessments", "Count", String(s.assessments.count));
  row("Assessments", "Scored", String(s.assessments.scored));
  row("Assessments", "Latest score", s.assessments.latestScore == null ? "" : `${s.assessments.latestScore}/100`);

  if (delta.some((d) => d.prior !== null)) {
    for (const d of delta) {
      const change = d.delta === null ? "" : d.delta > 0 ? `+${d.delta}` : String(d.delta);
      row("Change vs previous", d.label, change);
    }
  }

  return lines.join("\r\n");
}

function cell(value: unknown): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
