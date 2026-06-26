import { desc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { opportunities } from "@/db/schema";
import { priorityScore, type OppLike } from "@/domain/ace/opportunities";
import { AppError } from "@/http/errors";

/**
 * Account-plan export (CSV): the opportunity portfolio with priority. Read-only
 * and tenant-scoped via RLS.
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "ace:read");
    const today = new Date().toISOString().slice(0, 10);

    const rows = await withTenant(identity, (tx) =>
      tx
        .select()
        .from(opportunities)
        .where(eq(opportunities.tenantId, identity.tenantId))
        .orderBy(desc(opportunities.amount)),
    );

    const header = ["name", "account", "stage", "status", "amount", "source", "routing", "next_step", "last_interaction", "close_date", "priority"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.name,
          r.accountName,
          r.stage,
          r.status,
          r.amount,
          r.source,
          r.routingStatus,
          r.nextStep,
          r.lastInteraction ?? "",
          r.closeDate ?? "",
          priorityScore(r as OppLike, today),
        ].map(csvCell).join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="account-plan.csv"',
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
