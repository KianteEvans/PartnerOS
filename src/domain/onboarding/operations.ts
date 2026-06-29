import { and, eq, sql } from "drizzle-orm";
import { onboarding, tenants } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createAssessmentOp } from "@/domain/assessments/operations";
import { createSourcedTask } from "@/domain/tasks/operations";
import { createComposedRoadmapOp } from "@/domain/roadmaps/operations";
import {
  normalizeObjectives,
  pathToPreset,
  kickoffTasks,
  stageToTier,
  starterRoadmapSelection,
  type OnboardingStepId,
  type PathId,
} from "@/domain/onboarding/catalog";

/**
 * The database side of the onboarding wizard. Each step persists its data and
 * advances `step`; completion is the cross-section handoff — it spawns a starter
 * Readiness Assessment and seeds initial Task Manager tasks, all inside the one
 * gate transaction. Factored out of the actions so the gate drives it in tests.
 */

/** Ensure a tenant has an onboarding record; returns the current step. */
export async function startOnboardingOp({
  identity,
  tx,
}: MutationContext): Promise<{ id: string; step: OnboardingStepId }> {
  await tx
    .insert(onboarding)
    .values({ tenantId: identity.tenantId, createdBy: identity.userId })
    .onConflictDoNothing({ target: onboarding.tenantId });
  const [row] = await tx
    .select({ id: onboarding.id, step: onboarding.step })
    .from(onboarding)
    .where(eq(onboarding.tenantId, identity.tenantId));
  return { id: row!.id, step: row!.step as OnboardingStepId };
}

/** Update a field set on the in-progress record and advance to `nextStep`. */
async function advance(
  { identity, tx }: MutationContext,
  set: Record<string, unknown>,
  nextStep: OnboardingStepId,
): Promise<void> {
  const updated = await tx
    .update(onboarding)
    .set({ ...set, step: nextStep, updatedAt: sql`now()` })
    .where(
      and(
        eq(onboarding.tenantId, identity.tenantId),
        eq(onboarding.status, "in_progress"),
      ),
    )
    .returning({ id: onboarding.id });
  if (updated.length === 0) {
    throw new ValidationError("Onboarding is not in progress");
  }
}

export interface ContextInput {
  readonly companyName: string;
  readonly industry: string;
  readonly partnerType: string;
  readonly awsStage: string;
  readonly teamSize: string;
}

export async function saveContextOp(
  ctx: MutationContext,
  input: ContextInput,
): Promise<void> {
  await advance(
    ctx,
    {
      companyName: input.companyName,
      industry: input.industry,
      partnerType: input.partnerType,
      awsStage: input.awsStage,
      teamSize: input.teamSize,
    },
    "objectives",
  );
}

export async function saveObjectivesOp(
  ctx: MutationContext,
  input: { objectives: readonly string[] },
): Promise<void> {
  await advance(ctx, { objectives: normalizeObjectives(input.objectives) }, "path");
}

export async function choosePathOp(
  ctx: MutationContext,
  input: { path: PathId },
): Promise<void> {
  await advance(ctx, { path: input.path }, "review");
}

/** Back-navigation to an earlier wizard step (never to 'done'). */
export async function setStepOp(
  ctx: MutationContext,
  input: { step: Exclude<OnboardingStepId, "done"> },
): Promise<void> {
  await advance(ctx, {}, input.step);
}

/**
 * Complete onboarding: spawn a starter assessment, seed onboarding tasks, and
 * mark the record done. Status-guarded so it runs exactly once.
 */
export async function completeOnboardingOp(
  ctx: MutationContext,
): Promise<{ assessmentId: string; tasks: number; roadmapId: string | null }> {
  const { identity, tx } = ctx;
  const [row] = await tx
    .select({
      id: onboarding.id,
      status: onboarding.status,
      step: onboarding.step,
      path: onboarding.path,
      companyName: onboarding.companyName,
      objectives: onboarding.objectives,
      awsStage: onboarding.awsStage,
    })
    .from(onboarding)
    .where(eq(onboarding.tenantId, identity.tenantId));
  if (!row) throw new ValidationError("Onboarding has not been started");
  if (row.status !== "in_progress") {
    throw new ValidationError("Onboarding is already complete");
  }
  if (row.step !== "review" || !row.path) {
    throw new ValidationError("Finish the earlier steps first");
  }
  const path = row.path as PathId;
  const objectives = Array.isArray(row.objectives) ? (row.objectives as string[]) : [];

  const { id: assessmentId } = await createAssessmentOp(ctx, {
    name: `${row.companyName ?? "Workspace"} — Initial Readiness`,
    preset: pathToPreset(path),
    targetProgram: null,
  });

  // Kickoff tasks: baseline + path + one per stated objective.
  const seeds = kickoffTasks(path, objectives);
  for (const t of seeds) {
    await createSourcedTask(ctx, {
      title: t.title,
      description: t.description,
      priority: t.priority,
      source: "onboarding",
      sourceRef: `${row.id}:${t.key}`,
    });
  }

  // Starting tier estimate from the self-reported AWS stage — guarded upward-only
  // (only initializes a still-default workspace, never overwrites or downgrades).
  const startTier = stageToTier(row.awsStage);
  if (startTier !== "registered") {
    await tx
      .update(tenants)
      .set({ tier: startTier })
      .where(and(eq(tenants.id, identity.tenantId), eq(tenants.tier, "registered")));
  }

  // Starter roadmap: compose a draft from the path + objectives + stage. Skipped
  // when there's nothing to seed (e.g. Premier with no competency goal).
  const selection = starterRoadmapSelection(path, objectives, row.awsStage);
  let roadmapId: string | null = null;
  if (selection.programKeys.length > 0 || selection.targetTier !== null) {
    const today = new Date().toISOString().slice(0, 10);
    const composed = await createComposedRoadmapOp(ctx, {
      name: `${row.companyName ?? "Workspace"} — Starter Roadmap`,
      objective: "Reach your next AWS tier and earn a foundational Competency",
      horizon: "m6",
      scenario: "standard",
      startDate: today,
      programKeys: selection.programKeys,
      targetTier: selection.targetTier,
      owners: {},
    });
    roadmapId = composed.id;
  }

  const done = await tx
    .update(onboarding)
    .set({
      status: "completed",
      step: "done",
      assessmentId,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(onboarding.id, row.id),
        eq(onboarding.tenantId, identity.tenantId),
        eq(onboarding.status, "in_progress"),
      ),
    )
    .returning({ id: onboarding.id });
  if (done.length === 0) {
    throw new ValidationError("Onboarding is already complete");
  }

  return { assessmentId, tasks: seeds.length, roadmapId };
}
