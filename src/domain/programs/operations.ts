import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { programs, programRequirements, users, evidence } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { getLibraryProgram } from "@/domain/programs/library";
import { createSourcedTask } from "@/domain/tasks/operations";
import { createSourcedEvidence } from "@/domain/evidence/operations";
import {
  computeReadinessGate,
  type RequirementState,
} from "@/domain/programs/gate";

/**
 * The database side of the Program Management mutations. Factored out of the
 * actions so the gate drives them in tests. Adopting a library program seeds its
 * requirement checklist; requirements hand off to Tasks and Evidence; submission
 * is a readiness-gated, auditable transition.
 */

type EvidenceType =
  | "case_study"
  | "certification"
  | "architecture"
  | "security"
  | "billing"
  | "reference"
  | "other";

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

/** Adopt a library program into the tenant's portfolio and seed requirements. */
export async function adoptProgramOp(
  { identity, tx }: MutationContext,
  input: { readonly libraryKey: string },
): Promise<{ id: string; requirements: number }> {
  const lib = getLibraryProgram(input.libraryKey);
  if (!lib) throw new ValidationError("Unknown program");

  const inserted = await tx
    .insert(programs)
    .values({
      tenantId: identity.tenantId,
      libraryKey: lib.key,
      name: lib.name,
      programType: lib.programType,
      deliveryModel: lib.deliveryModel,
      fundingFit: lib.fundingFit,
      createdBy: identity.userId,
    })
    .onConflictDoNothing({ target: [programs.tenantId, programs.libraryKey] })
    .returning({ id: programs.id });
  const program = inserted[0];
  if (!program) throw new ValidationError("Program is already in your portfolio");

  await tx.insert(programRequirements).values(
    lib.requirements.map((r) => ({
      tenantId: identity.tenantId,
      programId: program.id,
      requirementKey: r.key,
      label: r.label,
      expectedEvidenceType: r.expectedEvidenceType,
    })),
  );
  return { id: program.id, requirements: lib.requirements.length };
}

export interface UpdateProgramInput {
  readonly programId: string;
  readonly status?: "pending" | "active" | "expired";
  readonly ownerUserId?: string | null;
  readonly targetDate?: string | null;
  readonly expirationDate?: string | null;
  readonly notes?: string;
  /** Server-derived YYYY-MM-DD; stamps achieved_at the first time status -> active. */
  readonly today?: string;
}

export async function updateProgramOp(
  { identity, tx }: MutationContext,
  input: UpdateProgramInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.status !== undefined) set.status = input.status;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.targetDate !== undefined) set.targetDate = input.targetDate;
  if (input.expirationDate !== undefined) set.expirationDate = input.expirationDate;
  if (input.notes !== undefined) set.notes = input.notes;
  // Stamp the achievement date the first time a program goes active. COALESCE keeps
  // the original date through later re-saves / expire->active cycles.
  if (input.status === "active" && input.today) {
    set.achievedAt = sql`coalesce(${programs.achievedAt}, ${input.today})`;
  }

  const updated = await tx
    .update(programs)
    .set(set)
    .where(and(eq(programs.id, input.programId), eq(programs.tenantId, identity.tenantId)))
    .returning({ id: programs.id });
  if (updated.length === 0) throw new ValidationError("Program not found");
  return { id: input.programId };
}

export interface UpdateRequirementInput {
  readonly requirementId: string;
  readonly status?: "open" | "met" | "blocked";
  readonly ownerUserId?: string | null;
  readonly targetDate?: string | null;
}

export async function updateRequirementOp(
  { identity, tx }: MutationContext,
  input: UpdateRequirementInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.status !== undefined) set.status = input.status;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.targetDate !== undefined) set.targetDate = input.targetDate;

  const updated = await tx
    .update(programRequirements)
    .set(set)
    .where(
      and(
        eq(programRequirements.id, input.requirementId),
        eq(programRequirements.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: programRequirements.id });
  if (updated.length === 0) throw new ValidationError("Requirement not found");
  return { id: input.requirementId };
}

/** Load a requirement with its program name; tenant-scoped. */
async function loadRequirement(
  ctx: MutationContext,
  requirementId: string,
): Promise<{
  id: string;
  programId: string;
  label: string;
  expectedEvidenceType: string;
  ownerUserId: string | null;
  programName: string;
}> {
  const [row] = await ctx.tx
    .select({
      id: programRequirements.id,
      programId: programRequirements.programId,
      label: programRequirements.label,
      expectedEvidenceType: programRequirements.expectedEvidenceType,
      ownerUserId: programRequirements.ownerUserId,
      programName: programs.name,
    })
    .from(programRequirements)
    .innerJoin(programs, eq(programs.id, programRequirements.programId))
    .where(
      and(
        eq(programRequirements.id, requirementId),
        eq(programRequirements.tenantId, ctx.identity.tenantId),
      ),
    );
  if (!row) throw new ValidationError("Requirement not found");
  return row;
}

/** Create a Task Manager task for a requirement and link it back. */
export async function createTaskFromRequirementOp(
  ctx: MutationContext,
  input: { readonly requirementId: string },
): Promise<{ taskId: string | null }> {
  const req = await loadRequirement(ctx, input.requirementId);
  const { taskId } = await createSourcedTask(ctx, {
    title: `${req.programName}: ${req.label}`,
    description: `Complete the "${req.label}" requirement for ${req.programName}.`,
    priority: "medium",
    source: "program",
    sourceRef: `${req.programId}:${req.id}`,
    ownerUserId: req.ownerUserId,
  });
  if (taskId) {
    await ctx.tx
      .update(programRequirements)
      .set({ taskId, updatedAt: sql`now()` })
      .where(
        and(
          eq(programRequirements.id, input.requirementId),
          eq(programRequirements.tenantId, ctx.identity.tenantId),
        ),
      );
  }
  return { taskId };
}

/** Stage a 'missing' evidence record for a requirement and link it back. */
export async function stageEvidenceForRequirementOp(
  ctx: MutationContext,
  input: { readonly requirementId: string },
): Promise<{ evidenceId: string | null }> {
  const req = await loadRequirement(ctx, input.requirementId);
  const { evidenceId } = await createSourcedEvidence(ctx, {
    title: `${req.programName}: ${req.label}`,
    evidenceType: req.expectedEvidenceType as EvidenceType,
    program: req.programName,
    notes: "",
    source: "program",
    sourceRef: `${req.programId}:${req.id}`,
  });
  if (evidenceId) {
    await ctx.tx
      .update(programRequirements)
      .set({ evidenceId, updatedAt: sql`now()` })
      .where(
        and(
          eq(programRequirements.id, input.requirementId),
          eq(programRequirements.tenantId, ctx.identity.tenantId),
        ),
      );
  }
  return { evidenceId };
}

interface Candidate {
  readonly id: string;
  readonly evidenceType: string;
  readonly qualityScore: number | null;
  readonly createdAt: Date;
}

/**
 * Accelerator for "Pursue this program": after adoption, attach the tenant's
 * already-approved, unexpired evidence to this program's still-unlinked
 * requirements, matching by evidence type. Best candidate per type wins (highest
 * quality, then newest) and each artifact is used at most once. Idempotent — only
 * touches requirements whose evidenceId is still null, so re-runs are no-ops.
 */
export async function autoLinkEvidenceForProgramOp(
  { identity, tx }: MutationContext,
  input: { readonly programId: string; readonly today: string },
): Promise<{ linked: number }> {
  const tId = identity.tenantId;

  const reqs = await tx
    .select({
      id: programRequirements.id,
      expectedEvidenceType: programRequirements.expectedEvidenceType,
    })
    .from(programRequirements)
    .where(
      and(
        eq(programRequirements.programId, input.programId),
        eq(programRequirements.tenantId, tId),
        isNull(programRequirements.evidenceId),
      ),
    );
  if (reqs.length === 0) return { linked: 0 };

  const candidates: Candidate[] = await tx
    .select({
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      qualityScore: evidence.qualityScore,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(
      and(
        eq(evidence.tenantId, tId),
        eq(evidence.status, "approved"),
        or(isNull(evidence.expirationDate), gte(evidence.expirationDate, input.today)),
      ),
    );

  // Bucket candidates by type, best first (quality desc, then newest).
  const byType = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byType.get(c.evidenceType) ?? [];
    arr.push(c);
    byType.set(c.evidenceType, arr);
  }
  for (const arr of byType.values()) {
    arr.sort(
      (a, b) =>
        (b.qualityScore ?? 0) - (a.qualityScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  const used = new Set<string>();
  let linked = 0;
  for (const r of reqs) {
    const pick = (byType.get(r.expectedEvidenceType) ?? []).find((c) => !used.has(c.id));
    if (!pick) continue;
    used.add(pick.id);
    await tx
      .update(programRequirements)
      .set({ evidenceId: pick.id, updatedAt: sql`now()` })
      .where(
        and(eq(programRequirements.id, r.id), eq(programRequirements.tenantId, tId)),
      );
    linked += 1;
  }
  return { linked };
}

/**
 * Readiness-gated submission. The program must compute to 'ready_for_roadmap'
 * (every requirement met with approved evidence). Status-guarded to run once.
 */
export async function submitProgramOp(
  ctx: MutationContext,
  input: { readonly programId: string; readonly today: string },
): Promise<{ status: "submitted" }> {
  const { identity, tx } = ctx;
  const [program] = await tx
    .select({ status: programs.status, expirationDate: programs.expirationDate })
    .from(programs)
    .where(and(eq(programs.id, input.programId), eq(programs.tenantId, identity.tenantId)));
  if (!program) throw new ValidationError("Program not found");
  if (program.status !== "pending") {
    throw new ValidationError("Program has already been submitted");
  }

  const reqs = await tx
    .select({
      status: programRequirements.status,
      evidenceStatus: evidence.status,
    })
    .from(programRequirements)
    .leftJoin(evidence, eq(evidence.id, programRequirements.evidenceId))
    .where(
      and(
        eq(programRequirements.programId, input.programId),
        eq(programRequirements.tenantId, identity.tenantId),
      ),
    );
  const states: RequirementState[] = reqs.map((r) => ({
    status: r.status,
    evidenceApproved: r.evidenceStatus === "approved",
  }));

  const gate = computeReadinessGate("pending", states, program.expirationDate, input.today);
  if (gate !== "ready_for_roadmap") {
    throw new ValidationError(
      "Program is not submission-ready: every requirement must be met with approved evidence",
    );
  }

  await tx
    .update(programs)
    .set({ status: "submitted", submittedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(programs.id, input.programId),
        eq(programs.tenantId, identity.tenantId),
        eq(programs.status, "pending"),
      ),
    );
  return { status: "submitted" };
}
