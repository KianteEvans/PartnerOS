import { and, eq, gte, ilike, lte, type SQL } from "drizzle-orm";
import { auditLog } from "@/db/schema";

/**
 * Shared audit-log filtering so the viewer page and the CSV export apply the
 * exact same predicate. Pure query construction — no DB access here.
 */
export interface AuditFilters {
  readonly actor: string; // userId, or "" for any
  readonly action: string; // case-insensitive substring, or ""
  readonly resource: string; // resourceType exact, or ""
  readonly from: string; // YYYY-MM-DD inclusive, or ""
  readonly to: string; // YYYY-MM-DD inclusive, or ""
}

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_CAP = 5000;

export function parseAuditFilters(
  sp: Record<string, string | string[] | undefined>,
): AuditFilters {
  const one = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  return {
    actor: one(sp.actor),
    action: one(sp.action),
    resource: one(sp.resource),
    from: one(sp.from),
    to: one(sp.to),
  };
}

/** Tenant scoping is still enforced by RLS; this adds the user-facing filters. */
export function auditWhere(tenantId: string, f: AuditFilters): SQL {
  const conds: SQL[] = [eq(auditLog.tenantId, tenantId)];
  if (f.actor) conds.push(eq(auditLog.actorUserId, f.actor));
  if (f.resource) conds.push(eq(auditLog.resourceType, f.resource));
  if (f.action) conds.push(ilike(auditLog.action, `%${f.action}%`));
  if (f.from) conds.push(gte(auditLog.createdAt, new Date(`${f.from}T00:00:00.000Z`)));
  if (f.to) conds.push(lte(auditLog.createdAt, new Date(`${f.to}T23:59:59.999Z`)));
  return and(...conds) as SQL;
}

/** Filter state as a query string (no `page`), for export links & pagination. */
export function auditQueryString(f: AuditFilters): string {
  const p = new URLSearchParams();
  if (f.actor) p.set("actor", f.actor);
  if (f.action) p.set("action", f.action);
  if (f.resource) p.set("resource", f.resource);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}
