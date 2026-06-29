import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import {
  competencyApplications,
  applicationControls,
  evidence,
  tenants,
  caseStudies,
  applicationCaseStudies,
  solutions,
  programs,
} from "@/db/schema";
import type { FillTarget } from "@/domain/applications/grid";
import type { MetSuggestion } from "@/domain/applications/schemas";
import type { TierId } from "@/domain/tiers/catalog";

/**
 * Read-only RLS loaders for the Competency Application list + detail pages.
 */

export interface ApplicationListItem {
  readonly id: string;
  readonly name: string;
  readonly competency: string;
  readonly programType: string;
  readonly status: string;
  readonly awsStatus: string;
  readonly controlCount: number;
  readonly acceptedCount: number;
  readonly sourceFileName: string;
  readonly createdAt: Date;
}

export async function loadApplications(identity: DbIdentity): Promise<ApplicationListItem[]> {
  return withTenant(identity, (tx) =>
    tx
      .select({
        id: competencyApplications.id,
        name: competencyApplications.name,
        competency: competencyApplications.competency,
        programType: competencyApplications.programType,
        status: competencyApplications.status,
        controlCount: competencyApplications.controlCount,
        acceptedCount: competencyApplications.acceptedCount,
        awsStatus: competencyApplications.awsStatus,
        sourceFileName: competencyApplications.sourceFileName,
        createdAt: competencyApplications.createdAt,
      })
      .from(competencyApplications)
      .where(eq(competencyApplications.tenantId, identity.tenantId))
      .orderBy(desc(competencyApplications.createdAt)),
  );
}

/** Applications linked to a specific adopted program (the program detail "Submit" panel). */
export async function loadApplicationsForProgram(
  identity: DbIdentity,
  programId: string,
): Promise<ApplicationListItem[]> {
  return withTenant(identity, (tx) =>
    tx
      .select({
        id: competencyApplications.id,
        name: competencyApplications.name,
        competency: competencyApplications.competency,
        programType: competencyApplications.programType,
        status: competencyApplications.status,
        controlCount: competencyApplications.controlCount,
        acceptedCount: competencyApplications.acceptedCount,
        awsStatus: competencyApplications.awsStatus,
        sourceFileName: competencyApplications.sourceFileName,
        createdAt: competencyApplications.createdAt,
      })
      .from(competencyApplications)
      .where(
        and(
          eq(competencyApplications.tenantId, identity.tenantId),
          eq(competencyApplications.programId, programId),
        ),
      )
      .orderBy(desc(competencyApplications.createdAt)),
  );
}

export interface ControlRow {
  readonly id: string;
  readonly sheetName: string;
  readonly controlId: string;
  readonly requirementText: string;
  readonly section: string;
  readonly responseTargets: readonly FillTarget[];
  readonly exampleResponse: string;
  readonly recommendedResponse: string;
  readonly metSuggestion: MetSuggestion;
  readonly aiConfidence: number;
  readonly aiReasoning: string;
  readonly linkedTitles: readonly string[];
  readonly status: string;
  /** Practice control (single response, no customer-reference) -> AI-draftable in v1. */
  readonly canGenerate: boolean;
}

export interface ApplicationDetail {
  readonly application: {
    readonly id: string;
    readonly name: string;
    readonly competency: string;
    readonly programType: string;
    readonly status: string;
    readonly controlCount: number;
    readonly acceptedCount: number;
    readonly sourceFileName: string;
    readonly categories: string;
    readonly pocName: string;
    readonly pocEmail: string;
    readonly pocRole: string;
    readonly awsStatus: string;
    readonly submittedAt: Date | null;
    readonly confirmedAt: Date | null;
    readonly solutionId: string | null;
    readonly solutionTitle: string | null;
    readonly programId: string | null;
    readonly programName: string | null;
  };
  readonly controls: readonly ControlRow[];
  readonly currentTier: TierId;
  readonly caseStudyCount: number;
  readonly attachedCaseStudies: readonly {
    readonly id: string;
    readonly title: string;
    readonly customerName: string;
  }[];
}

export async function loadApplicationDetail(
  identity: DbIdentity,
  id: string,
): Promise<ApplicationDetail | null> {
  return withTenant(identity, async (tx) => {
    const [application] = await tx
      .select({
        id: competencyApplications.id,
        name: competencyApplications.name,
        competency: competencyApplications.competency,
        programType: competencyApplications.programType,
        status: competencyApplications.status,
        controlCount: competencyApplications.controlCount,
        acceptedCount: competencyApplications.acceptedCount,
        categories: competencyApplications.categories,
        pocName: competencyApplications.pocName,
        pocEmail: competencyApplications.pocEmail,
        pocRole: competencyApplications.pocRole,
        awsStatus: competencyApplications.awsStatus,
        submittedAt: competencyApplications.submittedAt,
        confirmedAt: competencyApplications.confirmedAt,
        sourceFileName: competencyApplications.sourceFileName,
        solutionId: competencyApplications.solutionId,
        solutionTitle: solutions.title,
        programId: competencyApplications.programId,
        programName: programs.name,
      })
      .from(competencyApplications)
      .leftJoin(solutions, eq(solutions.id, competencyApplications.solutionId))
      .leftJoin(programs, eq(programs.id, competencyApplications.programId))
      .where(
        and(
          eq(competencyApplications.id, id),
          eq(competencyApplications.tenantId, identity.tenantId),
        ),
      );
    if (!application) return null;

    const rows = await tx
      .select({
        id: applicationControls.id,
        sheetName: applicationControls.sheetName,
        controlId: applicationControls.controlId,
        requirementText: applicationControls.requirementText,
        section: applicationControls.section,
        responseTarget: applicationControls.responseTarget,
        exampleResponse: applicationControls.exampleResponse,
        recommendedResponse: applicationControls.recommendedResponse,
        metSuggestion: applicationControls.metSuggestion,
        aiConfidence: applicationControls.aiConfidence,
        aiReasoning: applicationControls.aiReasoning,
        linkedEvidenceIds: applicationControls.linkedEvidenceIds,
        status: applicationControls.status,
      })
      .from(applicationControls)
      .where(
        and(
          eq(applicationControls.applicationId, id),
          eq(applicationControls.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(applicationControls.sheetName), asc(applicationControls.sequence));

    const ev = await tx
      .select({ id: evidence.id, title: evidence.title })
      .from(evidence)
      .where(eq(evidence.tenantId, identity.tenantId));
    const titleById = new Map(ev.map((e) => [e.id, e.title]));

    const controls: ControlRow[] = rows.map((c) => {
      const targets = (c.responseTarget as FillTarget[] | null) ?? [];
      const linkedIds = (c.linkedEvidenceIds as string[] | null) ?? [];
      return {
        id: c.id,
        sheetName: c.sheetName,
        controlId: c.controlId,
        requirementText: c.requirementText,
        section: c.section,
        responseTargets: targets,
        exampleResponse: c.exampleResponse,
        recommendedResponse: c.recommendedResponse,
        metSuggestion: c.metSuggestion as MetSuggestion,
        aiConfidence: c.aiConfidence,
        aiReasoning: c.aiReasoning,
        linkedTitles: linkedIds
          .map((eid) => titleById.get(eid))
          .filter((t): t is string => Boolean(t)),
        status: c.status,
        canGenerate: targets.length === 1 && targets[0]?.refLabel === undefined,
      };
    });

    const [tenant] = await tx
      .select({ tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId));

    const attached = await tx
      .select({
        id: caseStudies.id,
        title: caseStudies.title,
        customerName: caseStudies.customerName,
      })
      .from(applicationCaseStudies)
      .innerJoin(caseStudies, eq(caseStudies.id, applicationCaseStudies.caseStudyId))
      .where(
        and(
          eq(applicationCaseStudies.applicationId, id),
          eq(applicationCaseStudies.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(applicationCaseStudies.sequence));

    return {
      application,
      controls,
      currentTier: (tenant?.tier ?? "registered") as TierId,
      caseStudyCount: attached.length,
      attachedCaseStudies: attached,
    };
  });
}

export interface ProgramOption {
  readonly id: string;
  readonly name: string;
}

/** Adopted programs offered as link targets in the application packet editor. */
export async function loadAdoptedProgramOptions(identity: DbIdentity): Promise<ProgramOption[]> {
  return withTenant(identity, (tx) =>
    tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(eq(programs.tenantId, identity.tenantId))
      .orderBy(asc(programs.name)),
  );
}
