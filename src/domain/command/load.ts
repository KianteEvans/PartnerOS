import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import {
  tasks,
  mdfRequests,
  opportunities,
  aceRelationships,
  programs,
  tierPlans,
  tierRequirements,
  evidence,
  roadmaps,
  roadmapMilestones,
  auditLog,
  users,
  solutions,
  tenants,
} from "@/db/schema";
import { addMonths } from "@/domain/dates";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Read-only Command Center loader: gather the cross-section rows the aggregation
 * needs in one tenant-scoped (RLS) transaction, plus recent workflow receipts
 * (the audit ledger) and member emails. No mutations — Command Center is a
 * derived surface. The pure buildCommandCenter() consumes the returned inputs.
 */

export interface Receipt {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly actorUserId: string | null;
  readonly createdAt: Date;
}

export interface CommandData {
  readonly inputs: CommandInputs;
  readonly receipts: readonly Receipt[];
  readonly members: ReadonlyArray<{ id: string; email: string }>;
}

export async function loadCommandData(identity: DbIdentity): Promise<CommandData> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    const taskRows = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        ownerUserId: tasks.ownerUserId,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.tenantId, t));

    const mdf = await tx.select().from(mdfRequests).where(eq(mdfRequests.tenantId, t));
    const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, t));
    const ev = await tx.select().from(evidence).where(eq(evidence.tenantId, t));

    const progRows = await tx
      .select({
        id: programs.id,
        name: programs.name,
        status: programs.status,
        expirationDate: programs.expirationDate,
      })
      .from(programs)
      .where(eq(programs.tenantId, t));

    const [tierPlan] = await tx
      .select({ currentTier: tierPlans.currentTier, targetTier: tierPlans.targetTier, status: tierPlans.status })
      .from(tierPlans)
      .where(eq(tierPlans.tenantId, t));
    const tierReqs = tierPlan
      ? await tx
          .select({
            key: tierRequirements.requirementKey,
            label: tierRequirements.label,
            category: tierRequirements.category,
            threshold: tierRequirements.threshold,
            currentValue: tierRequirements.currentValue,
          })
          .from(tierRequirements)
          .where(eq(tierRequirements.tenantId, t))
      : [];

    const receipts = await tx
      .select({
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
        actorUserId: auditLog.actorUserId,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(eq(auditLog.tenantId, t))
      .orderBy(desc(auditLog.createdAt))
      .limit(10);

    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, t));

    const relRows = await tx
      .select({
        id: aceRelationships.id,
        name: aceRelationships.name,
        role: aceRelationships.role,
        accountName: aceRelationships.accountName,
        strength: aceRelationships.strength,
        lastContact: aceRelationships.lastContact,
      })
      .from(aceRelationships)
      .where(eq(aceRelationships.tenantId, t));

    const msRows = await tx
      .select({
        id: roadmapMilestones.id,
        roadmapId: roadmapMilestones.roadmapId,
        title: roadmapMilestones.title,
        status: roadmapMilestones.status,
        targetDate: roadmapMilestones.targetDate,
        ownerUserId: roadmapMilestones.ownerUserId,
      })
      .from(roadmapMilestones)
      .innerJoin(roadmaps, eq(roadmaps.id, roadmapMilestones.roadmapId))
      .where(
        and(eq(roadmapMilestones.tenantId, t), eq(roadmaps.status, "finalized")),
      );

    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, t));
    // Launched opportunities credited toward renewal: stage="launched" in a rolling 12mo.
    const horizon = addMonths(new Date().toISOString().slice(0, 10), -12);
    const solRows = await tx
      .select({
        id: solutions.id,
        title: solutions.title,
        availability: solutions.availability,
        programType: solutions.programType,
        solutionType: solutions.solutionType,
        ftrStatus: solutions.ftrStatus,
        renewalDate: solutions.renewalDate,
        launchedCount: sql<number>`count(${opportunities.id})`,
      })
      .from(solutions)
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.solutionId, solutions.id),
          eq(opportunities.stage, "launched"),
          gte(opportunities.closeDate, horizon),
        ),
      )
      .where(eq(solutions.tenantId, t))
      .groupBy(solutions.id);
    const solList = solRows.map((s) => ({ ...s, launchedCount: Number(s.launchedCount) }));

    const inputs: CommandInputs = {
      tasks: taskRows,
      mdf,
      opportunities: opps,
      evidence: ev,
      programs: progRows,
      tier: tierPlan ?? null,
      tierRequirements: tierReqs,
      relationships: relRows,
      milestones: msRows,
      solutions: solList,
      currentTier: tenant?.tier ?? "registered",
    };
    return { inputs, receipts, members };
  });
}
