import { and, eq, sql } from "drizzle-orm";
import { opportunities, aceRelationships, aceInteractions, users, solutions, programs } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createSourcedTask } from "@/domain/tasks/operations";

/**
 * The database side of ACE Intelligence. Factored out of the actions so the gate
 * drives them in tests. Assigning an internal owner ROUTES an opportunity;
 * approving the routing (the gate) spawns a co-sell follow-up Task.
 */

type Stage =
  | "prospect"
  | "qualified"
  | "tech_validation"
  | "business_validation"
  | "committed"
  | "launched"
  | "closed_lost";
type Status = "open" | "won" | "lost";
type Source = "partner_originated" | "amazon_originated" | "marketplace";
type Role = "seller" | "solutions_architect" | "partner_manager" | "leadership" | "other";

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

async function assertContactInTenant(
  tx: MutationContext["tx"],
  tenantId: string,
  contactId: string,
): Promise<void> {
  const [c] = await tx
    .select({ id: aceRelationships.id })
    .from(aceRelationships)
    .where(and(eq(aceRelationships.id, contactId), eq(aceRelationships.tenantId, tenantId)));
  if (!c) throw new ValidationError("AWS contact is not in this workspace");
}

async function assertSolutionInTenant(
  tx: MutationContext["tx"],
  tenantId: string,
  solutionId: string,
): Promise<void> {
  const [s] = await tx
    .select({ id: solutions.id })
    .from(solutions)
    .where(and(eq(solutions.id, solutionId), eq(solutions.tenantId, tenantId)));
  if (!s) throw new ValidationError("Solution is not in this workspace");
}

async function assertProgramInTenant(
  tx: MutationContext["tx"],
  tenantId: string,
  programId: string,
): Promise<void> {
  const [p] = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.tenantId, tenantId)));
  if (!p) throw new ValidationError("Competency is not in this workspace");
}

export interface CreateOpportunityInput {
  readonly name: string;
  readonly accountName: string;
  readonly stage: Stage;
  readonly amount: number;
  readonly source: Source;
  readonly awsSeller: string | null;
  readonly awsContactId: string | null;
  readonly closeDate: string | null;
}

export async function createOpportunityOp(
  { identity, tx }: MutationContext,
  input: CreateOpportunityInput,
): Promise<{ id: string }> {
  if (input.awsContactId) await assertContactInTenant(tx, identity.tenantId, input.awsContactId);
  const [row] = await tx
    .insert(opportunities)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      accountName: input.accountName,
      stage: input.stage,
      amount: input.amount,
      source: input.source,
      awsSeller: input.awsSeller,
      awsContactId: input.awsContactId,
      closeDate: input.closeDate,
      createdBy: identity.userId,
    })
    .returning({ id: opportunities.id });
  return { id: row!.id };
}

export interface UpdateOpportunityInput {
  readonly id: string;
  readonly stage?: Stage;
  readonly status?: Status;
  readonly amount?: number;
  readonly ownerUserId?: string | null;
  readonly nextStep?: string;
  readonly lastInteraction?: string | null;
  readonly closeDate?: string | null;
  readonly awsSeller?: string | null;
  readonly awsContactId?: string | null;
  readonly solutionId?: string | null;
  readonly programId?: string | null;
}

export async function updateOpportunityOp(
  ctx: MutationContext,
  input: UpdateOpportunityInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const [current] = await tx
    .select({ routingStatus: opportunities.routingStatus })
    .from(opportunities)
    .where(and(eq(opportunities.id, input.id), eq(opportunities.tenantId, identity.tenantId)));
  if (!current) throw new ValidationError("Opportunity not found");
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  if (input.awsContactId) await assertContactInTenant(tx, identity.tenantId, input.awsContactId);
  if (input.solutionId) await assertSolutionInTenant(tx, identity.tenantId, input.solutionId);
  if (input.programId) await assertProgramInTenant(tx, identity.tenantId, input.programId);

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.stage !== undefined) set.stage = input.stage;
  if (input.status !== undefined) set.status = input.status;
  if (input.amount !== undefined) set.amount = input.amount;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.nextStep !== undefined) set.nextStep = input.nextStep;
  if (input.lastInteraction !== undefined) set.lastInteraction = input.lastInteraction;
  if (input.closeDate !== undefined) set.closeDate = input.closeDate;
  if (input.awsSeller !== undefined) set.awsSeller = input.awsSeller;
  if (input.awsContactId !== undefined) set.awsContactId = input.awsContactId;
  if (input.solutionId !== undefined) set.solutionId = input.solutionId;
  if (input.programId !== undefined) set.programId = input.programId;

  // Assigning an owner to an un-routed opportunity routes it.
  if (input.ownerUserId && current.routingStatus === "unrouted") {
    set.routingStatus = "routed";
  }

  await tx
    .update(opportunities)
    .set(set)
    .where(and(eq(opportunities.id, input.id), eq(opportunities.tenantId, identity.tenantId)));
  return { id: input.id };
}

/**
 * Approve an opportunity's routing (the gate): requires an assigned owner
 * (routed). Spawns a co-sell follow-up Task and links it. Status-guarded.
 */
export async function approveRoutingOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ taskId: string | null }> {
  const { identity, tx } = ctx;
  const [opp] = await tx
    .select({
      name: opportunities.name,
      accountName: opportunities.accountName,
      ownerUserId: opportunities.ownerUserId,
      routingStatus: opportunities.routingStatus,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, input.id), eq(opportunities.tenantId, identity.tenantId)));
  if (!opp) throw new ValidationError("Opportunity not found");
  if (opp.routingStatus !== "routed") {
    throw new ValidationError("Assign an internal owner before approving routing");
  }

  const { taskId } = await createSourcedTask(ctx, {
    title: `Co-sell follow-up: ${opp.name}`,
    description: `Advance the ${opp.accountName || "AWS"} co-sell opportunity.`,
    priority: "high",
    source: "ace",
    sourceRef: input.id,
    ownerUserId: opp.ownerUserId,
  });

  const advanced = await tx
    .update(opportunities)
    .set({ routingStatus: "approved", taskId, updatedAt: sql`now()` })
    .where(
      and(
        eq(opportunities.id, input.id),
        eq(opportunities.tenantId, identity.tenantId),
        eq(opportunities.routingStatus, "routed"),
      ),
    )
    .returning({ id: opportunities.id });
  if (advanced.length === 0) throw new ValidationError("Routing was already approved");
  return { taskId };
}

export interface CreateRelationshipInput {
  readonly name: string;
  readonly role: Role;
  readonly accountName: string;
  readonly strength: number;
  readonly lastContact: string | null;
}

export async function createRelationshipOp(
  { identity, tx }: MutationContext,
  data: CreateRelationshipInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(aceRelationships)
    .values({
      tenantId: identity.tenantId,
      name: data.name,
      role: data.role,
      accountName: data.accountName,
      strength: data.strength,
      lastContact: data.lastContact,
      createdBy: identity.userId,
    })
    .returning({ id: aceRelationships.id });
  return { id: row!.id };
}

export interface UpdateRelationshipInput {
  readonly id: string;
  readonly role?: Role;
  readonly strength?: number;
  readonly lastContact?: string | null;
  readonly ownerUserId?: string | null;
  readonly notes?: string;
}

export async function updateRelationshipOp(
  { identity, tx }: MutationContext,
  data: UpdateRelationshipInput,
): Promise<{ id: string }> {
  if (data.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, data.ownerUserId);
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (data.role !== undefined) set.role = data.role;
  if (data.strength !== undefined) set.strength = data.strength;
  if (data.lastContact !== undefined) set.lastContact = data.lastContact;
  if (data.ownerUserId !== undefined) set.ownerUserId = data.ownerUserId;
  if (data.notes !== undefined) set.notes = data.notes;

  const updated = await tx
    .update(aceRelationships)
    .set(set)
    .where(and(eq(aceRelationships.id, data.id), eq(aceRelationships.tenantId, identity.tenantId)))
    .returning({ id: aceRelationships.id });
  if (updated.length === 0) throw new ValidationError("Relationship not found");
  return { id: data.id };
}

export interface LogInteractionInput {
  readonly contactId: string;
  readonly opportunityId: string | null;
  readonly occurredOn: string;
  readonly kind: "meeting" | "email" | "call" | "qbr" | "note";
  readonly note: string;
}

/**
 * Log a touchpoint with an AWS contact, and freshen the relationship's recency by
 * advancing last_contact to the interaction date (GREATEST ignores NULLs). The
 * health score reads last_contact, so a logged touch improves the score directly.
 */
export async function logInteractionOp(
  { identity, tx }: MutationContext,
  input: LogInteractionInput,
): Promise<{ id: string }> {
  await assertContactInTenant(tx, identity.tenantId, input.contactId);
  const [row] = await tx
    .insert(aceInteractions)
    .values({
      tenantId: identity.tenantId,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      occurredOn: input.occurredOn,
      kind: input.kind,
      note: input.note,
      createdBy: identity.userId,
    })
    .returning({ id: aceInteractions.id });
  await tx
    .update(aceRelationships)
    .set({
      lastContact: sql`GREATEST(${aceRelationships.lastContact}, ${input.occurredOn}::date)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(aceRelationships.id, input.contactId), eq(aceRelationships.tenantId, identity.tenantId)));
  return { id: row!.id };
}
