import { desc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { mdfRequests, users } from "@/db/schema";
import { roiMultiple, deadlineRisk, type MdfLike } from "@/domain/mdf/analytics";
import { AppError } from "@/http/errors";

/**
 * MDF portfolio export (CSV): every request with its stage amounts, ROI, and
 * deadline-risk flag plus the owner email. Read-only and tenant-scoped via RLS.
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "mdf:read");
    const today = new Date().toISOString().slice(0, 10);

    const rows = await withTenant(identity, (tx) =>
      tx
        .select({
          title: mdfRequests.title,
          activityType: mdfRequests.activityType,
          status: mdfRequests.status,
          ownerUserId: mdfRequests.ownerUserId,
          requestedAmount: mdfRequests.requestedAmount,
          approvedAmount: mdfRequests.approvedAmount,
          deployedAmount: mdfRequests.deployedAmount,
          claimedAmount: mdfRequests.claimedAmount,
          reimbursedAmount: mdfRequests.reimbursedAmount,
          expectedPipeline: mdfRequests.expectedPipeline,
          startDate: mdfRequests.startDate,
          endDate: mdfRequests.endDate,
          claimDeadline: mdfRequests.claimDeadline,
          opportunityRef: mdfRequests.opportunityRef,
          ownerEmail: users.email,
        })
        .from(mdfRequests)
        .leftJoin(users, eq(mdfRequests.ownerUserId, users.id))
        .where(eq(mdfRequests.tenantId, identity.tenantId))
        .orderBy(desc(mdfRequests.createdAt)),
    );

    const header = [
      "title", "activity_type", "status", "requested", "approved", "deployed",
      "claimed", "reimbursed", "expected_pipeline", "roi", "deadline_risk",
      "claim_deadline", "owner_email", "opportunity_ref",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.title,
          r.activityType,
          r.status,
          r.requestedAmount,
          r.approvedAmount ?? "",
          r.deployedAmount ?? "",
          r.claimedAmount ?? "",
          r.reimbursedAmount ?? "",
          r.expectedPipeline,
          roiMultiple(r as MdfLike) ?? "",
          deadlineRisk(r as MdfLike, today) ? "yes" : "no",
          r.claimDeadline ?? "",
          r.ownerEmail ?? "",
          r.opportunityRef ?? "",
        ].map(csvCell).join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="mdf-portfolio.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function csvCell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
