import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { AppError } from "@/http/errors";
import { AUDIT_EXPORT_CAP, auditWhere, parseAuditFilters } from "@/domain/audit/query";
import { collectOperatorRefs, operatorRefFromMetadata } from "@/domain/audit/attribution";
import { loadAttribution } from "@/domain/audit/attribution-load";

/**
 * Audit log CSV export. Read-only, tenant-scoped via RLS, gated on audit:read,
 * and applies the same filters as the viewer. Capped to bound the response.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "audit:read");

    const filters = parseAuditFilters(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const { rows, emailById } = await withTenant(identity, async (tx) => {
      const where = auditWhere(identity.tenantId, filters);
      const rows = await tx
        .select({
          createdAt: auditLog.createdAt,
          actorUserId: auditLog.actorUserId,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(AUDIT_EXPORT_CAP);
      const members = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.tenantId, identity.tenantId));
      return { rows, emailById: new Map(members.map((m) => [m.id, m.email])) };
    });

    // Resolve agency act-as attribution (cross-tenant) so the CSV records which
    // agency operator acted, not just the synthetic service user.
    const attribution = await loadAttribution(collectOperatorRefs(rows.map((r) => r.metadata)));
    const lines: string[] = [
      "timestamp_utc,actor,action,resource_type,resource_id,operator,agency",
    ];
    for (const r of rows) {
      const ref = operatorRefFromMetadata(r.metadata);
      lines.push(
        [
          r.createdAt.toISOString(),
          r.actorUserId ? emailById.get(r.actorUserId) ?? "" : "system",
          r.action,
          r.resourceType,
          r.resourceId ?? "",
          ref ? attribution.operatorEmailById.get(ref.operatorId) ?? "" : "",
          ref ? attribution.agencyNameById.get(ref.agencyId) ?? "" : "",
        ]
          .map(cell)
          .join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="audit-log.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function cell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
