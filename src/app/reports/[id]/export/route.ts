import { and, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import { canExport, type ReportSnapshot, type ReportStatus } from "@/domain/reports/metrics";
import { AppError } from "@/http/errors";

/**
 * Report export. The snapshot is point-in-time data, so it can only be exported
 * once the report is approved. ?format=json (default) or csv. Read-only,
 * tenant-scoped via RLS.
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

    const [report] = await withTenant(identity, (tx) =>
      tx
        .select({ title: reports.title, status: reports.status, summary: reports.summary, snapshot: reports.snapshot })
        .from(reports)
        .where(and(eq(reports.id, id), eq(reports.tenantId, identity.tenantId))),
    );
    if (!report) return new Response("Not found", { status: 404 });
    if (!canExport(report.status as ReportStatus)) {
      return new Response("Report must be approved before export", { status: 409 });
    }

    if (format === "json") {
      const body = JSON.stringify({ title: report.title, summary: report.summary, snapshot: report.snapshot }, null, 2);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="report.json"',
          "cache-control": "private, no-store",
        },
      });
    }

    const csv = snapshotToCsv(report.snapshot as ReportSnapshot);
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

/** Flatten the snapshot to section,metric,value rows. */
function snapshotToCsv(s: ReportSnapshot): string {
  const lines = ["section,metric,value"];
  const push = (section: string, obj: Record<string, unknown> | null) => {
    if (!obj) {
      lines.push([section, "plan", "none"].map(cell).join(","));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      lines.push([section, k, v == null ? "" : v].map(cell).join(","));
    }
  };
  push("mdf", s.mdf);
  push("ace", s.ace);
  push("evidence", s.evidence);
  push("programs", s.programs);
  push("tier", s.tier as Record<string, unknown> | null);
  push("tasks", s.tasks);
  push("assessments", s.assessments);
  return lines.join("\r\n");
}

function cell(value: unknown): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
