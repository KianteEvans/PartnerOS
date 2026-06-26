import { and, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { opportunities, programs, opportunityAwsTeam, aceRelationships } from "@/db/schema";
import { programRoi, type ProgramRoi } from "@/domain/programs/roi";
import {
  rollupByRole,
  repRollups,
  prioritizeReps,
  type RoleRollup,
  type RepRollup,
  type SalesOrgOpp,
} from "@/domain/ace/sales-org";

/**
 * Read-only loaders for the Competency ROI surfaces. ROI is attribution-based and
 * all-time (no rolling window), so there is no `today` parameter — the conservative
 * "won since achieved" influence is computed purely from each program's achieved_at
 * vs each deal's close date inside the pure `programRoi` engine. RLS-scoped via
 * withTenant. Bucketing lives in the tested pure engine, so these group in JS rather
 * than via SQL aggregates.
 */

export interface ProgramRoiListItem {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly achievedAt: string | null;
  readonly roi: ProgramRoi;
}

/** Per-Competency ROI for the portfolio rollup. Includes competencies with no
 *  attributed deals yet (they roll up as zeros, prompting attribution). */
export async function loadProgramRoi(identity: DbIdentity): Promise<ProgramRoiListItem[]> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const progs = await tx
      .select({
        id: programs.id,
        name: programs.name,
        status: programs.status,
        achievedAt: programs.achievedAt,
      })
      .from(programs)
      .where(and(eq(programs.tenantId, t), eq(programs.programType, "Competency")))
      .orderBy(desc(programs.createdAt));
    if (progs.length === 0) return [];

    const ids = progs.map((p) => p.id);
    const opps = await tx
      .select({
        programId: opportunities.programId,
        stage: opportunities.stage,
        status: opportunities.status,
        amount: opportunities.amount,
        closeDate: opportunities.closeDate,
      })
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, t), inArray(opportunities.programId, ids)));

    const byProgram = new Map<string, { status: typeof opps[number]["status"]; stage: typeof opps[number]["stage"]; amount: number; closeDate: string | null }[]>();
    for (const o of opps) {
      if (!o.programId) continue;
      const arr = byProgram.get(o.programId) ?? [];
      arr.push({ status: o.status, stage: o.stage, amount: o.amount, closeDate: o.closeDate });
      byProgram.set(o.programId, arr);
    }

    return progs.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      achievedAt: p.achievedAt,
      roi: programRoi(byProgram.get(p.id) ?? [], p.achievedAt),
    }));
  });
}

export interface RoiOppRow {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly status: string;
  readonly amount: number;
  readonly closeDate: string | null;
  /** Won on/after the competency's achievement date (the conservative influence flag). */
  readonly influencedWon: boolean;
}

export interface ProgramRoiDetail {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly achievedAt: string | null;
  readonly roi: ProgramRoi;
  readonly opportunities: readonly RoiOppRow[];
  /** AWS teams behind this competency's attributed deals (by title + per rep). */
  readonly byRole: readonly RoleRollup[];
  readonly reps: readonly RepRollup[];
}

/** One competency's ROI + its attributed deals + the AWS segment/team that drove them.
 *  Returns null when the program is missing or is not a Competency. */
export async function loadProgramRoiDetail(
  identity: DbIdentity,
  programId: string,
): Promise<ProgramRoiDetail | null> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const [p] = await tx
      .select({
        id: programs.id,
        name: programs.name,
        programType: programs.programType,
        status: programs.status,
        achievedAt: programs.achievedAt,
      })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.tenantId, t)));
    if (!p || p.programType !== "Competency") return null;

    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountName: opportunities.accountName,
        stage: opportunities.stage,
        status: opportunities.status,
        amount: opportunities.amount,
        closeDate: opportunities.closeDate,
      })
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, t), eq(opportunities.programId, programId)))
      .orderBy(desc(opportunities.amount));

    const roi = programRoi(
      opps.map((o) => ({ status: o.status, stage: o.stage, amount: o.amount, closeDate: o.closeDate })),
      p.achievedAt,
    );
    const oppRows: RoiOppRow[] = opps.map((o) => ({
      id: o.id,
      name: o.name,
      stage: o.stage,
      status: o.status,
      amount: o.amount,
      closeDate: o.closeDate,
      influencedWon:
        p.achievedAt !== null &&
        o.status === "won" &&
        o.closeDate !== null &&
        o.closeDate >= p.achievedAt,
    }));

    // AWS segment/team slice: which AWS people / titles rode this competency's deals.
    let byRole: RoleRollup[] = [];
    let reps: RepRollup[] = [];
    if (opps.length > 0) {
      const oppIds = opps.map((o) => o.id);
      const edges = await tx
        .select({
          opportunityId: opportunityAwsTeam.opportunityId,
          relationshipId: opportunityAwsTeam.relationshipId,
          title: opportunityAwsTeam.title,
        })
        .from(opportunityAwsTeam)
        .where(and(eq(opportunityAwsTeam.tenantId, t), inArray(opportunityAwsTeam.opportunityId, oppIds)));
      const relIds = [...new Set(edges.map((e) => e.relationshipId))];
      const rels =
        relIds.length > 0
          ? await tx
              .select({
                id: aceRelationships.id,
                name: aceRelationships.name,
                email: aceRelationships.email,
                accountName: aceRelationships.accountName,
              })
              .from(aceRelationships)
              .where(and(eq(aceRelationships.tenantId, t), inArray(aceRelationships.id, relIds)))
          : [];
      const salesOpps: SalesOrgOpp[] = opps.map((o) => ({
        id: o.id,
        accountName: o.accountName,
        status: o.status,
        amount: o.amount,
      }));
      byRole = rollupByRole(edges, salesOpps);
      reps = prioritizeReps(repRollups(rels, edges, salesOpps, []));
    }

    return {
      id: p.id,
      name: p.name,
      status: p.status,
      achievedAt: p.achievedAt,
      roi,
      opportunities: oppRows,
      byRole,
      reps,
    };
  });
}
