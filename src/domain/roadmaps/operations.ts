import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  roadmaps,
  roadmapMilestones,
  assessmentRecommendations,
  programs,
  tierPlans,
  tenants,
  tasks,
  users,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createSourcedTask } from "@/domain/tasks/operations";
import {
  planRoadmap,
  type HorizonId,
  type ScenarioId,
  type MilestoneSeed,
  type MilestoneDraft,
} from "@/domain/roadmaps/planner";
import { composeMilestones } from "@/domain/roadmaps/compose";
import { milestoneStatusToTask } from "@/domain/roadmaps/status-sync";
import { getLibraryProgram } from "@/domain/programs/library";
import { adoptProgramOp } from "@/domain/programs/operations";
import { createTierPlanOp } from "@/domain/tiers/operations";
import { canAdvance } from "@/domain/tiers/gap";
import type { TierId } from "@/domain/tiers/catalog";

/** Per-milestone composition origin + owner, aligned 1:1 with planned drafts. */
interface MilestoneOrigin {
  readonly kind: string;
  readonly label: string;
  readonly ref: string;
  readonly ownerUserId?: string | null;
}

/**
 * Insert planned milestones, tag each with its origin/owner, then wire the linear
 * dependency chain (each depends on the previous sequence) now that ids exist.
 * Shared by the manual/assessment and composed creation paths.
 */
async function insertMilestones(
  { identity, tx }: MutationContext,
  roadmapId: string,
  drafts: readonly MilestoneDraft[],
  origins: readonly MilestoneOrigin[],
): Promise<void> {
  const inserted = await tx
    .insert(roadmapMilestones)
    .values(
      drafts.map((d, i) => ({
        tenantId: identity.tenantId,
        roadmapId,
        sequence: d.sequence,
        title: d.title,
        detail: d.detail,
        targetDate: d.targetDate,
        originKind: origins[i]!.kind,
        originLabel: origins[i]!.label,
        originRef: origins[i]!.ref,
        ownerUserId: origins[i]!.ownerUserId ?? null,
      })),
    )
    .returning({ id: roadmapMilestones.id, sequence: roadmapMilestones.sequence });

  const idBySeq = new Map(inserted.map((m) => [m.sequence, m.id]));
  for (const d of drafts) {
    if (d.dependsOnSequence !== null) {
      await tx
        .update(roadmapMilestones)
        .set({ dependsOnId: idBySeq.get(d.dependsOnSequence) ?? null })
        .where(
          and(
            eq(roadmapMilestones.roadmapId, roadmapId),
            eq(roadmapMilestones.tenantId, identity.tenantId),
            eq(roadmapMilestones.sequence, d.sequence),
          ),
        );
    }
  }
}

/**
 * The database side of the roadmap mutations, factored out of the actions so the
 * gate drives them in tests. Creation runs the pure planner; an assessment
 * source seeds milestones from that assessment's recommendations. Finalizing is
 * the cross-section handoff: each milestone spawns a task (source='roadmap').
 */

export interface CreateRoadmapInput {
  readonly name: string;
  readonly objective: string;
  readonly horizon: HorizonId;
  readonly scenario: ScenarioId;
  readonly startDate: string;
  readonly sourceAssessmentId: string | null;
}

export async function createRoadmapOp(
  { identity, tx }: MutationContext,
  input: CreateRoadmapInput,
): Promise<{ id: string; milestones: number }> {
  let seeds: MilestoneSeed[] = [];
  let source: "manual" | "assessment" = "manual";
  let sourceRef: string | null = null;

  if (input.sourceAssessmentId) {
    const recs = await tx
      .select({
        title: assessmentRecommendations.title,
        detail: assessmentRecommendations.detail,
      })
      .from(assessmentRecommendations)
      .where(
        and(
          eq(assessmentRecommendations.assessmentId, input.sourceAssessmentId),
          eq(assessmentRecommendations.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(assessmentRecommendations.createdAt));
    if (recs.length === 0) {
      // Either the assessment doesn't exist for this tenant, or it has no
      // recommendations yet (not scored). Either way there's nothing to seed.
      throw new ValidationError(
        "That assessment has no recommendations to build from yet",
      );
    }
    seeds = recs.map((r) => ({ title: r.title, detail: r.detail }));
    source = "assessment";
    sourceRef = input.sourceAssessmentId;
  }

  const [roadmap] = await tx
    .insert(roadmaps)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      objective: input.objective,
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      source,
      sourceRef,
      createdBy: identity.userId,
    })
    .returning({ id: roadmaps.id });
  const roadmapId = roadmap!.id;

  const drafts = planRoadmap(
    {
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      objective: input.objective,
    },
    seeds,
  );

  const originKind = source === "assessment" ? "assessment" : "custom";
  await insertMilestones(
    { identity, tx },
    roadmapId,
    drafts,
    drafts.map(() => ({ kind: originKind, label: "", ref: "" })),
  );

  return { id: roadmapId, milestones: drafts.length };
}

export interface CreateComposedRoadmapInput {
  readonly name: string;
  readonly objective: string;
  readonly horizon: HorizonId;
  readonly scenario: ScenarioId;
  readonly startDate: string;
  readonly programKeys: readonly string[];
  readonly targetTier: TierId | null;
  /** composed-milestone key -> owner userId, assigned in the builder. */
  readonly owners: Readonly<Record<string, string>>;
}

/**
 * Compose a roadmap from selected AWS programs + a target tier. The pure
 * `composeMilestones` produces the (ordered, origin-tagged) seeds; the planner
 * spreads them across the horizon; owners assigned in the builder are validated
 * to be members of this tenant and attached at insert time.
 */
export async function createComposedRoadmapOp(
  { identity, tx }: MutationContext,
  input: CreateComposedRoadmapInput,
): Promise<{ id: string; milestones: number }> {
  const composed = composeMilestones({
    programKeys: input.programKeys,
    targetTier: input.targetTier,
  });
  if (composed.length === 0) {
    throw new ValidationError("Select at least one program or a target tier");
  }

  const ownerIds = [...new Set(Object.values(input.owners))].filter(
    (v) => v.length > 0,
  );
  if (ownerIds.length > 0) {
    const members = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.tenantId, identity.tenantId), inArray(users.id, ownerIds)),
      );
    const known = new Set(members.map((m) => m.id));
    for (const id of ownerIds) {
      if (!known.has(id)) {
        throw new ValidationError("Owner is not a member of this workspace");
      }
    }
  }

  const [roadmap] = await tx
    .insert(roadmaps)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      objective: input.objective,
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      source: "composed",
      createdBy: identity.userId,
    })
    .returning({ id: roadmaps.id });
  const roadmapId = roadmap!.id;

  const drafts = planRoadmap(
    {
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      objective: input.objective,
    },
    composed.map((c) => ({ title: c.title, detail: c.detail })),
  );

  const origins: MilestoneOrigin[] = composed.map((c) => {
    const owner = input.owners[c.key];
    return {
      kind: c.originKind,
      label: c.originLabel,
      ref: c.originRef,
      ownerUserId: owner && owner.length > 0 ? owner : null,
    };
  });
  await insertMilestones({ identity, tx }, roadmapId, drafts, origins);

  return { id: roadmapId, milestones: drafts.length };
}

/**
 * Grow a draft roadmap: compose the new selection, drop anything already on the
 * plan (matched by origin_ref), and append the rest after the last milestone —
 * dates spread across the roadmap's horizon, the linear chain continued from the
 * current tail. Idempotent: re-adding the same programs/tier adds nothing.
 */
export async function recomposeRoadmapOp(
  { identity, tx }: MutationContext,
  input: {
    readonly roadmapId: string;
    readonly programKeys: readonly string[];
    readonly targetTier: TierId | null;
  },
): Promise<{ added: number }> {
  await assertDraftRoadmap(tx, identity.tenantId, input.roadmapId);

  const composed = composeMilestones({
    programKeys: input.programKeys,
    targetTier: input.targetTier,
  });
  if (composed.length === 0) return { added: 0 };

  const existing = await tx
    .select({
      id: roadmapMilestones.id,
      sequence: roadmapMilestones.sequence,
      originRef: roadmapMilestones.originRef,
    })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));
  const present = new Set(existing.map((e) => e.originRef).filter((r) => r !== ""));
  const fresh = composed.filter((c) => !present.has(c.originRef));
  if (fresh.length === 0) return { added: 0 };

  const [rm] = await tx
    .select({
      horizon: roadmaps.horizon,
      scenario: roadmaps.scenario,
      startDate: roadmaps.startDate,
      objective: roadmaps.objective,
    })
    .from(roadmaps)
    .where(
      and(eq(roadmaps.id, input.roadmapId), eq(roadmaps.tenantId, identity.tenantId)),
    );
  const drafts = planRoadmap(
    {
      horizon: rm!.horizon,
      scenario: rm!.scenario,
      startDate: rm!.startDate,
      objective: rm!.objective,
    },
    fresh.map((c) => ({ title: c.title, detail: c.detail })),
  );

  const lastSeq = existing.at(-1)?.sequence ?? 0;
  const lastId = existing.at(-1)?.id ?? null;
  const inserted = await tx
    .insert(roadmapMilestones)
    .values(
      drafts.map((d, i) => ({
        tenantId: identity.tenantId,
        roadmapId: input.roadmapId,
        sequence: lastSeq + d.sequence,
        title: d.title,
        detail: d.detail,
        targetDate: d.targetDate,
        originKind: fresh[i]!.originKind,
        originLabel: fresh[i]!.originLabel,
        originRef: fresh[i]!.originRef,
      })),
    )
    .returning({ id: roadmapMilestones.id, sequence: roadmapMilestones.sequence });

  const idBySeq = new Map(inserted.map((m) => [m.sequence, m.id]));
  for (let i = 0; i < drafts.length; i++) {
    const myId = idBySeq.get(lastSeq + drafts[i]!.sequence);
    const prevId =
      i === 0 ? lastId : idBySeq.get(lastSeq + drafts[i - 1]!.sequence) ?? null;
    if (myId && prevId) {
      await tx
        .update(roadmapMilestones)
        .set({ dependsOnId: prevId, updatedAt: sql`now()` })
        .where(
          and(
            eq(roadmapMilestones.id, myId),
            eq(roadmapMilestones.tenantId, identity.tenantId),
          ),
        );
    }
  }
  return { added: fresh.length };
}

/**
 * Duplicate a roadmap as a fresh draft "template": copy its config + every
 * milestone (titles/dates/owners/origin), reset progress (status -> planned, no
 * tasks), and re-map the dependency chain onto the new milestone ids.
 */
export async function duplicateRoadmapOp(
  { identity, tx }: MutationContext,
  input: { readonly roadmapId: string },
): Promise<{ id: string; milestones: number }> {
  const [src] = await tx
    .select()
    .from(roadmaps)
    .where(
      and(eq(roadmaps.id, input.roadmapId), eq(roadmaps.tenantId, identity.tenantId)),
    );
  if (!src) throw new ValidationError("Roadmap not found");

  const [copy] = await tx
    .insert(roadmaps)
    .values({
      tenantId: identity.tenantId,
      name: `${src.name} (copy)`.slice(0, 200),
      objective: src.objective,
      horizon: src.horizon,
      scenario: src.scenario,
      startDate: src.startDate,
      source: src.source,
      createdBy: identity.userId,
    })
    .returning({ id: roadmaps.id });
  const newId = copy!.id;

  const srcMs = await tx
    .select()
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));
  if (srcMs.length === 0) return { id: newId, milestones: 0 };

  const inserted = await tx
    .insert(roadmapMilestones)
    .values(
      srcMs.map((m) => ({
        tenantId: identity.tenantId,
        roadmapId: newId,
        sequence: m.sequence,
        title: m.title,
        detail: m.detail,
        targetDate: m.targetDate,
        ownerUserId: m.ownerUserId,
        originKind: m.originKind,
        originLabel: m.originLabel,
        originRef: m.originRef,
      })),
    )
    .returning({ id: roadmapMilestones.id, sequence: roadmapMilestones.sequence });

  const oldIdToSeq = new Map(srcMs.map((m) => [m.id, m.sequence]));
  const seqToNewId = new Map(inserted.map((m) => [m.sequence, m.id]));
  for (const m of srcMs) {
    if (m.dependsOnId === null) continue;
    const depSeq = oldIdToSeq.get(m.dependsOnId);
    const newDep = depSeq === undefined ? undefined : seqToNewId.get(depSeq);
    if (newDep) {
      await tx
        .update(roadmapMilestones)
        .set({ dependsOnId: newDep })
        .where(
          and(
            eq(roadmapMilestones.roadmapId, newId),
            eq(roadmapMilestones.tenantId, identity.tenantId),
            eq(roadmapMilestones.sequence, m.sequence),
          ),
        );
    }
  }
  return { id: newId, milestones: srcMs.length };
}

/**
 * Re-open a finalized roadmap back to draft so structure can change again. The
 * already-spawned tasks stay linked; re-finalizing is idempotent (sourceRef
 * conflict), so it won't duplicate them. Status-guarded to finalized only.
 */
export async function reopenRoadmapOp(
  { identity, tx }: MutationContext,
  input: { readonly roadmapId: string },
): Promise<{ id: string }> {
  const reopened = await tx
    .update(roadmaps)
    .set({ status: "draft", finalizedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(roadmaps.id, input.roadmapId),
        eq(roadmaps.tenantId, identity.tenantId),
        eq(roadmaps.status, "finalized"),
      ),
    )
    .returning({ id: roadmaps.id });
  if (reopened.length === 0) {
    throw new ValidationError("Roadmap not found or not finalized");
  }
  return { id: input.roadmapId };
}

/**
 * Re-plan a draft: change horizon/scenario/start and re-spread every milestone's
 * target date with the pure planner (order + content unchanged). Draft-only.
 */
export async function replanRoadmapOp(
  { identity, tx }: MutationContext,
  input: {
    readonly roadmapId: string;
    readonly horizon: HorizonId;
    readonly scenario: ScenarioId;
    readonly startDate: string;
  },
): Promise<{ milestones: number }> {
  await assertDraftRoadmap(tx, identity.tenantId, input.roadmapId);
  const [rm] = await tx
    .select({ objective: roadmaps.objective })
    .from(roadmaps)
    .where(
      and(eq(roadmaps.id, input.roadmapId), eq(roadmaps.tenantId, identity.tenantId)),
    );
  const ms = await tx
    .select({
      id: roadmapMilestones.id,
      title: roadmapMilestones.title,
      detail: roadmapMilestones.detail,
    })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));

  await tx
    .update(roadmaps)
    .set({
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(roadmaps.id, input.roadmapId), eq(roadmaps.tenantId, identity.tenantId)),
    );

  if (ms.length === 0) return { milestones: 0 };
  const drafts = planRoadmap(
    {
      horizon: input.horizon,
      scenario: input.scenario,
      startDate: input.startDate,
      objective: rm?.objective ?? "",
    },
    ms.map((m) => ({ title: m.title, detail: m.detail })),
  );
  for (let i = 0; i < ms.length; i++) {
    await tx
      .update(roadmapMilestones)
      .set({ targetDate: drafts[i]!.targetDate, updatedAt: sql`now()` })
      .where(
        and(
          eq(roadmapMilestones.id, ms[i]!.id),
          eq(roadmapMilestones.tenantId, identity.tenantId),
        ),
      );
  }
  return { milestones: ms.length };
}

export interface UpdateMilestoneInput {
  readonly milestoneId: string;
  readonly ownerUserId?: string | null;
  readonly targetDate?: string;
  readonly title?: string;
  readonly detail?: string;
}

export async function updateMilestoneOp(
  { identity, tx }: MutationContext,
  input: UpdateMilestoneInput,
): Promise<{ id: string }> {
  // The milestone's roadmap must still be a draft.
  const [row] = await tx
    .select({ status: roadmaps.status })
    .from(roadmapMilestones)
    .innerJoin(roadmaps, eq(roadmaps.id, roadmapMilestones.roadmapId))
    .where(
      and(
        eq(roadmapMilestones.id, input.milestoneId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  if (!row) throw new ValidationError("Milestone not found");
  if (row.status !== "draft") {
    throw new ValidationError("Roadmap is finalized and can no longer change");
  }

  if (input.ownerUserId) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, input.ownerUserId), eq(users.tenantId, identity.tenantId)),
      );
    if (!owner) throw new ValidationError("Owner is not a member of this workspace");
  }

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.targetDate !== undefined) set.targetDate = input.targetDate;
  if (input.title !== undefined) set.title = input.title;
  if (input.detail !== undefined) set.detail = input.detail;

  await tx
    .update(roadmapMilestones)
    .set(set)
    .where(
      and(
        eq(roadmapMilestones.id, input.milestoneId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  return { id: input.milestoneId };
}

// ----- increment 2: living-plan editing -----

type MilestoneStatusValue = "planned" | "in_progress" | "done" | "blocked";

/** Structural edits (reorder/add/remove) require the roadmap to still be a draft. */
async function assertDraftRoadmap(
  tx: MutationContext["tx"],
  tenantId: string,
  roadmapId: string,
): Promise<void> {
  const [r] = await tx
    .select({ status: roadmaps.status })
    .from(roadmaps)
    .where(and(eq(roadmaps.id, roadmapId), eq(roadmaps.tenantId, tenantId)));
  if (!r) throw new ValidationError("Roadmap not found");
  if (r.status !== "draft") {
    throw new ValidationError("Roadmap is finalized and can no longer change");
  }
}

/**
 * Set a milestone's progress status. Allowed in ANY roadmap state — status is
 * progress tracking, not structure, so a finalized roadmap stays a living plan.
 */
export async function setMilestoneStatusOp(
  { identity, tx }: MutationContext,
  input: { readonly milestoneId: string; readonly status: MilestoneStatusValue },
): Promise<{ id: string }> {
  const updated = await tx
    .update(roadmapMilestones)
    .set({ status: input.status, updatedAt: sql`now()` })
    .where(
      and(
        eq(roadmapMilestones.id, input.milestoneId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: roadmapMilestones.id, taskId: roadmapMilestones.taskId });
  if (updated.length === 0) throw new ValidationError("Milestone not found");

  // Close the loop the other way: a finalized milestone's task mirrors the
  // milestone status (direct write — no task op called, so no feedback cycle).
  const taskId = updated[0]!.taskId;
  if (taskId) {
    const taskStatus = milestoneStatusToTask(input.status);
    await tx
      .update(tasks)
      .set({
        status: taskStatus,
        completedAt: taskStatus === "done" ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, identity.tenantId)));
  }
  return { id: input.milestoneId };
}

/**
 * Re-sequence a draft roadmap's milestones to the given order and re-wire the
 * linear dependency chain. `orderedIds` must be a permutation of the roadmap's
 * milestones. Sequences are bumped out of the way first so the unique
 * (roadmap, sequence) index is never violated mid-reshuffle.
 */
export async function reorderMilestonesOp(
  { identity, tx }: MutationContext,
  input: { readonly roadmapId: string; readonly orderedIds: readonly string[] },
): Promise<{ count: number }> {
  await assertDraftRoadmap(tx, identity.tenantId, input.roadmapId);

  const rows = await tx
    .select({ id: roadmapMilestones.id })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  const existing = new Set(rows.map((r) => r.id));
  const unique = new Set(input.orderedIds);
  if (
    input.orderedIds.length !== existing.size ||
    unique.size !== input.orderedIds.length ||
    !input.orderedIds.every((id) => existing.has(id))
  ) {
    throw new ValidationError("Reorder must list each milestone exactly once");
  }

  await tx
    .update(roadmapMilestones)
    .set({ sequence: sql`${roadmapMilestones.sequence} + 10000` })
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  for (let i = 0; i < input.orderedIds.length; i++) {
    await tx
      .update(roadmapMilestones)
      .set({
        sequence: i + 1,
        dependsOnId: i === 0 ? null : input.orderedIds[i - 1]!,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(roadmapMilestones.id, input.orderedIds[i]!),
          eq(roadmapMilestones.tenantId, identity.tenantId),
        ),
      );
  }
  return { count: input.orderedIds.length };
}

/** Append a custom milestone to a draft roadmap (depends on the current last). */
export async function addMilestoneOp(
  { identity, tx }: MutationContext,
  input: {
    readonly roadmapId: string;
    readonly title: string;
    readonly detail: string;
    readonly targetDate: string;
    readonly ownerUserId: string | null;
  },
): Promise<{ id: string }> {
  await assertDraftRoadmap(tx, identity.tenantId, input.roadmapId);
  if (input.ownerUserId) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, input.ownerUserId), eq(users.tenantId, identity.tenantId)),
      );
    if (!owner) throw new ValidationError("Owner is not a member of this workspace");
  }

  const rows = await tx
    .select({ id: roadmapMilestones.id, sequence: roadmapMilestones.sequence })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, input.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));
  const last = rows.at(-1);

  const [inserted] = await tx
    .insert(roadmapMilestones)
    .values({
      tenantId: identity.tenantId,
      roadmapId: input.roadmapId,
      sequence: (last?.sequence ?? 0) + 1,
      title: input.title,
      detail: input.detail,
      targetDate: input.targetDate,
      ownerUserId: input.ownerUserId,
      dependsOnId: last?.id ?? null,
    })
    .returning({ id: roadmapMilestones.id });
  return { id: inserted!.id };
}

/**
 * Remove a milestone from a draft roadmap, then recompact sequences and re-wire
 * the linear chain over the survivors. A roadmap must keep at least one.
 */
export async function removeMilestoneOp(
  { identity, tx }: MutationContext,
  input: { readonly milestoneId: string },
): Promise<{ id: string }> {
  const [m] = await tx
    .select({ roadmapId: roadmapMilestones.roadmapId })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.id, input.milestoneId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  if (!m) throw new ValidationError("Milestone not found");
  await assertDraftRoadmap(tx, identity.tenantId, m.roadmapId);

  const ordered = await tx
    .select({ id: roadmapMilestones.id })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, m.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));
  if (ordered.length <= 1) {
    throw new ValidationError("A roadmap needs at least one milestone");
  }

  await tx
    .delete(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.id, input.milestoneId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );

  const rest = ordered.map((r) => r.id).filter((id) => id !== input.milestoneId);
  await tx
    .update(roadmapMilestones)
    .set({ sequence: sql`${roadmapMilestones.sequence} + 10000` })
    .where(
      and(
        eq(roadmapMilestones.roadmapId, m.roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
  for (let i = 0; i < rest.length; i++) {
    await tx
      .update(roadmapMilestones)
      .set({
        sequence: i + 1,
        dependsOnId: i === 0 ? null : rest[i - 1]!,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(roadmapMilestones.id, rest[i]!),
          eq(roadmapMilestones.tenantId, identity.tenantId),
        ),
      );
  }
  return { id: input.milestoneId };
}

/**
 * Finalize a draft roadmap: spawn a task per milestone (source-linked and
 * idempotent), link each milestone to its task, and lock the roadmap.
 * Status-guarded so it runs exactly once.
 */
export async function finalizeRoadmapOp(
  ctx: MutationContext,
  input: { readonly roadmapId: string },
): Promise<{ tasks: number; programsAdopted: number; tierPlanCreated: boolean }> {
  const { identity, tx } = ctx;
  const { roadmapId } = input;

  const locked = await tx
    .update(roadmaps)
    .set({ status: "finalized", finalizedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(roadmaps.id, roadmapId),
        eq(roadmaps.tenantId, identity.tenantId),
        eq(roadmaps.status, "draft"),
      ),
    )
    .returning({ id: roadmaps.id });
  if (locked.length === 0) {
    throw new ValidationError("Roadmap not found or already finalized");
  }

  const milestones = await tx
    .select()
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, roadmapId),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(roadmapMilestones.sequence));

  let count = 0;
  for (const m of milestones) {
    const { taskId } = await createSourcedTask(ctx, {
      title: m.title,
      description: m.detail
        ? `${m.detail} (target ${m.targetDate})`
        : `Target ${m.targetDate}`,
      priority: "medium",
      source: "roadmap",
      sourceRef: `${roadmapId}:${m.id}`,
      ownerUserId: m.ownerUserId,
    });
    if (taskId) {
      await tx
        .update(roadmapMilestones)
        .set({ taskId, updatedAt: sql`now()` })
        .where(
          and(
            eq(roadmapMilestones.id, m.id),
            eq(roadmapMilestones.tenantId, identity.tenantId),
          ),
        );
      count += 1;
    }
  }

  // Composed roadmaps: turn the plan into action. Adopt the selected programs and
  // open the tier plan they advance -- idempotent, skipping whatever already
  // exists (a program already in the portfolio, an existing tier plan, or a tier
  // that is not above the current one), so finalize never fails on prior state.
  let programsAdopted = 0;
  const programKeys = [
    ...new Set(
      milestones
        .filter((m) => m.originKind === "program" && m.originRef !== "")
        .map((m) => m.originRef),
    ),
  ];
  for (const key of programKeys) {
    if (!getLibraryProgram(key)) continue;
    const [existing] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(eq(programs.tenantId, identity.tenantId), eq(programs.libraryKey, key)),
      );
    if (!existing) {
      await adoptProgramOp(ctx, { libraryKey: key });
      programsAdopted += 1;
    }
  }

  let tierPlanCreated = false;
  const tierRef = milestones.find(
    (m) => m.originKind === "tier" && m.originRef !== "",
  )?.originRef;
  const targetTier = tierRef ? (tierRef.split(":")[0] as TierId) : null;
  if (targetTier) {
    const [existingPlan] = await tx
      .select({ id: tierPlans.id })
      .from(tierPlans)
      .where(eq(tierPlans.tenantId, identity.tenantId));
    if (!existingPlan) {
      const [tenantRow] = await tx
        .select({ tier: tenants.tier })
        .from(tenants)
        .where(eq(tenants.id, identity.tenantId));
      const current = (tenantRow?.tier ?? "registered") as TierId;
      if (canAdvance(current, targetTier)) {
        await createTierPlanOp(ctx, { targetTier });
        tierPlanCreated = true;
      }
    }
  }

  return { tasks: count, programsAdopted, tierPlanCreated };
}
