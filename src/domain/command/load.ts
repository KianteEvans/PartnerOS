import { cache } from "react";
import { deferAfterResponse } from "@/http/defer";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import {
  tasks,
  mdfRequests,
  mdfPlanItems,
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
  fundingSubmissions,
  decisionDismissals,
} from "@/db/schema";
import { addMonths } from "@/domain/dates";
import { derivedDeadlines } from "@/domain/mdf/compliance";
import { marketplaceCommandRollup } from "@/domain/marketplace/load";
import { loadAwsSyncInput } from "@/domain/aws/reconcile-load";
import { isOpen as isFundingOpen } from "@/domain/funding/lifecycle";
import { buildRematchCandidates, type RematchOpp, type AppliedPair } from "@/domain/funding/rematch";
import type { PartnerContext } from "@/domain/funding/eligibility";
import type { TierId } from "@/domain/tiers/catalog";
import type { CommandInputs, CommandPlanEvent, CommandFundingSubmission } from "@/domain/command/types";
import { maybeRunPlaybooks } from "@/domain/playbooks/runner";

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
  /**
   * Decision ids under an active snooze (dismissed_until >= today). A
   * PRESENTATION filter only — pass to buildCommandCenter / the bell. The
   * playbook runner and the analysis surfaces (impact/horizon/scenario/causal,
   * report packet, copilot brief) deliberately consume the RAW queue: a bell
   * snooze must not silence automation or skew analysis of underlying state.
   */
  readonly dismissedIds: ReadonlySet<string>;
}

/**
 * The gather itself, memoized per request with React cache() so the layout's
 * notification bell and a page that both need command inputs share ONE build.
 * Keyed by primitives (cache() memoizes by argument value — an identity object
 * would never hit). Per-request only: no cross-request or cross-tenant sharing.
 */
const cachedCommandData = cache(
  async (tenantId: string, userId: string, role: string, today: string): Promise<CommandData> => {
    const identity: DbIdentity = { tenantId, userId, role };
    return withTenant(identity, async (tx) => {
      const t = tenantId;

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
    const planItemRows = await tx
      .select({
        id: mdfPlanItems.id,
        planId: mdfPlanItems.planId,
        title: mdfPlanItems.title,
        startDate: mdfPlanItems.startDate,
        endDate: mdfPlanItems.endDate,
        requestId: mdfPlanItems.requestId,
      })
      .from(mdfPlanItems)
      .where(eq(mdfPlanItems.tenantId, t));
    const planEvents: CommandPlanEvent[] = planItemRows.map((e) => ({
      id: e.id,
      planId: e.planId,
      title: e.title,
      submitBy: derivedDeadlines(e.startDate, e.endDate).submitBy,
      converted: e.requestId !== null,
      ownerUserId: null,
    }));
    const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, t));
    const ev = await tx.select().from(evidence).where(eq(evidence.tenantId, t));

    // ONE programs read serves both the CommandInputs projection and the
    // rematch key/competency lookups further down (was two full-table reads).
    const progAll = await tx
      .select({
        id: programs.id,
        name: programs.name,
        status: programs.status,
        expirationDate: programs.expirationDate,
        libraryKey: programs.libraryKey,
        programType: programs.programType,
      })
      .from(programs)
      .where(eq(programs.tenantId, t));
    const progRows = progAll.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      expirationDate: p.expirationDate,
    }));

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
            secondaryThreshold: tierRequirements.secondaryThreshold,
            secondaryCurrentValue: tierRequirements.secondaryCurrentValue,
            informational: tierRequirements.informational,
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
        and(
          eq(roadmapMilestones.tenantId, t),
          eq(roadmaps.status, "finalized"),
          isNull(roadmaps.archivedAt),
        ),
      );

    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, t));
    // Launched opportunities credited toward renewal: stage="launched" in a rolling 12mo.
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
    const solList = solRows.map((s) => ({ ...s, launchedCount: Number(s.launchedCount) }));
    const marketplace = await marketplaceCommandRollup(tx, t, today);
    const awsSync = await loadAwsSyncInput(tx, t);

    // ONE funding read serves both the deadline rollup and the applied
    // (opportunity, program) pairs below (was two full-table reads).
    const fundingRows = await tx
      .select({
        id: fundingSubmissions.id,
        title: fundingSubmissions.title,
        status: fundingSubmissions.status,
        deadline: fundingSubmissions.deadline,
        ownerUserId: fundingSubmissions.ownerUserId,
        opportunityId: fundingSubmissions.opportunityId,
        programKey: fundingSubmissions.programKey,
      })
      .from(fundingSubmissions)
      .where(eq(fundingSubmissions.tenantId, t));
    const fundingSubs: CommandFundingSubmission[] = fundingRows.map((f) => ({
      id: f.id,
      title: f.title,
      open: isFundingOpen(f.status),
      deadline: f.deadline,
      ownerUserId: f.ownerUserId,
    }));

    // Proactive funding re-match: open deals eligible for a program they have not applied
    // for. Mirrors the loadFundingMatcher context idiom (funding/load.ts); the eligibility
    // itself is the pure buildRematchCandidates.
    const progKeyById = new Map(progAll.map((p) => [p.id, p.libraryKey]));
    const competencyKeys = progAll
      .filter((p) => p.status === "active" && p.programType === "Competency")
      .map((p) => p.libraryKey);
    const solTypeById = new Map(solList.map((s) => [s.id, s.solutionType]));
    const rematchContext: PartnerContext = {
      tier: (tenant?.tier ?? "registered") as TierId,
      competencyKeys,
      solutionTypes: [...new Set(solList.map((s) => s.solutionType))],
    };
    const rematchOpps: RematchOpp[] = opps.map((o) => ({
      id: o.id,
      name: o.name,
      amount: o.amount,
      ownerUserId: o.ownerUserId,
      profile: {
        amount: o.amount,
        stage: o.stage,
        status: o.status,
        source: o.source,
        solutionType: o.solutionId ? solTypeById.get(o.solutionId) ?? null : null,
        competencyKey: o.programId ? progKeyById.get(o.programId) ?? null : null,
      },
    }));
    const applied: AppliedPair[] = fundingRows.flatMap((a) =>
      a.opportunityId ? [{ opportunityId: a.opportunityId, programKey: a.programKey }] : [],
    );
    const fundingRematch = buildRematchCandidates(rematchOpps, applied, rematchContext);

    // Active snoozes (bell "x") — surfaced separately from inputs so callers
    // choose filtered (pages, bell, export) vs raw (automation, analysis).
    const dismissalRows = await tx
      .select({ decisionId: decisionDismissals.decisionId })
      .from(decisionDismissals)
      .where(and(eq(decisionDismissals.tenantId, t), gte(decisionDismissals.dismissedUntil, today)));
    const dismissedIds: ReadonlySet<string> = new Set(dismissalRows.map((d) => d.decisionId));

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
      planEvents,
      marketplace,
      awsSync,
      fundingSubmissions: fundingSubs,
      fundingRematch,
    };

    return { inputs, receipts, members, dismissedIds };
    });
  },
);

/**
 * Standalone read of the active snoozes (dismissed_until >= today) — the same
 * predicate the cached gather uses, callable outside it (tests, one-off
 * surfaces that never need the full command build).
 */
export async function loadActiveDismissedIds(
  identity: DbIdentity,
  today: string,
): Promise<ReadonlySet<string>> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({ decisionId: decisionDismissals.decisionId })
      .from(decisionDismissals)
      .where(
        and(
          eq(decisionDismissals.tenantId, identity.tenantId),
          gte(decisionDismissals.dismissedUntil, today),
        ),
      );
    return new Set(rows.map((r) => r.decisionId));
  });
}

/**
 * Materialize-on-read automation pass (playbooks off the live decision queue).
 * Runs in its own tenant transaction so it can execute AFTER the response has
 * streamed. Guarded to playbook:run users + automation mode inside, and never
 * throws — automation must never break a page.
 */
async function runCommandAutomation(
  identity: DbIdentity,
  inputs: CommandInputs,
  today: string,
): Promise<void> {
  try {
    await withTenant(identity, (tx) => maybeRunPlaybooks(identity, tx, inputs, today));
  } catch {
    // best-effort by design
  }
}

/**
 * Command Center entry point: the cached gather + the automation pass. In a
 * request, automation is deferred past the response with next's after(); outside
 * one (integration tests, scripts) after() throws and we keep the original
 * inline materialize-on-read semantics.
 */
export async function loadCommandData(identity: DbIdentity): Promise<CommandData> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await cachedCommandData(identity.tenantId, identity.userId, identity.role, today);
  await deferAfterResponse(() => runCommandAutomation(identity, data.inputs, today));
  return data;
}

/**
 * Shared-read entry point (the notification bell): the same per-request cached
 * build WITHOUT the automation trigger, so rendering a page never fires
 * playbooks that the page itself would not have fired.
 */
export async function loadCommandShared(identity: DbIdentity, today: string): Promise<CommandData> {
  return cachedCommandData(identity.tenantId, identity.userId, identity.role, today);
}
