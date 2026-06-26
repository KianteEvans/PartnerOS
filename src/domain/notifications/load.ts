import { and, eq, gte, sql } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import {
  tasks,
  mdfRequests,
  opportunities,
  aceRelationships,
  programs,
  evidence,
  roadmaps,
  roadmapMilestones,
  solutions,
  tenants,
} from "@/db/schema";
import { addMonths } from "@/domain/dates";
import { deriveDecisions, type Decision } from "@/domain/command/brief";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Notification feed for the global top bar. Reuses the Command Center's pure
 * `deriveDecisions` — the canonical "what needs attention" derivation — over a
 * tenant-scoped (RLS) read of just the rows it consumes (no tier/audit/members
 * that the full Command Center loads). Runs per request in the root layout, so
 * it stays deliberately small.
 */
export interface NotificationData {
  readonly items: readonly Decision[];
  readonly count: number;
}

export async function loadNotifications(
  identity: DbIdentity,
  today: string,
): Promise<NotificationData> {
  const inputs = await withTenant(identity, async (tx): Promise<CommandInputs> => {
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
    const horizon = addMonths(today, -12);
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

    return {
      tasks: taskRows,
      mdf,
      opportunities: opps,
      evidence: ev,
      programs: progRows,
      tier: null,
      tierRequirements: [],
      relationships: relRows,
      milestones: msRows,
      solutions: solRows.map((s) => ({ ...s, launchedCount: Number(s.launchedCount) })),
      currentTier: tenant?.tier ?? "registered",
    };
  });

  const items = deriveDecisions(inputs, today);
  return { items, count: items.length };
}
