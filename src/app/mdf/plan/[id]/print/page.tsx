import type { CSSProperties, ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { loadPlanDetail, availableMdf } from "@/domain/mdf/plan-load";
import { coFunding, derivedDeadlines, planSummary } from "@/domain/mdf/compliance";
import { activityByKey } from "@/domain/mdf/activity-catalog";
import { PrintButton } from "@/app/plan/roadmaps/PrintButton";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

/**
 * Chrome-free AWS marketing-plan packet for a plan: print-isolation CSS hides the
 * app shell so only the packet prints. Mirrors the roadmap print view.
 */
const PRINT_CSS = `@media print { body * { visibility: hidden; } #mdf-plan-print, #mdf-plan-print * { visibility: visible; } #mdf-plan-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`;

const cell: CSSProperties = { borderBottom: "1px solid var(--border)", padding: "6px 8px", verticalAlign: "top" };
const th: CSSProperties = { textAlign: "left", borderBottom: "1px solid var(--border)", padding: "6px 8px", color: "var(--muted)", fontWeight: 600 };

export default async function MdfPlanPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("mdf");
  if (fenced) return <PackageFence feature="mdf" previewTier={fenced} />;
  const today = new Date().toISOString().slice(0, 10);

  const [detail, avail] = await Promise.all([loadPlanDetail(identity, id), availableMdf(identity, today)]);
  if (!detail) notFound();
  const { plan, items } = detail;
  const summary = planSummary(items, avail.available, today);

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />
      </div>
      <div id="mdf-plan-print">
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>AWS Marketing Plan — {plan.title}</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 6px", fontSize: 13 }}>
          {items.length} event{items.length === 1 ? "" : "s"} · Eligible AWS ask {money(summary.eligibleAsk)} of {money(avail.available)} available · Projected pipeline {money(summary.projectedPipeline)}
        </p>
        {plan.notes && <p style={{ fontSize: 14, margin: "0 0 16px" }}>{plan.notes}</p>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["#", "Event", "Dates", "Total", "AWS ask", "Exp. opps", "Submit by", "Claim by"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const act = activityByKey(it.catalogKey);
              const ask = coFunding(it.totalCost, it.coFundPct).amountToClaim;
              const { submitBy, claimBy } = derivedDeadlines(it.startDate, it.endDate);
              return (
                <tr key={it.id}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>
                    <strong>{it.title}</strong>
                    {act ? ` · ${act.label}${act.eligibility === "ineligible" ? " (ineligible)" : ""}` : ""}
                    {it.description && <div style={{ color: "var(--muted)", fontSize: 12 }}>{it.description}</div>}
                  </td>
                  <td style={cell}>{it.startDate ?? "—"}{it.endDate ? ` → ${it.endDate}` : ""}</td>
                  <td style={cell}>{money(it.totalCost)}</td>
                  <td style={cell}>{money(ask)} ({it.coFundPct}%)</td>
                  <td style={cell}>{it.expectedOpportunities}</td>
                  <td style={cell}>{submitBy ?? "—"}</td>
                  <td style={cell}>{claimBy ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
