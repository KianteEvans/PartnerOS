import { and, eq, sql } from "drizzle-orm";
import {
  assessments,
  assessmentModules,
  assessmentResponses,
  assessmentRecommendations,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import {
  CATALOG_VERSION,
  PRESET_MODULES,
  type ModuleId,
  type PresetId,
} from "@/domain/assessments/catalog";
import { scoreAssessment, type ResponseMap } from "@/domain/assessments/scoring";
import { generateRecommendations } from "@/domain/assessments/recommendations";
import { createTaskFromRecommendation } from "@/domain/tasks/operations";
import { createEvidenceFromRecommendation } from "@/domain/evidence/operations";

/**
 * The database side of each assessment mutation, factored out of the server
 * actions so it can run through the gate (runMutation) in BOTH the actions and
 * the integration tests — without the Next.js request plumbing (cookies,
 * revalidatePath, redirect) that the actions own. Every function takes the
 * gate's MutationContext, so it already has the verified identity and the
 * RLS-scoped transaction; it never re-derives identity.
 */

export interface CreateInput {
  readonly name: string;
  readonly preset: PresetId;
  readonly targetProgram: string | null;
}

export async function createAssessmentOp(
  { identity, tx }: MutationContext,
  input: CreateInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(assessments)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      preset: input.preset,
      targetProgram: input.targetProgram,
      catalogVersion: CATALOG_VERSION,
      createdBy: identity.userId,
    })
    .returning({ id: assessments.id });
  const assessmentId = row!.id;
  await tx.insert(assessmentModules).values(
    PRESET_MODULES[input.preset].map((module) => ({
      tenantId: identity.tenantId,
      assessmentId,
      module,
    })),
  );
  return { id: assessmentId };
}

export interface SaveInput {
  readonly assessmentId: string;
  readonly answers: ReadonlyArray<{
    readonly module: ModuleId;
    readonly questionKey: string;
    readonly value: string;
  }>;
}

export async function saveResponsesOp(
  { identity, tx }: MutationContext,
  input: SaveInput,
): Promise<{ id: string; saved: number }> {
  const [current] = await tx
    .select({ status: assessments.status })
    .from(assessments)
    .where(
      and(
        eq(assessments.id, input.assessmentId),
        eq(assessments.tenantId, identity.tenantId),
      ),
    );
  if (!current) throw new ValidationError("Assessment not found");
  if (current.status !== "draft") {
    throw new ValidationError("Assessment has already been submitted");
  }

  for (const a of input.answers) {
    await tx
      .insert(assessmentResponses)
      .values({
        tenantId: identity.tenantId,
        assessmentId: input.assessmentId,
        module: a.module,
        questionKey: a.questionKey,
        value: a.value,
      })
      .onConflictDoUpdate({
        target: [
          assessmentResponses.tenantId,
          assessmentResponses.assessmentId,
          assessmentResponses.questionKey,
        ],
        set: { value: a.value, updatedAt: sql`now()` },
      });
  }
  await tx
    .update(assessments)
    .set({ updatedAt: sql`now()` })
    .where(eq(assessments.id, input.assessmentId));
  return { id: input.assessmentId, saved: input.answers.length };
}

export async function submitAssessmentOp(
  { identity, tx }: MutationContext,
  input: { readonly assessmentId: string },
): Promise<{ id: string; overall: number; recs: number }> {
  const { assessmentId } = input;

  const [meta] = await tx
    .select({
      preset: assessments.preset,
      targetProgram: assessments.targetProgram,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.id, assessmentId),
        eq(assessments.tenantId, identity.tenantId),
      ),
    );
  if (!meta) throw new ValidationError("Assessment not found");

  const scope = await tx
    .select({ module: assessmentModules.module })
    .from(assessmentModules)
    .where(
      and(
        eq(assessmentModules.assessmentId, assessmentId),
        eq(assessmentModules.tenantId, identity.tenantId),
      ),
    );
  const modules = scope.map((s) => s.module as ModuleId);

  const answerRows = await tx
    .select({
      questionKey: assessmentResponses.questionKey,
      value: assessmentResponses.value,
    })
    .from(assessmentResponses)
    .where(
      and(
        eq(assessmentResponses.assessmentId, assessmentId),
        eq(assessmentResponses.tenantId, identity.tenantId),
      ),
    );
  const responses: ResponseMap = new Map(
    answerRows.map((r) => [
      r.questionKey,
      typeof r.value === "string" ? r.value : String(r.value),
    ]),
  );

  const result = scoreAssessment(modules, responses);

  // Status-guarded flip: only a draft becomes scored. Zero rows updated means it
  // was already submitted (a retry under a different key) — bail rather than
  // duplicate modules/recommendations.
  const flipped = await tx
    .update(assessments)
    .set({
      status: "scored",
      overallScore: result.overall,
      submittedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(assessments.id, assessmentId),
        eq(assessments.tenantId, identity.tenantId),
        eq(assessments.status, "draft"),
      ),
    )
    .returning({ id: assessments.id });
  if (flipped.length === 0) {
    throw new ValidationError("Assessment has already been submitted");
  }

  for (const m of result.modules) {
    await tx
      .update(assessmentModules)
      .set({ score: m.score })
      .where(
        and(
          eq(assessmentModules.assessmentId, assessmentId),
          eq(assessmentModules.tenantId, identity.tenantId),
          eq(assessmentModules.module, m.module),
        ),
      );
  }

  const drafts = generateRecommendations(result, {
    preset: meta.preset,
    targetProgram: meta.targetProgram,
  });
  if (drafts.length > 0) {
    await tx.insert(assessmentRecommendations).values(
      drafts.map((d) => ({
        tenantId: identity.tenantId,
        assessmentId,
        type: d.type,
        title: d.title,
        detail: d.detail,
        payload: d.payload,
        confidence: d.confidence,
      })),
    );
  }
  return { id: assessmentId, overall: result.overall, recs: drafts.length };
}

export async function reviewRecommendationOp(
  ctx: MutationContext,
  input: {
    readonly recommendationId: string;
    readonly decision: "approved" | "rejected";
  },
): Promise<{ id: string; taskId: string | null; evidenceId: string | null }> {
  const { identity, tx } = ctx;
  const reviewed = await tx
    .update(assessmentRecommendations)
    .set({
      status: input.decision,
      reviewedBy: identity.userId,
      reviewedAt: sql`now()`,
    })
    .where(
      and(
        eq(assessmentRecommendations.id, input.recommendationId),
        eq(assessmentRecommendations.tenantId, identity.tenantId),
        eq(assessmentRecommendations.status, "pending"),
      ),
    )
    .returning({
      id: assessmentRecommendations.id,
      type: assessmentRecommendations.type,
      title: assessmentRecommendations.title,
      detail: assessmentRecommendations.detail,
      confidence: assessmentRecommendations.confidence,
    });
  const rec = reviewed[0];
  if (!rec) throw new ValidationError("Recommendation already reviewed");

  // Cross-section handoffs on approval: every recommendation becomes an
  // executable task; an evidence-gap also seeds a 'missing' record in the
  // Evidence Locker. Both are linked back via source_ref and idempotent.
  let taskId: string | null = null;
  let evidenceId: string | null = null;
  if (input.decision === "approved") {
    ({ taskId } = await createTaskFromRecommendation(ctx, {
      id: rec.id,
      type: rec.type,
      title: rec.title,
      detail: rec.detail,
      confidence: rec.confidence,
    }));
    if (rec.type === "evidence_gap") {
      ({ evidenceId } = await createEvidenceFromRecommendation(ctx, {
        id: rec.id,
        title: rec.title,
        detail: rec.detail,
      }));
    }
  }
  return { id: input.recommendationId, taskId, evidenceId };
}
