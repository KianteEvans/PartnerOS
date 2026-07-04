import { and, asc, eq, sql } from "drizzle-orm";
import { tierPlans, tierRequirements, tenants, users } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createSourcedTask } from "@/domain/tasks/operations";
import { createSourcedEvidence } from "@/domain/evidence/operations";
import {
  thresholdsForTier,
  CATALOG_VERSION,
  type TierId,
  type RequirementKind,
} from "@/domain/tiers/catalog";
import { canAdvance, isAchievable, type RequirementValue } from "@/domain/tiers/gap";
import { deriveByKey } from "@/domain/tiers/measure";
import { gatherTierMeasurements } from "@/domain/tiers/load";

/**
 * The database side of Partner Tier Management. Factored out of the actions so
 * the gate drives them in tests. Creating a plan snapshots the tenant's current
 * tier and seeds requirement rows; requirements hand off to Tasks and Evidence;
 * an approved advancement updates tenants.tier.
 */

type EvidenceType =
  | "case_study"
  | "certification"
  | "architecture"
  | "security"
  | "billing"
  | "reference"
  | "other";

const CATEGORY_EVIDENCE: Record<string, EvidenceType> = {
  opportunities: "reference",
  certifications: "certification",
  references: "case_study",
  validations: "architecture",
  competencies: "reference",
};

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

export async function createTierPlanOp(
  { identity, tx }: MutationContext,
  input: { readonly targetTier: TierId },
): Promise<{ id: string; requirements: number }> {
  const [tenant] = await tx
    .select({ tier: tenants.tier })
    .from(tenants)
    .where(eq(tenants.id, identity.tenantId));
  const currentTier = (tenant?.tier ?? "registered") as TierId;

  if (!canAdvance(currentTier, input.targetTier)) {
    throw new ValidationError("Target tier must be above the current tier");
  }

  const inserted = await tx
    .insert(tierPlans)
    .values({
      tenantId: identity.tenantId,
      currentTier,
      targetTier: input.targetTier,
      catalogVersion: CATALOG_VERSION,
      createdBy: identity.userId,
    })
    .onConflictDoNothing({ target: tierPlans.tenantId })
    .returning({ id: tierPlans.id });
  const plan = inserted[0];
  if (!plan) {
    throw new ValidationError("A tier plan already exists for this workspace");
  }

  const thresholds = thresholdsForTier(input.targetTier);
  await tx.insert(tierRequirements).values(
    thresholds.map((t) => ({
      tenantId: identity.tenantId,
      planId: plan.id,
      requirementKey: t.key,
      label: t.label,
      category: t.category,
      unit: t.unit,
      threshold: t.threshold,
      kind: t.kind ?? "count",
      secondaryLabel: t.secondary?.label ?? null,
      secondaryUnit: t.secondary?.unit ?? null,
      secondaryThreshold: t.secondary?.threshold ?? null,
      note: t.note ?? "",
      informational: t.informational ?? false,
    })),
  );
  return { id: plan.id, requirements: thresholds.length };
}

export async function updatePlanOp(
  { identity, tx }: MutationContext,
  input: {
    readonly planId: string;
    readonly ownerUserId?: string | null;
    readonly targetDate?: string | null;
    readonly notes?: string;
  },
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.targetDate !== undefined) set.targetDate = input.targetDate;
  if (input.notes !== undefined) set.notes = input.notes;

  const updated = await tx
    .update(tierPlans)
    .set(set)
    .where(and(eq(tierPlans.id, input.planId), eq(tierPlans.tenantId, identity.tenantId)))
    .returning({ id: tierPlans.id });
  if (updated.length === 0) throw new ValidationError("Plan not found");
  return { id: input.planId };
}

export interface UpdateTierRequirementInput {
  readonly requirementId: string;
  readonly currentValue?: number;
  readonly secondaryCurrentValue?: number;
  readonly ownerUserId?: string | null;
  readonly targetDate?: string | null;
}

export async function updateRequirementOp(
  { identity, tx }: MutationContext,
  input: UpdateTierRequirementInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) {
    await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.currentValue !== undefined) set.currentValue = input.currentValue;
  if (input.secondaryCurrentValue !== undefined) set.secondaryCurrentValue = input.secondaryCurrentValue;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.targetDate !== undefined) set.targetDate = input.targetDate;

  const updated = await tx
    .update(tierRequirements)
    .set(set)
    .where(
      and(
        eq(tierRequirements.id, input.requirementId),
        eq(tierRequirements.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: tierRequirements.id });
  if (updated.length === 0) throw new ValidationError("Requirement not found");
  return { id: input.requirementId };
}

async function loadRequirement(
  ctx: MutationContext,
  requirementId: string,
): Promise<{
  id: string;
  planId: string;
  label: string;
  threshold: number;
  unit: string;
  category: string;
  kind: string;
  ownerUserId: string | null;
  targetTier: string;
}> {
  const [row] = await ctx.tx
    .select({
      id: tierRequirements.id,
      planId: tierRequirements.planId,
      label: tierRequirements.label,
      threshold: tierRequirements.threshold,
      unit: tierRequirements.unit,
      category: tierRequirements.category,
      kind: tierRequirements.kind,
      ownerUserId: tierRequirements.ownerUserId,
      targetTier: tierPlans.targetTier,
    })
    .from(tierRequirements)
    .innerJoin(tierPlans, eq(tierPlans.id, tierRequirements.planId))
    .where(
      and(
        eq(tierRequirements.id, requirementId),
        eq(tierRequirements.tenantId, ctx.identity.tenantId),
      ),
    );
  if (!row) throw new ValidationError("Requirement not found");
  return row;
}

export async function createTaskFromTierRequirementOp(
  ctx: MutationContext,
  input: { readonly requirementId: string },
): Promise<{ taskId: string | null }> {
  const req = await loadRequirement(ctx, input.requirementId);
  const { taskId } = await createSourcedTask(ctx, {
    title:
      req.kind === "boolean"
        ? `Complete: ${req.label}`
        : `Reach ${req.threshold} ${req.unit}: ${req.label}`,
    description: `Close the ${req.label} gap to advance to ${req.targetTier} tier.`,
    priority: "high",
    source: "tier",
    sourceRef: `${req.planId}:${req.id}`,
    ownerUserId: req.ownerUserId,
  });
  if (taskId) {
    await ctx.tx
      .update(tierRequirements)
      .set({ taskId, updatedAt: sql`now()` })
      .where(
        and(
          eq(tierRequirements.id, input.requirementId),
          eq(tierRequirements.tenantId, ctx.identity.tenantId),
        ),
      );
  }
  return { taskId };
}

export async function stageEvidenceForTierRequirementOp(
  ctx: MutationContext,
  input: { readonly requirementId: string },
): Promise<{ evidenceId: string | null }> {
  const req = await loadRequirement(ctx, input.requirementId);
  const { evidenceId } = await createSourcedEvidence(ctx, {
    title: `${req.targetTier} tier: ${req.label}`,
    evidenceType: CATEGORY_EVIDENCE[req.category] ?? "other",
    program: `${req.targetTier} tier advancement`,
    notes: "",
    source: "tier",
    sourceRef: `${req.planId}:${req.id}`,
  });
  if (evidenceId) {
    await ctx.tx
      .update(tierRequirements)
      .set({ evidenceId, updatedAt: sql`now()` })
      .where(
        and(
          eq(tierRequirements.id, input.requirementId),
          eq(tierRequirements.tenantId, ctx.identity.tenantId),
        ),
      );
  }
  return { evidenceId };
}

/**
 * Approve advancement: every requirement must be met. Marks the plan achieved
 * and updates the tenant's tier. Status-guarded so it runs exactly once.
 */
export async function advanceTierOp(
  { identity, tx }: MutationContext,
  input: { readonly planId: string },
): Promise<{ tier: string }> {
  const [plan] = await tx
    .select({ status: tierPlans.status, targetTier: tierPlans.targetTier })
    .from(tierPlans)
    .where(and(eq(tierPlans.id, input.planId), eq(tierPlans.tenantId, identity.tenantId)));
  if (!plan) throw new ValidationError("Plan not found");
  if (plan.status !== "active") {
    throw new ValidationError("Tier has already been advanced");
  }

  const reqs = await tx
    .select({
      key: tierRequirements.requirementKey,
      label: tierRequirements.label,
      category: tierRequirements.category,
      threshold: tierRequirements.threshold,
      currentValue: tierRequirements.currentValue,
      kind: tierRequirements.kind,
      secondaryThreshold: tierRequirements.secondaryThreshold,
      secondaryCurrentValue: tierRequirements.secondaryCurrentValue,
      informational: tierRequirements.informational,
    })
    .from(tierRequirements)
    .where(
      and(
        eq(tierRequirements.planId, input.planId),
        eq(tierRequirements.tenantId, identity.tenantId),
      ),
    )
    .orderBy(asc(tierRequirements.requirementKey));
  const values: RequirementValue[] = reqs.map((r) => ({
    key: r.key,
    label: r.label,
    category: r.category,
    threshold: r.threshold,
    currentValue: r.currentValue,
    kind: r.kind as RequirementKind,
    secondaryThreshold: r.secondaryThreshold,
    secondaryCurrentValue: r.secondaryCurrentValue,
    informational: r.informational,
  }));
  if (!isAchievable(values)) {
    throw new ValidationError(
      "Every requirement must meet its threshold before advancing",
    );
  }

  const advanced = await tx
    .update(tierPlans)
    .set({ status: "achieved", achievedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(tierPlans.id, input.planId),
        eq(tierPlans.tenantId, identity.tenantId),
        eq(tierPlans.status, "active"),
      ),
    )
    .returning({ id: tierPlans.id });
  if (advanced.length === 0) {
    throw new ValidationError("Tier has already been advanced");
  }

  // Capstone effect: the workspace's tier actually moves up. RLS WITH CHECK on
  // tenants permits updating only the caller's own tenant row.
  await tx
    .update(tenants)
    .set({ tier: plan.targetTier })
    .where(eq(tenants.id, identity.tenantId));

  return { tier: plan.targetTier };
}

/**
 * Auto-measure the requirements the platform can compute (launched-opportunity
 * count, adopted-Competency count, sustained attainment) and write them onto the
 * plan's matching requirement rows. The DB stays the single source of truth, so the
 * advancement gate reads these values. Manual edits remain possible; a re-sync
 * re-applies. Best-effort over whatever the tenant has.
 */
export async function syncTierMeasuredValuesOp(
  { identity, tx }: MutationContext,
  input: { readonly today: string },
): Promise<{ updated: number; planId: string; changes: string[] }> {
  const [plan] = await tx
    .select({
      id: tierPlans.id,
      targetTier: tierPlans.targetTier,
      achievedAt: tierPlans.achievedAt,
    })
    .from(tierPlans)
    .where(eq(tierPlans.tenantId, identity.tenantId));
  if (!plan) throw new ValidationError("No tier plan to sync");

  // Prior measured values, keyed by requirement, to detect which actually moved.
  const current = await tx
    .select({
      requirementKey: tierRequirements.requirementKey,
      label: tierRequirements.label,
      currentValue: tierRequirements.currentValue,
    })
    .from(tierRequirements)
    .where(and(eq(tierRequirements.planId, plan.id), eq(tierRequirements.tenantId, identity.tenantId)));
  const byKey = new Map(current.map((r) => [r.requirementKey, r]));

  const measurements = await gatherTierMeasurements(
    tx,
    identity.tenantId,
    plan.achievedAt,
    input.today,
  );
  const derived = deriveByKey(plan.targetTier as TierId, measurements);

  let updated = 0;
  const changes: string[] = [];
  for (const [key, value] of derived) {
    const res = await tx
      .update(tierRequirements)
      .set({ currentValue: value, updatedAt: sql`now()` })
      .where(
        and(
          eq(tierRequirements.planId, plan.id),
          eq(tierRequirements.tenantId, identity.tenantId),
          eq(tierRequirements.requirementKey, key),
        ),
      )
      .returning({ id: tierRequirements.id });
    updated += res.length;
    const prev = byKey.get(key);
    if (res.length > 0 && prev && prev.currentValue !== value) changes.push(prev.label);
  }
  return { updated, planId: plan.id, changes };
}
