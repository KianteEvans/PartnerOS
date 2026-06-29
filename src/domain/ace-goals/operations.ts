import { and, eq, sql } from "drizzle-orm";
import { aceGoals } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";

/** DB side of Co-Selling Goal mutations. Goals are tenant-wide; the ACE page
 *  measures current-vs-target live from the loaded pipeline/relationship rows. */

export interface CreateAceGoalInput {
  readonly metricKey: string;
  readonly targetValue: number;
  readonly periodStart: string;
  readonly targetDeadline: string | null;
}

export async function createAceGoalOp(
  { identity, tx }: MutationContext,
  input: CreateAceGoalInput,
): Promise<{ id: string }> {
  const [g] = await tx
    .insert(aceGoals)
    .values({
      tenantId: identity.tenantId,
      metricKey: input.metricKey,
      targetValue: input.targetValue,
      periodStart: input.periodStart,
      targetDeadline: input.targetDeadline,
      createdBy: identity.userId,
    })
    .returning({ id: aceGoals.id });
  return { id: g!.id };
}

export interface UpdateAceGoalInput {
  readonly goalId: string;
  readonly targetValue?: number;
  readonly targetDeadline?: string | null;
  readonly status?: "active" | "archived";
}

export async function updateAceGoalOp(
  { identity, tx }: MutationContext,
  input: UpdateAceGoalInput,
): Promise<{ id: string }> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.targetValue !== undefined) set.targetValue = input.targetValue;
  if (input.targetDeadline !== undefined) set.targetDeadline = input.targetDeadline;
  if (input.status !== undefined) set.status = input.status;

  const [g] = await tx
    .update(aceGoals)
    .set(set)
    .where(and(eq(aceGoals.id, input.goalId), eq(aceGoals.tenantId, identity.tenantId)))
    .returning({ id: aceGoals.id });
  if (!g) throw new ValidationError("Goal not found");
  return { id: g.id };
}
