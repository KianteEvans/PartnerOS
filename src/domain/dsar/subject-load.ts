import { eq, or, sql, getTableColumns, getTableName, is, type Column } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import * as schema from "@/db/schema";
import { users, invitations, auditLog, savedViews } from "@/db/schema";
import {
  AUTHORED_COLUMN_NAMES,
  buildSubjectExport,
  type AuthoredRecordRef,
  type SubjectExportBundle,
} from "@/domain/dsar/subject";

/**
 * Server loader for the per-individual DSAR export (companion to the pure
 * subject.ts). Runs under `withTenant`, so RLS scopes every read to the caller's
 * tenant — the subject's profile lookup is itself the authorization boundary: a
 * user in another tenant is invisible, so this returns null and the route 404s.
 */

interface AuthoredSource {
  readonly table: PgTable;
  readonly column: Column;
  readonly tableName: string;
  readonly via: string;
}

/**
 * Every (table, userColumn) across the schema whose column name marks authorship
 * — discovered by reflection so new tables stay in scope without a hand-maintained
 * list. (audit_log / saved_views / invitations are handled explicitly below and
 * excluded from AUTHORED_COLUMN_NAMES.)
 */
function authoredSources(): AuthoredSource[] {
  const out: AuthoredSource[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    for (const col of Object.values(getTableColumns(value))) {
      if (AUTHORED_COLUMN_NAMES.has(col.name)) {
        out.push({ table: value, column: col, tableName: getTableName(value), via: col.name });
      }
    }
  }
  return out;
}

export async function loadSubjectExport(
  identity: DbIdentity,
  subjectUserId: string,
): Promise<SubjectExportBundle | null> {
  return withTenant(identity, async (tx) => {
    const [profile] = await tx.select().from(users).where(eq(users.id, subjectUserId)).limit(1);
    if (!profile) return null; // not a member of this tenant (RLS) -> route returns 404
    const email = profile.email;

    // Their invitations: addressed to their email OR sent by them.
    const invites = await tx
      .select()
      .from(invitations)
      .where(
        or(
          sql`lower(${invitations.email}) = ${email.toLowerCase()}`,
          eq(invitations.invitedByUserId, subjectUserId),
        ),
      );
    // Their audit activity + private saved views.
    const auditActivity = await tx
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorUserId, subjectUserId));
    const views = await tx.select().from(savedViews).where(eq(savedViews.userId, subjectUserId));

    // References to records they authored/own (content is company data, not theirs).
    const authoredRecords: AuthoredRecordRef[] = [];
    for (const s of authoredSources()) {
      const idCol = getTableColumns(s.table).id;
      if (!idCol) continue; // junction table without a single-column id -> skip
      const rows = await tx.select({ id: idCol }).from(s.table).where(eq(s.column, subjectUserId));
      for (const r of rows) authoredRecords.push({ table: s.tableName, via: s.via, id: String(r.id) });
    }

    return buildSubjectExport({
      exportedAt: new Date().toISOString(),
      workspaceId: identity.tenantId,
      subjectId: subjectUserId,
      email,
      parts: {
        profile: profile as Record<string, unknown>,
        invitations: invites,
        auditActivity,
        savedViews: views,
        authoredRecords,
      },
    });
  });
}
