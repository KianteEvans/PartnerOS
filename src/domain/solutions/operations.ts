import { and, eq, sql } from "drizzle-orm";
import { programs, solutions } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";

/** A linked program must belong to this tenant — the FK alone can't stop a
 *  forged cross-tenant id, so verify before writing. */
async function assertProgramOwned(
  { identity, tx }: MutationContext,
  programId: string,
): Promise<void> {
  const [p] = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.tenantId, identity.tenantId)));
  if (!p) throw new ValidationError("Program not found");
}

/** DB side of Solution mutations. Solutions are tenant-wide + reusable across
 *  applications; they link to ACE opportunities (the renewal metric). */

export type SolutionType =
  | "software_product"
  | "hardware_product"
  | "consulting_service"
  | "professional_service"
  | "managed_service"
  | "training_service"
  | "other";
export type Availability = "available" | "beta" | "unsupported";
export type FtrStatus = "none" | "requested" | "approved";

export interface CreateSolutionInput {
  readonly title: string;
  readonly solutionType: SolutionType;
  readonly programType: string;
  readonly programId?: string | null;
}

export async function createSolutionOp(
  ctx: MutationContext,
  input: CreateSolutionInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  if (input.programId) await assertProgramOwned(ctx, input.programId);
  const [s] = await tx
    .insert(solutions)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      solutionType: input.solutionType,
      programType: input.programType,
      programId: input.programId ?? null,
      createdBy: identity.userId,
    })
    .returning({ id: solutions.id });
  return { id: s!.id };
}

export interface UpdateSolutionInput {
  readonly solutionId: string;
  readonly title?: string;
  readonly solutionType?: SolutionType;
  readonly programType?: string;
  readonly description?: string;
  readonly sellingProposition?: string;
  readonly availability?: Availability;
  readonly ftrStatus?: FtrStatus;
  readonly url?: string;
  readonly marketplaceUrl?: string;
  readonly renewalDate?: string | null;
  readonly programId?: string | null;
}

export async function updateSolutionOp(
  ctx: MutationContext,
  input: UpdateSolutionInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  if (input.programId) await assertProgramOwned(ctx, input.programId);
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.solutionType !== undefined) set.solutionType = input.solutionType;
  if (input.programType !== undefined) set.programType = input.programType;
  if (input.description !== undefined) set.description = input.description;
  if (input.sellingProposition !== undefined) set.sellingProposition = input.sellingProposition;
  if (input.availability !== undefined) set.availability = input.availability;
  if (input.ftrStatus !== undefined) set.ftrStatus = input.ftrStatus;
  if (input.url !== undefined) set.url = input.url;
  if (input.marketplaceUrl !== undefined) set.marketplaceUrl = input.marketplaceUrl;
  if (input.renewalDate !== undefined) set.renewalDate = input.renewalDate;
  if (input.programId !== undefined) set.programId = input.programId;

  const [s] = await tx
    .update(solutions)
    .set(set)
    .where(and(eq(solutions.id, input.solutionId), eq(solutions.tenantId, identity.tenantId)))
    .returning({ id: solutions.id });
  if (!s) throw new ValidationError("Solution not found");
  return { id: s.id };
}
