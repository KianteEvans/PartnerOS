import { and, eq, sql } from "drizzle-orm";
import { caseStudies, applicationCaseStudies, competencyApplications } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";

/**
 * DB side of Case Study mutations. Case studies are tenant-wide + reusable across
 * applications; the narrative aspects (about/challenge/goals/solution/outcomes) are
 * what fill the customer-example workbook sheets (Tier C3).
 */

export type Visibility = "private" | "public";

export interface CreateCaseStudyInput {
  readonly title: string;
  readonly customerName: string;
  readonly visibility: Visibility;
  readonly anonymized: boolean;
  readonly evidenceId: string | null;
}

export async function createCaseStudyOp(
  { identity, tx }: MutationContext,
  input: CreateCaseStudyInput,
): Promise<{ id: string }> {
  const [cs] = await tx
    .insert(caseStudies)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      customerName: input.customerName,
      visibility: input.visibility,
      anonymized: input.anonymized,
      evidenceId: input.evidenceId,
      createdBy: identity.userId,
    })
    .returning({ id: caseStudies.id });
  return { id: cs!.id };
}

export interface UpdateCaseStudyInput {
  readonly caseStudyId: string;
  readonly title?: string;
  readonly customerName?: string;
  readonly visibility?: Visibility;
  readonly anonymized?: boolean;
  readonly url?: string;
  readonly evidenceId?: string | null;
  readonly aboutCustomer?: string;
  readonly challenge?: string;
  readonly goals?: string;
  readonly solution?: string;
  readonly outcomes?: string;
}

export async function updateCaseStudyOp(
  { identity, tx }: MutationContext,
  input: UpdateCaseStudyInput,
): Promise<{ id: string }> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.customerName !== undefined) set.customerName = input.customerName;
  if (input.visibility !== undefined) set.visibility = input.visibility;
  if (input.anonymized !== undefined) set.anonymized = input.anonymized;
  if (input.url !== undefined) set.url = input.url;
  if (input.evidenceId !== undefined) set.evidenceId = input.evidenceId;
  if (input.aboutCustomer !== undefined) set.aboutCustomer = input.aboutCustomer;
  if (input.challenge !== undefined) set.challenge = input.challenge;
  if (input.goals !== undefined) set.goals = input.goals;
  if (input.solution !== undefined) set.solution = input.solution;
  if (input.outcomes !== undefined) set.outcomes = input.outcomes;

  const [cs] = await tx
    .update(caseStudies)
    .set(set)
    .where(and(eq(caseStudies.id, input.caseStudyId), eq(caseStudies.tenantId, identity.tenantId)))
    .returning({ id: caseStudies.id });
  if (!cs) throw new ValidationError("Case study not found");
  return { id: cs.id };
}

export interface AttachInput {
  readonly applicationId: string;
  readonly caseStudyId: string;
}

/** Attach a case study to an application at the next reference position. */
export async function attachCaseStudyOp(
  { identity, tx }: MutationContext,
  input: AttachInput,
): Promise<{ id: string | null }> {
  const tId = identity.tenantId;
  const [app] = await tx
    .select({ id: competencyApplications.id })
    .from(competencyApplications)
    .where(and(eq(competencyApplications.id, input.applicationId), eq(competencyApplications.tenantId, tId)));
  if (!app) throw new ValidationError("Application not found");
  const [cs] = await tx
    .select({ id: caseStudies.id })
    .from(caseStudies)
    .where(and(eq(caseStudies.id, input.caseStudyId), eq(caseStudies.tenantId, tId)));
  if (!cs) throw new ValidationError("Case study not found");

  const [m] = await tx
    .select({ next: sql<number>`coalesce(max(${applicationCaseStudies.sequence}), -1) + 1` })
    .from(applicationCaseStudies)
    .where(and(eq(applicationCaseStudies.applicationId, input.applicationId), eq(applicationCaseStudies.tenantId, tId)));

  const inserted = await tx
    .insert(applicationCaseStudies)
    .values({
      tenantId: tId,
      applicationId: input.applicationId,
      caseStudyId: input.caseStudyId,
      sequence: m?.next ?? 0,
    })
    .onConflictDoNothing({
      target: [
        applicationCaseStudies.tenantId,
        applicationCaseStudies.applicationId,
        applicationCaseStudies.caseStudyId,
      ],
    })
    .returning({ id: applicationCaseStudies.id });
  return { id: inserted[0]?.id ?? null };
}

/** Detach a case study from an application. Idempotent. */
export async function detachCaseStudyOp(
  { identity, tx }: MutationContext,
  input: AttachInput,
): Promise<{ ok: true }> {
  await tx
    .delete(applicationCaseStudies)
    .where(
      and(
        eq(applicationCaseStudies.applicationId, input.applicationId),
        eq(applicationCaseStudies.caseStudyId, input.caseStudyId),
        eq(applicationCaseStudies.tenantId, identity.tenantId),
      ),
    );
  return { ok: true };
}
