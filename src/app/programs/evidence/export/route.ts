import { desc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { evidence } from "@/db/schema";
import { AppError } from "@/http/errors";

/**
 * CSV export of the tenant's evidence inventory. Read-only and tenant-scoped via
 * RLS. Values are quoted/escaped so embedded commas and quotes are safe.
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "evidence:read");

    const rows = await withTenant(identity, (tx) =>
      tx
        .select()
        .from(evidence)
        .where(eq(evidence.tenantId, identity.tenantId))
        .orderBy(desc(evidence.createdAt)),
    );

    const header = [
      "title",
      "type",
      "status",
      "program",
      "quality_score",
      "reusable",
      "due_date",
      "expiration_date",
      "has_file",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.title,
          r.evidenceType,
          r.status,
          r.program ?? "",
          r.qualityScore ?? "",
          r.reusable ? "yes" : "no",
          r.dueDate ?? "",
          r.expirationDate ?? "",
          r.storageObjectId ? "yes" : "no",
          r.createdAt.toISOString(),
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="evidence.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function csvCell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
