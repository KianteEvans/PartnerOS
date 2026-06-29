import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  competencyApplications,
  applicationControls,
  storageObjects,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { getObjectStorage } from "@/storage/s3";
import { env } from "@/env";
import { XLSX_CONTENT_TYPE, type MetSuggestion } from "@/domain/applications/schemas";
import type { Control } from "@/domain/applications/grid";
import type { AwsStatus } from "@/domain/applications/packet";

/**
 * Database side of the Competency Application mutations. Upload stores the
 * workbook bytes (fail-closed storage_objects row) then snapshots one
 * application_controls row per parsed control. Per-control edits roll an
 * accepted_count up onto the parent. The AI write-back lives in generate-actions
 * (outside the gate), like the evidence evaluator.
 */

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "workbook.xlsx";
}

export interface CreateApplicationInput {
  readonly name: string;
  readonly competency: string;
  readonly programType: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly controls: readonly Control[];
}

export async function createApplicationFromUploadOp(
  { identity, tx }: MutationContext,
  input: CreateApplicationInput,
): Promise<{ id: string; controls: number }> {
  const objectKey = `applications/${identity.tenantId}/${randomUUID()}-${sanitize(input.fileName)}`;
  await getObjectStorage().put({
    key: objectKey,
    body: input.bytes,
    contentType: XLSX_CONTENT_TYPE,
  });

  const [obj] = await tx
    .insert(storageObjects)
    .values({
      tenantId: identity.tenantId,
      bucket: env.S3_BUCKET,
      objectKey,
      contentType: XLSX_CONTENT_TYPE,
      sizeBytes: input.bytes.byteLength,
      createdBy: identity.userId,
    })
    .returning({ id: storageObjects.id });

  const [app] = await tx
    .insert(competencyApplications)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      competency: input.competency,
      programType: input.programType,
      sourceStorageObjectId: obj!.id,
      sourceFileName: input.fileName,
      status: "draft",
      controlCount: input.controls.length,
      createdBy: identity.userId,
    })
    .returning({ id: competencyApplications.id });

  let inserted = 0;
  if (input.controls.length > 0) {
    const rows = await tx
      .insert(applicationControls)
      .values(
        input.controls.map((c, i) => ({
          tenantId: identity.tenantId,
          applicationId: app!.id,
          sheetName: c.sheetName,
          controlId: c.id,
          requirementText: c.requirement,
          section: c.section ?? "",
          responseTarget: c.responseTargets as unknown,
          exampleResponse: c.exampleResponse ?? "",
          sequence: i,
        })),
      )
      // Defensive: a malformed workbook could repeat (sheet, control_id); skip dups.
      .onConflictDoNothing({
        target: [
          applicationControls.tenantId,
          applicationControls.applicationId,
          applicationControls.sheetName,
          applicationControls.controlId,
        ],
      })
      .returning({ id: applicationControls.id });
    inserted = rows.length;
    if (inserted !== input.controls.length) {
      await tx
        .update(competencyApplications)
        .set({ controlCount: inserted, updatedAt: sql`now()` })
        .where(
          and(
            eq(competencyApplications.id, app!.id),
            eq(competencyApplications.tenantId, identity.tenantId),
          ),
        );
    }
  }
  return { id: app!.id, controls: inserted };
}

export interface UpdateControlInput {
  readonly controlId: string;
  readonly response?: string;
  readonly met?: MetSuggestion;
  readonly status?: "open" | "generated" | "accepted" | "edited";
}

export async function updateControlOp(
  { identity, tx }: MutationContext,
  input: UpdateControlInput,
): Promise<{ id: string }> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.response !== undefined) set.recommendedResponse = input.response;
  if (input.met !== undefined) set.metSuggestion = input.met;
  if (input.status !== undefined) set.status = input.status;

  const [updated] = await tx
    .update(applicationControls)
    .set(set)
    .where(
      and(
        eq(applicationControls.id, input.controlId),
        eq(applicationControls.tenantId, identity.tenantId),
      ),
    )
    .returning({ applicationId: applicationControls.applicationId });
  if (!updated) throw new ValidationError("Control not found");

  await recomputeAccepted(tx, identity.tenantId, updated.applicationId);
  return { id: input.controlId };
}

/** Roll the count of accepted controls onto the parent + flip draft<->ready. */
async function recomputeAccepted(
  tx: MutationContext["tx"],
  tenantId: string,
  applicationId: string,
): Promise<void> {
  const [acc] = await tx
    .select({ n: count() })
    .from(applicationControls)
    .where(
      and(
        eq(applicationControls.tenantId, tenantId),
        eq(applicationControls.applicationId, applicationId),
        eq(applicationControls.status, "accepted"),
      ),
    );
  const accepted = acc?.n ?? 0;

  const [app] = await tx
    .select({
      controlCount: competencyApplications.controlCount,
      status: competencyApplications.status,
    })
    .from(competencyApplications)
    .where(
      and(
        eq(competencyApplications.id, applicationId),
        eq(competencyApplications.tenantId, tenantId),
      ),
    );
  if (!app) return;

  const set: Record<string, unknown> = { acceptedCount: accepted, updatedAt: sql`now()` };
  if (app.status !== "exported" && app.status !== "generating") {
    set.status = accepted >= app.controlCount && app.controlCount > 0 ? "ready" : "draft";
  }
  await tx
    .update(competencyApplications)
    .set(set)
    .where(
      and(
        eq(competencyApplications.id, applicationId),
        eq(competencyApplications.tenantId, tenantId),
      ),
    );
}

export interface BulkUpdateControlsInput {
  readonly applicationId: string;
  readonly ids: readonly string[];
  readonly status?: "open" | "generated" | "accepted" | "edited";
  readonly met?: MetSuggestion;
}

/** Bulk-apply a status and/or Met? to selected controls of ONE application, then roll up acceptedCount. */
export async function bulkUpdateControlsOp(
  { identity, tx }: MutationContext,
  input: BulkUpdateControlsInput,
): Promise<{ count: number }> {
  if (input.ids.length === 0) throw new ValidationError("No controls selected");
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.status !== undefined) set.status = input.status;
  if (input.met !== undefined) set.metSuggestion = input.met;

  const updated = await tx
    .update(applicationControls)
    .set(set)
    .where(
      and(
        inArray(applicationControls.id, [...input.ids]),
        eq(applicationControls.applicationId, input.applicationId),
        eq(applicationControls.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: applicationControls.id });

  await recomputeAccepted(tx, identity.tenantId, input.applicationId);
  return { count: updated.length };
}

export async function markExportedOp(
  { identity, tx }: MutationContext,
  input: { readonly applicationId: string },
): Promise<{ id: string }> {
  const [u] = await tx
    .update(competencyApplications)
    .set({ status: "exported", exportedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(competencyApplications.id, input.applicationId),
        eq(competencyApplications.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: competencyApplications.id });
  if (!u) throw new ValidationError("Application not found");
  return { id: u.id };
}

export interface UpdateApplicationInput {
  readonly applicationId: string;
  readonly categories?: string;
  readonly pocName?: string;
  readonly pocEmail?: string;
  readonly pocRole?: string;
  readonly awsStatus?: AwsStatus;
  readonly solutionId?: string | null;
  readonly programId?: string | null;
}

/** Update packet metadata (categories, POC) + the AWS application status. */
export async function updateApplicationOp(
  { identity, tx }: MutationContext,
  input: UpdateApplicationInput,
): Promise<{ id: string }> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.categories !== undefined) set.categories = input.categories;
  if (input.pocName !== undefined) set.pocName = input.pocName;
  if (input.pocEmail !== undefined) set.pocEmail = input.pocEmail;
  if (input.pocRole !== undefined) set.pocRole = input.pocRole;
  if (input.awsStatus !== undefined) {
    set.awsStatus = input.awsStatus;
    // Stamp the milestone dates the first time the partner reaches them.
    if (input.awsStatus === "submitted") set.submittedAt = sql`COALESCE(submitted_at, now())`;
    if (input.awsStatus === "confirmed") set.confirmedAt = sql`COALESCE(confirmed_at, now())`;
  }
  if (input.solutionId !== undefined) set.solutionId = input.solutionId;
  if (input.programId !== undefined) set.programId = input.programId;

  const [u] = await tx
    .update(competencyApplications)
    .set(set)
    .where(
      and(
        eq(competencyApplications.id, input.applicationId),
        eq(competencyApplications.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: competencyApplications.id });
  if (!u) throw new ValidationError("Application not found");
  return { id: u.id };
}
