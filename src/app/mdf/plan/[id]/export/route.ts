import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { loadPlanDetail } from "@/domain/mdf/plan-load";
import { coFunding, derivedDeadlines } from "@/domain/mdf/compliance";
import { activityByKey } from "@/domain/mdf/activity-catalog";
import { AppError } from "@/http/errors";

/**
 * Marketing-plan export (CSV): one row per planned event with the AWS marketing-plan
 * fields (activity, SPMS ID, dates, total cost + amount to claim, description,
 * expected opportunities) plus the derived submit-by / claim-by deadlines. Read-only,
 * tenant-scoped via RLS; gated by mdf:read.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const identity = await getServerIdentity();
    requirePermission(identity, "mdf:read");

    const detail = await loadPlanDetail(identity, id);
    if (!detail) return new Response("Not found", { status: 404 });

    const header = [
      "title", "activity", "eligibility", "spms_id", "start_date", "end_date",
      "total_cost", "amount_to_claim", "co_fund_pct", "expected_pipeline",
      "expected_opportunities", "description", "submit_by", "claim_by",
    ];
    const lines = [header.join(",")];
    for (const it of detail.items) {
      const act = activityByKey(it.catalogKey);
      const ask = coFunding(it.totalCost, it.coFundPct).amountToClaim;
      const { submitBy, claimBy } = derivedDeadlines(it.startDate, it.endDate);
      lines.push(
        [
          it.title,
          act?.label ?? "",
          act?.eligibility ?? "",
          it.spmsId ?? "",
          it.startDate ?? "",
          it.endDate ?? "",
          it.totalCost,
          ask,
          it.coFundPct,
          it.expectedPipeline,
          it.expectedOpportunities,
          it.description,
          submitBy ?? "",
          claimBy ?? "",
        ].map(csvCell).join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="marketing-plan-${id}.csv"`,
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
