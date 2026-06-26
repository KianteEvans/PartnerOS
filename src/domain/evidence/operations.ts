import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { evidence, storageObjects, users } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { getObjectStorage } from "@/storage/s3";
import { env } from "@/env";

/**
 * The database side of the Evidence Locker mutations. Factored out of the
 * actions so the gate drives them in tests. File upload goes through the
 * foundation's object storage and records a 'pending' storage_objects row — the
 * file stays fail-closed (undownloadable) until the malware-scan webhook flips
 * it to 'clean' (storage/malware-scan.ts).
 */

type EvidenceType =
  | "case_study"
  | "certification"
  | "architecture"
  | "security"
  | "billing"
  | "reference"
  | "other";
type OpenStatus = "missing" | "collected" | "in_review";

async function assertOwnerInTenant(
  tx: MutationContext["tx"],
  tenantId: string,
  ownerUserId: string,
): Promise<void> {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.tenantId, tenantId)));
  if (!owner) throw new ValidationError("Owner is not a member of this workspace");
}

export interface CreateEvidenceInput {
  readonly title: string;
  readonly evidenceType: EvidenceType;
  readonly program: string | null;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
  readonly expirationDate: string | null;
  readonly reusable: boolean;
}

export async function createEvidenceOp(
  { identity, tx }: MutationContext,
  input: CreateEvidenceInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const [row] = await tx
    .insert(evidence)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      evidenceType: input.evidenceType,
      program: input.program,
      ownerUserId: input.ownerUserId,
      dueDate: input.dueDate,
      expirationDate: input.expirationDate,
      reusable: input.reusable,
      createdBy: identity.userId,
    })
    .returning({ id: evidence.id });
  return { id: row!.id };
}

export interface UpdateEvidenceInput {
  readonly evidenceId: string;
  readonly title?: string;
  readonly evidenceType?: EvidenceType;
  readonly program?: string | null;
  readonly ownerUserId?: string | null;
  readonly dueDate?: string | null;
  readonly expirationDate?: string | null;
  readonly reusable?: boolean;
  readonly status?: OpenStatus;
}

export async function updateEvidenceOp(
  { identity, tx }: MutationContext,
  input: UpdateEvidenceInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.evidenceType !== undefined) set.evidenceType = input.evidenceType;
  if (input.program !== undefined) set.program = input.program;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.expirationDate !== undefined) set.expirationDate = input.expirationDate;
  if (input.reusable !== undefined) set.reusable = input.reusable;
  if (input.status !== undefined) set.status = input.status;

  const updated = await tx
    .update(evidence)
    .set(set)
    .where(
      and(eq(evidence.id, input.evidenceId), eq(evidence.tenantId, identity.tenantId)),
    )
    .returning({ id: evidence.id });
  if (updated.length === 0) throw new ValidationError("Evidence not found");
  return { id: input.evidenceId };
}

export interface BulkUpdateEvidenceInput {
  readonly ids: readonly string[];
  /** undefined = leave; null = unassign; string = assign. */
  readonly ownerUserId?: string | null;
  readonly status?: OpenStatus;
}

/**
 * Apply owner/status to many evidence records in one RLS-scoped UPDATE. Review
 * outcomes (approved/rejected) deliberately aren't bulk-settable — those run
 * through reviewEvidenceOp with their quality score + notes.
 */
export async function bulkUpdateEvidenceOp(
  { identity, tx }: MutationContext,
  input: BulkUpdateEvidenceInput,
): Promise<{ count: number }> {
  if (input.ids.length === 0) throw new ValidationError("No rows selected");
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.status !== undefined) set.status = input.status;

  const updated = await tx
    .update(evidence)
    .set(set)
    .where(and(inArray(evidence.id, [...input.ids]), eq(evidence.tenantId, identity.tenantId)))
    .returning({ id: evidence.id });
  return { count: updated.length };
}

export async function reviewEvidenceOp(
  { identity, tx }: MutationContext,
  input: {
    readonly evidenceId: string;
    readonly decision: "approved" | "rejected";
    readonly qualityScore: number | null;
    readonly notes: string;
  },
): Promise<{ id: string }> {
  const updated = await tx
    .update(evidence)
    .set({
      status: input.decision,
      qualityScore: input.qualityScore,
      reviewNotes: input.notes,
      reviewedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(evidence.id, input.evidenceId), eq(evidence.tenantId, identity.tenantId)),
    )
    .returning({ id: evidence.id });
  if (updated.length === 0) throw new ValidationError("Evidence not found");
  return { id: input.evidenceId };
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/**
 * Upload a file for an evidence record: store the bytes, record a 'pending'
 * storage_objects row (fail-closed until scanned), and link it to the evidence.
 * The storage write happens before the DB rows so a storage failure aborts the
 * mutation cleanly.
 */
export async function uploadEvidenceFileOp(
  { identity, tx }: MutationContext,
  input: {
    readonly evidenceId: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  },
): Promise<{ storageObjectId: string }> {
  const [exists] = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(eq(evidence.id, input.evidenceId), eq(evidence.tenantId, identity.tenantId)),
    );
  if (!exists) throw new ValidationError("Evidence not found");

  const objectKey = `evidence/${identity.tenantId}/${input.evidenceId}/${randomUUID()}-${sanitize(input.fileName)}`;
  await getObjectStorage().put({
    key: objectKey,
    body: input.bytes,
    contentType: input.contentType,
  });

  const [obj] = await tx
    .insert(storageObjects)
    .values({
      tenantId: identity.tenantId,
      bucket: env.S3_BUCKET,
      objectKey,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      createdBy: identity.userId,
    })
    .returning({ id: storageObjects.id });

  await tx
    .update(evidence)
    .set({
      storageObjectId: obj!.id,
      fileName: input.fileName,
      status: "in_review",
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(evidence.id, input.evidenceId), eq(evidence.tenantId, identity.tenantId)),
    );

  return { storageObjectId: obj!.id };
}

type EvidenceSource = "manual" | "assessment" | "program" | "tier" | "mdf";

export interface SourcedEvidenceInput {
  readonly title: string;
  readonly evidenceType: EvidenceType;
  readonly program: string | null;
  readonly notes: string;
  readonly source: EvidenceSource;
  /** Stable id of the originating object; powers idempotent handoffs. */
  readonly sourceRef: string;
}

/**
 * Seed a 'missing' evidence record from another section. Idempotent via the
 * partial unique (tenant, source, source_ref). Returns the new evidence id, or
 * null if one already existed.
 */
export async function createSourcedEvidence(
  { identity, tx }: MutationContext,
  input: SourcedEvidenceInput,
): Promise<{ evidenceId: string | null }> {
  const [row] = await tx
    .insert(evidence)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      evidenceType: input.evidenceType,
      status: "missing",
      program: input.program,
      reviewNotes: input.notes,
      source: input.source,
      sourceRef: input.sourceRef,
      createdBy: identity.userId,
    })
    .onConflictDoNothing({
      target: [evidence.tenantId, evidence.source, evidence.sourceRef],
      where: sql`source_ref IS NOT NULL`,
    })
    .returning({ id: evidence.id });
  return { evidenceId: row?.id ?? null };
}

export interface EvidenceFromRecommendation {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/** Seed a 'missing' evidence record from an approved assessment evidence-gap. */
export async function createEvidenceFromRecommendation(
  ctx: MutationContext,
  rec: EvidenceFromRecommendation,
): Promise<{ evidenceId: string | null }> {
  return createSourcedEvidence(ctx, {
    title: rec.title,
    evidenceType: "other",
    program: null,
    notes: rec.detail,
    source: "assessment",
    sourceRef: rec.id,
  });
}
