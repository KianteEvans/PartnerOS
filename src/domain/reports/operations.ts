import { and, eq, sql } from "drizzle-orm";
import {
  reports,
  mdfRequests,
  opportunities,
  evidence,
  programs,
  tierPlans,
  tierRequirements,
  tasks,
  assessments,
  marketplaceListings,
  marketplaceEntitlements,
  marketplaceAttributions,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import {
  buildSnapshot,
  narrativeSummary,
  reportPreflight,
  snapshotDelta,
  type ReportType,
  type ReportSnapshot,
  type SnapshotInputs,
} from "@/domain/reports/metrics";

/**
 * The database side of Reporting. generate/regenerate gather rows from every
 * section and run the pure snapshot builder; the lifecycle transitions are
 * status-guarded. Factored out of the actions so the gate drives them in tests.
 */

/** Pull the cross-section rows the snapshot needs (all tenant-scoped via RLS). */
async function gatherInputs(ctx: MutationContext): Promise<SnapshotInputs> {
  const { identity, tx } = ctx;
  const t = identity.tenantId;

  const mdf = await tx.select().from(mdfRequests).where(eq(mdfRequests.tenantId, t));
  const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, t));
  const ev = await tx.select().from(evidence).where(eq(evidence.tenantId, t));
  const progs = await tx.select({ status: programs.status }).from(programs).where(eq(programs.tenantId, t));
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
  const taskRows = await tx.select({ status: tasks.status, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.tenantId, t));
  const assessRows = await tx
    .select({ status: assessments.status, overallScore: assessments.overallScore })
    .from(assessments)
    .where(eq(assessments.tenantId, t));

  const [mpCounts] = await tx
    .select({
      listings: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${marketplaceListings.status} = 'published')::int`,
    })
    .from(marketplaceListings)
    .where(eq(marketplaceListings.tenantId, t));
  const [mpEnt] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(marketplaceEntitlements)
    .where(eq(marketplaceEntitlements.tenantId, t));
  const [mpAttr] = await tx
    .select({ cents: sql<number>`coalesce(sum(${marketplaceAttributions.amount}), 0)::int` })
    .from(marketplaceAttributions)
    .where(eq(marketplaceAttributions.tenantId, t));

  return {
    mdf,
    opportunities: opps,
    evidence: ev,
    programs: progs,
    tier: tierPlan ?? null,
    tierRequirements: tierReqs,
    tasks: taskRows,
    assessments: assessRows,
    marketplace: {
      listings: mpCounts?.listings ?? 0,
      published: mpCounts?.published ?? 0,
      activeEntitlements: mpEnt?.n ?? 0,
      attributedRevenueCents: mpAttr?.cents ?? 0,
    },
  };
}

export interface GenerateReportInput {
  readonly title: string;
  readonly reportType: ReportType;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly today: string;
}

export async function generateReportOp(
  ctx: MutationContext,
  input: GenerateReportInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const snapshot = buildSnapshot(await gatherInputs(ctx), input.today);
  const summary = narrativeSummary(snapshot, input.reportType);

  const [row] = await tx
    .insert(reports)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      reportType: input.reportType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      snapshot,
      summary,
      createdBy: identity.userId,
    })
    .returning({ id: reports.id });
  return { id: row!.id };
}

/** Recompute a draft report's snapshot from current data. */
export async function regenerateReportOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly today: string },
): Promise<{ id: string; changed: string[] }> {
  const { identity, tx } = ctx;
  const [report] = await tx
    .select({ status: reports.status, reportType: reports.reportType, snapshot: reports.snapshot })
    .from(reports)
    .where(and(eq(reports.id, input.id), eq(reports.tenantId, identity.tenantId)));
  if (!report) throw new ValidationError("Report not found");
  if (report.status !== "draft") throw new ValidationError("Only a draft report can be regenerated");

  const prior = report.snapshot as ReportSnapshot | null;
  const snapshot = buildSnapshot(await gatherInputs(ctx), input.today);
  const summary = narrativeSummary(snapshot, report.reportType as ReportType);
  // The saved executive narrative is cleared too — it told the OLD snapshot's story.
  await tx
    .update(reports)
    .set({ snapshot, summary, narrative: "", updatedAt: sql`now()` })
    .where(and(eq(reports.id, input.id), eq(reports.tenantId, identity.tenantId)));
  // Which KPIs actually moved vs the previous snapshot — surfaced in the success toast.
  const changed = snapshotDelta(snapshot, prior)
    .filter((d) => d.delta !== null && d.delta !== 0)
    .map((d) => d.label);
  return { id: input.id, changed };
}

/**
 * Save the executive narrative on a DRAFT report (draft -> draft, like regenerate).
 * The lifecycle freezes it: once submitted for review it can no longer be rewritten,
 * and regenerating the snapshot clears it.
 */
export async function saveNarrativeOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly narrative: string },
): Promise<{ id: string }> {
  const updated = await ctx.tx
    .update(reports)
    .set({ narrative: input.narrative, updatedAt: sql`now()` })
    .where(
      and(
        eq(reports.id, input.id),
        eq(reports.tenantId, ctx.identity.tenantId),
        eq(reports.status, "draft"),
      ),
    )
    .returning({ id: reports.id });
  if (updated.length === 0) throw new ValidationError("Report is not in the 'draft' state");
  return { id: input.id };
}

async function advance(
  ctx: MutationContext,
  id: string,
  from: "draft" | "reviewed" | "approved",
  set: Record<string, unknown>,
): Promise<void> {
  const updated = await ctx.tx
    .update(reports)
    .set({ ...set, updatedAt: sql`now()` })
    .where(
      and(
        eq(reports.id, id),
        eq(reports.tenantId, ctx.identity.tenantId),
        eq(reports.status, from),
      ),
    )
    .returning({ id: reports.id });
  if (updated.length === 0) throw new ValidationError(`Report is not in the '${from}' state`);
}

export async function submitForReviewOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ status: "reviewed" }> {
  await advance(ctx, input.id, "draft", {
    status: "reviewed",
    reviewedBy: ctx.identity.userId,
    reviewedAt: sql`now()`,
  });
  return { status: "reviewed" };
}

/** reviewed -> approved (the gate). Requires the snapshot to pass preflight. */
export async function approveReportOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ status: "approved" }> {
  const { identity, tx } = ctx;
  const [report] = await tx
    .select({ status: reports.status, snapshot: reports.snapshot })
    .from(reports)
    .where(and(eq(reports.id, input.id), eq(reports.tenantId, identity.tenantId)));
  if (!report) throw new ValidationError("Report not found");
  if (report.status !== "reviewed") throw new ValidationError("Report is not in the 'reviewed' state");
  if (!reportPreflight(report.snapshot as ReportSnapshot).ready) {
    throw new ValidationError("Report has no section data; it cannot be approved");
  }
  await advance(ctx, input.id, "reviewed", {
    status: "approved",
    approvedBy: identity.userId,
    approvedAt: sql`now()`,
  });
  return { status: "approved" };
}

export async function markExportedOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ status: "exported" }> {
  await advance(ctx, input.id, "approved", { status: "exported", exportedAt: sql`now()` });
  return { status: "exported" };
}
