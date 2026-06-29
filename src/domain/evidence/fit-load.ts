import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity, TenantDb } from "@/db/client";
import { caseStudies, evidence, programs } from "@/db/schema";
import { caseStudyCompleteness } from "@/domain/case-studies/aspects";
import {
  rankProgramFit,
  fitSummary,
  type EvidenceSignal,
  type ProgramFit,
  type FitSummary,
} from "@/domain/evidence/fit";

/**
 * Project a tenant's evidence rows into the signals the pure fit engine consumes.
 * Extracted so the competency recommender's loader reuses the exact same projection
 * (one definition of "evidence -> signals"). Caller supplies the RLS-scoped tx.
 *
 * A customer case study IS evidence: a fully-drafted one is reusable proof that
 * satisfies the customer-reference requirements many AWS programs ask for. So each
 * complete case study (all five narrative aspects filled) is projected as an approved
 * `case_study` signal here — the locker credits them toward coverage like any artifact.
 */
export async function selectFitSignals(tx: TenantDb, tenantId: string): Promise<EvidenceSignal[]> {
  const rows = await tx
    .select({
      evidenceType: evidence.evidenceType,
      status: evidence.status,
      program: evidence.program,
      expirationDate: evidence.expirationDate,
      qualityScore: evidence.qualityScore,
      reusable: evidence.reusable,
    })
    .from(evidence)
    .where(eq(evidence.tenantId, tenantId));
  const evidenceSignals: EvidenceSignal[] = rows.map((r) => ({
    evidenceType: r.evidenceType,
    status: r.status,
    program: r.program,
    expirationDate: r.expirationDate,
    qualityScore: r.qualityScore,
    reusable: r.reusable,
  }));

  const studies = await tx
    .select({
      aboutCustomer: caseStudies.aboutCustomer,
      challenge: caseStudies.challenge,
      goals: caseStudies.goals,
      solution: caseStudies.solution,
      outcomes: caseStudies.outcomes,
    })
    .from(caseStudies)
    .where(eq(caseStudies.tenantId, tenantId));
  const caseStudySignals: EvidenceSignal[] = studies
    .filter((s) => {
      const c = caseStudyCompleteness(s);
      return c.filled === c.total;
    })
    .map(() => ({
      evidenceType: "case_study",
      status: "approved",
      program: null,
      expirationDate: null,
      qualityScore: null,
      reusable: true,
    }));

  return [...evidenceSignals, ...caseStudySignals];
}

/**
 * Read-only loader for the Evidence Locker "Program Fit" dashboard: gather the
 * tenant's evidence in one RLS transaction, project it to the signals the pure fit
 * engine wants, note which programs are already adopted (so the UI can mark/skip
 * them), and run the ranking. No mutations — fit is a derived surface. `today` is a
 * parameter (the page passes it) so the engine stays clock-free and testable.
 */

export interface ProgramFitView {
  readonly fits: readonly ProgramFit[];
  readonly summary: FitSummary;
  readonly adoptedKeys: ReadonlySet<string>; // programs.libraryKey already in portfolio
  readonly hasEvidence: boolean;
}

export async function loadProgramFit(
  identity: DbIdentity,
  today: string,
): Promise<ProgramFitView> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    const signals = await selectFitSignals(tx, t);

    const adopted = await tx
      .select({ libraryKey: programs.libraryKey })
      .from(programs)
      .where(eq(programs.tenantId, t));

    const fits = rankProgramFit(signals, today);
    return {
      fits,
      summary: fitSummary(fits),
      adoptedKeys: new Set(adopted.map((a) => a.libraryKey)),
      hasEvidence: signals.length > 0,
    };
  });
}
