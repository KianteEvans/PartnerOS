import type { PgTable } from "drizzle-orm/pg-core";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { AppError } from "@/http/errors";

/**
 * Full tenant data export (GDPR access / portability). Streams every row this
 * workspace owns as a single JSON bundle. Read-only and tenant-scoped: under
 * withTenant, RLS filters each table to the caller's tenant automatically, so a
 * plain `select` per table cannot leak another tenant's data. Gated on
 * settings:manage (owner/admin). The internal idempotency ledger is excluded —
 * it's mutation-gate plumbing, not workspace data.
 */
const EXPORT_TABLES: ReadonlyArray<readonly [string, PgTable]> = [
  ["tenant", schema.tenants],
  ["users", schema.users],
  ["invitations", schema.invitations],
  ["audit_log", schema.auditLog],
  ["storage_objects", schema.storageObjects],
  ["assessments", schema.assessments],
  ["assessment_modules", schema.assessmentModules],
  ["assessment_responses", schema.assessmentResponses],
  ["assessment_recommendations", schema.assessmentRecommendations],
  ["tasks", schema.tasks],
  ["onboarding", schema.onboarding],
  ["roadmaps", schema.roadmaps],
  ["roadmap_milestones", schema.roadmapMilestones],
  ["evidence", schema.evidence],
  ["programs", schema.programs],
  ["program_requirements", schema.programRequirements],
  ["tier_plans", schema.tierPlans],
  ["tier_requirements", schema.tierRequirements],
  ["mdf_requests", schema.mdfRequests],
  ["opportunities", schema.opportunities],
  ["ace_relationships", schema.aceRelationships],
  ["reports", schema.reports],
  ["workspace_settings", schema.workspaceSettings],
  ["connectors", schema.connectors],
];

export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "settings:manage");

    const sections = await withTenant(identity, async (tx) => {
      const out: Record<string, unknown> = {};
      for (const [key, table] of EXPORT_TABLES) {
        out[key] = await tx.select().from(table);
      }
      return out;
    });

    const bundle = {
      exportedAt: new Date().toISOString(),
      tenantId: identity.tenantId,
      schemaVersion: "0013",
      data: sections,
    };
    // bigint columns (e.g. storage size) aren't JSON-serializable; stringify them.
    const body = JSON.stringify(
      bundle,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    );

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="partneros-workspace-export.json"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}
