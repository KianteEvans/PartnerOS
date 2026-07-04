import { isOpen, type FundingSubmissionStatus } from "@/domain/funding/lifecycle";

/**
 * Pure triage views + search for the funding submissions tracker. Mirrors the MDF
 * views module: membership predicates per view, counts, and a case-insensitive
 * title/program search. No DB, no clock.
 */

export type FundingView = "all" | "mine" | "open" | "awaiting_decision" | "approved" | "rejected";

export const FUNDING_VIEWS: readonly FundingView[] = [
  "all",
  "mine",
  "open",
  "awaiting_decision",
  "approved",
  "rejected",
];

export const FUNDING_VIEW_LABELS: Record<FundingView, string> = {
  all: "All",
  mine: "My submissions",
  open: "Open",
  awaiting_decision: "Awaiting decision",
  approved: "Approved / funded",
  rejected: "Rejected",
};

export interface SubmissionRow {
  readonly status: FundingSubmissionStatus;
  readonly ownerUserId: string | null;
  readonly title: string;
  readonly programKey: string;
}

export interface ViewContext {
  readonly userId: string | null;
  readonly search?: string;
}

export function inView(r: SubmissionRow, view: FundingView, ctx: ViewContext): boolean {
  switch (view) {
    case "all":
      return true;
    case "mine":
      return r.ownerUserId !== null && r.ownerUserId === ctx.userId;
    case "open":
      return isOpen(r.status);
    case "awaiting_decision":
      return r.status === "submitted" || r.status === "in_review";
    case "approved":
      return r.status === "approved" || r.status === "funded";
    case "rejected":
      return r.status === "rejected";
  }
}

export function filterSubmissions<T extends SubmissionRow>(rows: readonly T[], view: FundingView, ctx: ViewContext): T[] {
  const q = (ctx.search ?? "").trim().toLowerCase();
  return rows.filter(
    (r) => inView(r, view, ctx) && (q === "" || r.title.toLowerCase().includes(q) || r.programKey.toLowerCase().includes(q)),
  );
}

export function viewCounts(rows: readonly SubmissionRow[], ctx: ViewContext): Record<FundingView, number> {
  const out = Object.fromEntries(FUNDING_VIEWS.map((v) => [v, 0])) as Record<FundingView, number>;
  for (const r of rows) {
    for (const v of FUNDING_VIEWS) if (inView(r, v, ctx)) out[v] += 1;
  }
  return out;
}
