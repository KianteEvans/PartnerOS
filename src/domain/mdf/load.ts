import { and, desc, eq, lte, gte, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { mdfBudgets, mdfSnapshots } from "@/db/schema";
import type { PortfolioSummary } from "@/domain/mdf/analytics";

/**
 * MDF persistence helpers outside the mutation gate: a materialize-on-read daily
 * snapshot (for the hero sparklines/deltas) and the active-period budget loader.
 * The snapshot mirrors the home-hub `captureMetricSnapshot` pattern — a
 * system-internal write keyed by (tenant, captured_on), best-effort on render.
 */

const HISTORY = 14;

export interface MdfTrends {
  /** Reimbursement rate %, per day. */
  readonly reimbursementPct: number[];
  readonly reimbursed: number[];
  /** Approved-but-unclaimed (pending claim), per day. */
  readonly remaining: number[];
  readonly openCount: number[];
}

/**
 * Record today's portfolio totals once per tenant per day. Idempotent via the
 * (tenant, captured_on) unique index — first load inserts, later loads refresh.
 * Best-effort: the caller swallows errors so a capture hiccup never blocks render.
 */
export async function captureMdfSnapshot(
  identity: DbIdentity,
  s: PortfolioSummary,
  today: string,
): Promise<void> {
  await withTenant(identity, (tx) =>
    tx
      .insert(mdfSnapshots)
      .values({
        tenantId: identity.tenantId,
        capturedOn: today,
        approved: s.approved,
        deployed: s.deployed,
        claimed: s.claimed,
        reimbursed: s.reimbursed,
        pipeline: s.pipeline,
        openCount: s.openCount,
        deadlineRisks: s.deadlineRisks,
      })
      .onConflictDoUpdate({
        target: [mdfSnapshots.tenantId, mdfSnapshots.capturedOn],
        set: {
          approved: s.approved,
          deployed: s.deployed,
          claimed: s.claimed,
          reimbursed: s.reimbursed,
          pipeline: s.pipeline,
          openCount: s.openCount,
          deadlineRisks: s.deadlineRisks,
          updatedAt: sql`now()`,
        },
      }),
  );
}

/** The recent daily series for the hero sparklines (chronological, last 14 days). */
export async function loadMdfTrends(identity: DbIdentity): Promise<MdfTrends> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        approved: mdfSnapshots.approved,
        claimed: mdfSnapshots.claimed,
        reimbursed: mdfSnapshots.reimbursed,
        openCount: mdfSnapshots.openCount,
      })
      .from(mdfSnapshots)
      .where(eq(mdfSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(mdfSnapshots.capturedOn))
      .limit(HISTORY);
    const s = rows.reverse(); // newest-first from SQL -> chronological for the sparkline
    return {
      reimbursementPct: s.map((r) => (r.approved > 0 ? Math.min(100, Math.round((r.reimbursed / r.approved) * 100)) : 0)),
      reimbursed: s.map((r) => r.reimbursed),
      remaining: s.map((r) => Math.max(0, r.approved - r.claimed)),
      openCount: s.map((r) => r.openCount),
    };
  });
}

export interface ActiveBudget {
  readonly id: string;
  readonly periodLabel: string;
  readonly amount: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * The budget whose period contains `today` (most-recently-started wins if they
 * overlap), or null if none is set. The page derives committed vs this from the
 * already-loaded requests via `committedInPeriod`.
 */
export async function loadActiveBudget(
  identity: DbIdentity,
  today: string,
): Promise<ActiveBudget | null> {
  return withTenant(identity, async (tx) => {
    const [row] = await tx
      .select({
        id: mdfBudgets.id,
        periodLabel: mdfBudgets.periodLabel,
        amount: mdfBudgets.amount,
        periodStart: mdfBudgets.periodStart,
        periodEnd: mdfBudgets.periodEnd,
      })
      .from(mdfBudgets)
      .where(
        and(
          eq(mdfBudgets.tenantId, identity.tenantId),
          lte(mdfBudgets.periodStart, today),
          gte(mdfBudgets.periodEnd, today),
        ),
      )
      .orderBy(desc(mdfBudgets.periodStart))
      .limit(1);
    return row ?? null;
  });
}
