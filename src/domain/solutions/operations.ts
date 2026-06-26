import { and, eq, sql } from "drizzle-orm";
import { solutions } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";

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
}

export async function createSolutionOp(
  { identity, tx }: MutationContext,
  input: CreateSolutionInput,
): Promise<{ id: string }> {
  const [s] = await tx
    .insert(solutions)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      solutionType: input.solutionType,
      programType: input.programType,
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
}

export async function updateSolutionOp(
  { identity, tx }: MutationContext,
  input: UpdateSolutionInput,
): Promise<{ id: string }> {
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

  const [s] = await tx
    .update(solutions)
    .set(set)
    .where(and(eq(solutions.id, input.solutionId), eq(solutions.tenantId, identity.tenantId)))
    .returning({ id: solutions.id });
  if (!s) throw new ValidationError("Solution not found");
  return { id: s.id };
}
