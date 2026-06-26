import { and, asc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import {
  competencyApplications,
  applicationControls,
  storageObjects,
  applicationCaseStudies,
  caseStudies,
} from "@/db/schema";
import { assertObjectIsClean } from "@/storage/malware-scan";
import { getObjectStorage } from "@/storage/s3";
import { AppError } from "@/http/errors";
import { loadWorkbook, fillWorkbook, type CellFill } from "@/domain/applications/workbook";
import { buildCustomerExampleFills } from "@/domain/applications/customer-example";
import type { FillTarget } from "@/domain/applications/grid";

/**
 * Stream a FILLED copy of the uploaded workbook: the accepted/drafted Partner
 * Responses + Met? values written into the original via ExcelJS (preserving its
 * dropdowns + formatting). Fail-closed: the source bytes are read only after
 * assertObjectIsClean. Read-only GET (status is set by the markExported mutation).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const identity = await getServerIdentity();
    requirePermission(identity, "application:read");

    const loaded = await withTenant(identity, async (tx) => {
      const [app] = await tx
        .select({
          name: competencyApplications.name,
          competency: competencyApplications.competency,
          objectId: competencyApplications.sourceStorageObjectId,
          objectKey: storageObjects.objectKey,
        })
        .from(competencyApplications)
        .leftJoin(storageObjects, eq(storageObjects.id, competencyApplications.sourceStorageObjectId))
        .where(
          and(
            eq(competencyApplications.id, id),
            eq(competencyApplications.tenantId, identity.tenantId),
          ),
        );
      if (!app) return null;
      const controls = await tx
        .select({
          sheetName: applicationControls.sheetName,
          controlId: applicationControls.controlId,
          requirement: applicationControls.requirementText,
          responseTarget: applicationControls.responseTarget,
          recommendedResponse: applicationControls.recommendedResponse,
          metSuggestion: applicationControls.metSuggestion,
        })
        .from(applicationControls)
        .where(
          and(
            eq(applicationControls.applicationId, id),
            eq(applicationControls.tenantId, identity.tenantId),
          ),
        )
        .orderBy(asc(applicationControls.sequence));
      // Attached case studies, in reference-column order, for the customer-example sheets.
      const attached = await tx
        .select({
          aboutCustomer: caseStudies.aboutCustomer,
          challenge: caseStudies.challenge,
          goals: caseStudies.goals,
          solution: caseStudies.solution,
          outcomes: caseStudies.outcomes,
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
      return { app, controls, attached };
    });

    if (!loaded || !loaded.app.objectId || !loaded.app.objectKey) {
      return new Response("Not found", { status: 404 });
    }

    // Fail-closed: only read the uploaded bytes once scanned clean.
    await assertObjectIsClean(identity, loaded.app.objectId);
    const srcBytes = await getObjectStorage().get(loaded.app.objectKey);
    const wb = (await loadWorkbook(srcBytes)).wb;

    const fills: CellFill[] = [];
    // Practice controls: the single drafted Partner Response + Met?.
    for (const c of loaded.controls) {
      const target = ((c.responseTarget as FillTarget[] | null) ?? [])[0];
      if (!target || target.refLabel !== undefined) continue; // customer-example handled below
      if (c.recommendedResponse) {
        fills.push({ sheet: c.sheetName, cellAddress: target.responseAddress, value: c.recommendedResponse });
      }
      const metValue = c.metSuggestion === "yes" ? "Yes" : c.metSuggestion === "no" ? "No" : "";
      if (metValue) fills.push({ sheet: c.sheetName, cellAddress: target.metAddress, value: metValue });
    }
    // Customer-example sheets: fill each reference column from the attached case studies.
    fills.push(
      ...buildCustomerExampleFills(
        loaded.controls.map((c) => ({
          sheetName: c.sheetName,
          controlId: c.controlId,
          requirement: c.requirement,
          responseTargets: (c.responseTarget as FillTarget[] | null) ?? [],
        })),
        loaded.attached,
      ),
    );

    const outBytes = await fillWorkbook(wb, fills);
    const body = new ArrayBuffer(outBytes.byteLength);
    new Uint8Array(body).set(outBytes);

    const base =
      (loaded.app.competency || loaded.app.name || "competency")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim() || "competency";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${base}-self-assessment-filled.xlsx"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    const message = err instanceof AppError && err.expose ? err.message : "Error";
    return new Response(message, { status });
  }
}
