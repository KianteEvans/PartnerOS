import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { caseStudies, evidence } from "@/db/schema";
import { caseStudyCompleteness } from "@/domain/case-studies/aspects";

/** Read-only loaders for the Case Studies pages. RLS-scoped. */

export interface CaseStudyListItem {
  readonly id: string;
  readonly title: string;
  readonly customerName: string;
  readonly visibility: string;
  readonly anonymized: boolean;
  readonly filled: number;
  readonly total: number;
}

export async function loadCaseStudies(identity: DbIdentity): Promise<CaseStudyListItem[]> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        id: caseStudies.id,
        title: caseStudies.title,
        customerName: caseStudies.customerName,
        visibility: caseStudies.visibility,
        anonymized: caseStudies.anonymized,
        aboutCustomer: caseStudies.aboutCustomer,
        challenge: caseStudies.challenge,
        goals: caseStudies.goals,
        solution: caseStudies.solution,
        outcomes: caseStudies.outcomes,
      })
      .from(caseStudies)
      .where(eq(caseStudies.tenantId, identity.tenantId))
      .orderBy(desc(caseStudies.createdAt));
    return rows.map((r) => {
      const c = caseStudyCompleteness(r);
      return {
        id: r.id,
        title: r.title,
        customerName: r.customerName,
        visibility: r.visibility,
        anonymized: r.anonymized,
        filled: c.filled,
        total: c.total,
      };
    });
  });
}

export interface CaseStudyDetail {
  readonly id: string;
  readonly title: string;
  readonly customerName: string;
  readonly visibility: string;
  readonly anonymized: boolean;
  readonly url: string;
  readonly aboutCustomer: string;
  readonly challenge: string;
  readonly goals: string;
  readonly solution: string;
  readonly outcomes: string;
  readonly evidenceId: string | null;
  readonly evidenceTitle: string | null;
}

export async function loadCaseStudyDetail(
  identity: DbIdentity,
  id: string,
): Promise<CaseStudyDetail | null> {
  return withTenant(identity, async (tx) => {
    const [cs] = await tx
      .select({
        id: caseStudies.id,
        title: caseStudies.title,
        customerName: caseStudies.customerName,
        visibility: caseStudies.visibility,
        anonymized: caseStudies.anonymized,
        url: caseStudies.url,
        aboutCustomer: caseStudies.aboutCustomer,
        challenge: caseStudies.challenge,
        goals: caseStudies.goals,
        solution: caseStudies.solution,
        outcomes: caseStudies.outcomes,
        evidenceId: caseStudies.evidenceId,
        evidenceTitle: evidence.title,
      })
      .from(caseStudies)
      .leftJoin(evidence, eq(evidence.id, caseStudies.evidenceId))
      .where(and(eq(caseStudies.id, id), eq(caseStudies.tenantId, identity.tenantId)));
    return cs ?? null;
  });
}

export interface EvidenceOption {
  readonly id: string;
  readonly title: string;
}

export async function loadEvidenceOptions(identity: DbIdentity): Promise<EvidenceOption[]> {
  return withTenant(identity, (tx) =>
    tx
      .select({ id: evidence.id, title: evidence.title })
      .from(evidence)
      .where(eq(evidence.tenantId, identity.tenantId))
      .orderBy(desc(evidence.createdAt)),
  );
}
