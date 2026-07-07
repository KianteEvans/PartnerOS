/**
 * Per-individual DSAR (data-subject access request) export — pure half.
 *
 * The whole-workspace export (src/app/settings/data-export/route.ts) covers
 * portability; this covers a GDPR/CCPA *subject access request*: everything held
 * about ONE person (a workspace member). Their personal data is returned in full
 * (profile, invitations, audit activity, saved views); records they merely
 * authored/own are returned as REFERENCES (table + id) — the record content is
 * workspace/company data, not the subject's personal data, so a reference lets
 * the controller locate it without dumping unrelated data.
 *
 * This module is pure (no DB): the SQL column-name convention that marks a row as
 * "authored/owned by a user", plus the bundle assembler. The loader
 * (subject-load.ts) reflects over the schema for these column names so new tables
 * stay in scope without a hand-maintained list.
 */

/**
 * SQL column names that mean "this row was authored / owned / actioned by a user".
 * The loader discovers every schema column with one of these names.
 *
 * EXCLUDED because the loader handles them explicitly with richer semantics:
 *   - `actor_user_id`        -> the subject's audit activity
 *   - `user_id`              -> the subject's saved views (private presets)
 *   - `invited_by_user_id` / `accepted_by_user_id` -> the subject's invitations
 */
export const AUTHORED_COLUMN_NAMES: ReadonlySet<string> = new Set([
  "created_by",
  "owner_user_id",
  "reviewed_by",
  "approved_by",
  "requested_by",
  "decided_by",
  "dismissed_by",
]);

/** True when a column name marks authorship/ownership by a user (see the set). */
export function isAuthoredColumn(name: string): boolean {
  return AUTHORED_COLUMN_NAMES.has(name);
}

/** A pointer to a workspace record the subject authored/owns (not its content). */
export interface AuthoredRecordRef {
  readonly table: string;
  readonly via: string; // the column that links the subject (e.g. "created_by")
  readonly id: string;
}

export interface SubjectExportParts {
  readonly profile: Record<string, unknown>;
  readonly invitations: readonly unknown[];
  readonly auditActivity: readonly unknown[];
  readonly savedViews: readonly unknown[];
  readonly authoredRecords: readonly AuthoredRecordRef[];
}

export interface SubjectExportBundle {
  readonly exportedAt: string;
  readonly tenantId: string;
  readonly subject: { readonly userId: string; readonly email: string };
  readonly summary: {
    readonly invitations: number;
    readonly auditEvents: number;
    readonly savedViews: number;
    readonly authoredRecords: number;
  };
  readonly data: SubjectExportParts;
}

/** Assemble the DSAR bundle (adds an at-a-glance summary of counts). Pure. */
export function buildSubjectExport(input: {
  readonly exportedAt: string;
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly email: string;
  readonly parts: SubjectExportParts;
}): SubjectExportBundle {
  const { parts } = input;
  return {
    exportedAt: input.exportedAt,
    tenantId: input.workspaceId,
    subject: { userId: input.subjectId, email: input.email },
    summary: {
      invitations: parts.invitations.length,
      auditEvents: parts.auditActivity.length,
      savedViews: parts.savedViews.length,
      authoredRecords: parts.authoredRecords.length,
    },
    data: parts,
  };
}
