import { and, eq } from "drizzle-orm";
import { withTenant, type DbIdentity, type TenantDb } from "@/db/client";
import { caseStudies, opportunities, opportunityCaseStudies, programs, solutions } from "@/db/schema";
import { caseStudyCompleteness } from "@/domain/case-studies/aspects";
import {
  matchCaseStudies,
  type MatchOpp,
  type ScoredCaseStudy,
} from "@/domain/ace/case-study-match";

/**
 * The case-study leg of the Deal Desk: gather the tenant's library + the deal's
 * pinned links + the opportunity's linked solution/program text, then run the
 * pure matcher. Takes the caller's transaction (loadDealDesk composes it inside
 * its own withTenant); `loadPitchContext` wraps it for the AI pitch action,
 * which must re-derive matches server-side rather than trust client text.
 */

export interface CaseStudyLegOpp {
  readonly name: string;
  readonly accountName: string;
  readonly nextStep: string;
  readonly awsNextBestActions: string;
  readonly solutionId: string | null;
  readonly programId: string | null;
}

export interface CaseStudyLeg {
  readonly matches: ScoredCaseStudy[];
  readonly libraryCount: number;
  /** The exact matcher input — reused verbatim as the AI pitch grounding. */
  readonly oppInput: MatchOpp;
}

export async function loadCaseStudyLeg(
  tx: TenantDb,
  tenantId: string,
  oppId: string,
  opp: CaseStudyLegOpp,
): Promise<CaseStudyLeg> {
  let solutionText = "";
  if (opp.solutionId) {
    const [s] = await tx
      .select({
        title: solutions.title,
        description: solutions.description,
        sellingProposition: solutions.sellingProposition,
      })
      .from(solutions)
      .where(and(eq(solutions.id, opp.solutionId), eq(solutions.tenantId, tenantId)));
    if (s) solutionText = `${s.title} ${s.description} ${s.sellingProposition}`;
  }

  let programText = "";
  if (opp.programId) {
    const [p] = await tx
      .select({ name: programs.name, programType: programs.programType })
      .from(programs)
      .where(and(eq(programs.id, opp.programId), eq(programs.tenantId, tenantId)));
    if (p) programText = `${p.name} ${p.programType}`;
  }

  const studies = await tx
    .select({
      id: caseStudies.id,
      title: caseStudies.title,
      customerName: caseStudies.customerName,
      aboutCustomer: caseStudies.aboutCustomer,
      challenge: caseStudies.challenge,
      goals: caseStudies.goals,
      solution: caseStudies.solution,
      outcomes: caseStudies.outcomes,
      evidenceId: caseStudies.evidenceId,
    })
    .from(caseStudies)
    .where(eq(caseStudies.tenantId, tenantId));

  const attachedRows = await tx
    .select({ caseStudyId: opportunityCaseStudies.caseStudyId })
    .from(opportunityCaseStudies)
    .where(
      and(
        eq(opportunityCaseStudies.tenantId, tenantId),
        eq(opportunityCaseStudies.opportunityId, oppId),
      ),
    );
  const attachedIds = new Set(attachedRows.map((r) => r.caseStudyId));

  const oppInput: MatchOpp = {
    name: opp.name,
    accountName: opp.accountName,
    nextStep: opp.nextStep,
    awsNextBestActions: opp.awsNextBestActions,
    solutionText,
    programText,
  };

  const matches = matchCaseStudies(
    oppInput,
    studies.map((cs) => ({
      id: cs.id,
      title: cs.title,
      customerName: cs.customerName,
      aspectsText: `${cs.aboutCustomer} ${cs.challenge} ${cs.goals} ${cs.solution} ${cs.outcomes}`,
      completenessPercent: caseStudyCompleteness(cs).percent,
      hasEvidence: cs.evidenceId !== null,
    })),
    attachedIds,
  );

  return { matches, libraryCount: studies.length, oppInput };
}

/** Standalone context for the AI pitch action (own transaction; null when the opp is not in the tenant). */
export async function loadPitchContext(
  identity: DbIdentity,
  oppId: string,
): Promise<(CaseStudyLeg & { oppName: string; stage: string; amount: number }) | null> {
  return withTenant(identity, async (tx) => {
    const [opp] = await tx
      .select({
        name: opportunities.name,
        accountName: opportunities.accountName,
        nextStep: opportunities.nextStep,
        awsNextBestActions: opportunities.awsNextBestActions,
        solutionId: opportunities.solutionId,
        programId: opportunities.programId,
        stage: opportunities.stage,
        amount: opportunities.amount,
      })
      .from(opportunities)
      .where(and(eq(opportunities.id, oppId), eq(opportunities.tenantId, identity.tenantId)));
    if (!opp) return null;
    const leg = await loadCaseStudyLeg(tx, identity.tenantId, oppId, opp);
    return { ...leg, oppName: opp.name, stage: opp.stage, amount: opp.amount };
  });
}
