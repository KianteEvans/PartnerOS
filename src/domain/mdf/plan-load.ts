import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { mdfEventPlans, mdfPlanItems, mdfRequests } from "@/db/schema";
import { committedInPeriod, budgetStatus } from "@/domain/mdf/budget";
import { loadActiveBudget, type ActiveBudget } from "@/domain/mdf/load";

/** Read-side loaders for the MDF event planner. */

export interface PlanRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly notes: string;
  readonly updatedAt: Date;
  readonly itemCount: number;
  readonly plannedCost: number;
}

/** All non-archived plans for the tenant + a lightweight item rollup, newest first. */
export async function loadPlans(identity: DbIdentity): Promise<PlanRow[]> {
  return withTenant(identity, async (tx) => {
    const plans = await tx
      .select()
      .from(mdfEventPlans)
      .where(eq(mdfEventPlans.tenantId, identity.tenantId))
      .orderBy(desc(mdfEventPlans.updatedAt));
    const items = await tx
      .select({ planId: mdfPlanItems.planId, totalCost: mdfPlanItems.totalCost })
      .from(mdfPlanItems)
      .where(eq(mdfPlanItems.tenantId, identity.tenantId));
    const agg = new Map<string, { count: number; cost: number }>();
    for (const it of items) {
      const a = agg.get(it.planId) ?? { count: 0, cost: 0 };
      a.count += 1;
      a.cost += it.totalCost;
      agg.set(it.planId, a);
    }
    return plans.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      notes: p.notes,
      updatedAt: p.updatedAt,
      itemCount: agg.get(p.id)?.count ?? 0,
      plannedCost: agg.get(p.id)?.cost ?? 0,
    }));
  });
}

export type PlanItemRow = typeof mdfPlanItems.$inferSelect & {
  readonly requestStatus: string | null;
};

export interface PlanDetail {
  readonly plan: typeof mdfEventPlans.$inferSelect;
  readonly items: PlanItemRow[];
}

export async function loadPlanDetail(identity: DbIdentity, id: string): Promise<PlanDetail | null> {
  return withTenant(identity, async (tx) => {
    const [plan] = await tx
      .select()
      .from(mdfEventPlans)
      .where(and(eq(mdfEventPlans.id, id), eq(mdfEventPlans.tenantId, identity.tenantId)));
    if (!plan) return null;
    const rows = await tx
      .select({ item: mdfPlanItems, requestStatus: mdfRequests.status })
      .from(mdfPlanItems)
      .leftJoin(mdfRequests, eq(mdfRequests.id, mdfPlanItems.requestId))
      .where(and(eq(mdfPlanItems.planId, id), eq(mdfPlanItems.tenantId, identity.tenantId)))
      .orderBy(asc(mdfPlanItems.createdAt));
    return { plan, items: rows.map((r) => ({ ...r.item, requestStatus: r.requestStatus })) };
  });
}

export interface AvailableMdf {
  readonly hasBudget: boolean;
  readonly budget: ActiveBudget | null;
  readonly allocated: number;
  readonly committed: number;
  /** allocated - committed (can be negative when over-committed). */
  readonly remaining: number;
  /** max(0, remaining) — the headroom to plan new events against. */
  readonly available: number;
}

/** The MDF available to plan against = the active budget's remaining (allocated - committed). */
export async function availableMdf(identity: DbIdentity, today: string): Promise<AvailableMdf> {
  const budget = await loadActiveBudget(identity, today);
  if (!budget) {
    return { hasBudget: false, budget: null, allocated: 0, committed: 0, remaining: 0, available: 0 };
  }
  const reqs = await withTenant(identity, (tx) =>
    tx
      .select({
        status: mdfRequests.status,
        approvedAmount: mdfRequests.approvedAmount,
        startDate: mdfRequests.startDate,
        createdAt: mdfRequests.createdAt,
      })
      .from(mdfRequests)
      .where(eq(mdfRequests.tenantId, identity.tenantId)),
  );
  const committed = committedInPeriod(
    reqs.map((r) => ({
      status: r.status,
      approvedAmount: r.approvedAmount,
      startDate: r.startDate,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
    budget.periodStart,
    budget.periodEnd,
  );
  const bs = budgetStatus(budget.amount, committed);
  return {
    hasBudget: true,
    budget,
    allocated: bs.allocated,
    committed: bs.committed,
    remaining: bs.remaining,
    available: Math.max(0, bs.remaining),
  };
}
