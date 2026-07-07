import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FundingNav } from "@/app/funding/FundingNav";
import { ApplyDrawer } from "@/app/funding/ApplyDrawer";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/list-view";
import { loadSubmissions, type SubmissionRow } from "@/domain/funding/load";
import { portfolioSummary } from "@/domain/funding/analytics";
import { inView, FUNDING_VIEWS, FUNDING_VIEW_LABELS, viewCounts, type FundingView } from "@/domain/funding/views";
import { FUNDING_STATUS_LABELS, type FundingSubmissionStatus } from "@/domain/funding/lifecycle";
import { getFundingProgram } from "@/domain/funding/catalog";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


const STATUS_TONE: Record<FundingSubmissionStatus, "neutral" | "info" | "ok" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  in_review: "info",
  approved: "ok",
  funded: "ok",
  rejected: "danger",
  withdrawn: "neutral",
};

const SORTABLE = ["title", "status", "requested", "deadline", "created"];

export default async function FundingSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("funding");
  if (fenced) return <PackageFence feature="funding" previewTier={fenced} />;
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const all = await loadSubmissions(identity);
  const view: FundingView = FUNDING_VIEWS.includes(sp.view as FundingView) ? (sp.view as FundingView) : "all";
  const ctx = { userId: identity.userId };
  const inScope = all.filter((r) => inView(r, view, ctx));

  const params = parseListParams(sp, { sortable: SORTABLE, defaultSort: "created", defaultDir: "desc" });
  const { rows, total } = tableView(inScope, params, {
    search: (r) => `${r.title} ${r.programKey}`,
    comparators: {
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => a.status.localeCompare(b.status),
      requested: (a, b) => a.requestedAmount - b.requestedAmount,
      deadline: (a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
      created: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    },
  });

  const summary = portfolioSummary(
    all.map((r) => ({ status: r.status, fundingType: r.fundingType, requestedAmount: r.requestedAmount, approvedAmount: r.approvedAmount, deadline: r.deadline })),
    today,
  );
  const counts = viewCounts(all, ctx);

  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/funding/submissions", {
        view,
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
      }),
  };

  const columns: Column<SubmissionRow>[] = [
    {
      key: "title",
      header: "Submission",
      sortKey: "title",
      render: (r) => (
        <Link href={`/funding/submissions/${r.id}`} style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>
          {r.title}
        </Link>
      ),
    },
    { key: "program", header: "Program", render: (r) => getFundingProgram(r.programKey)?.name ?? r.programKey },
    { key: "status", header: "Status", sortKey: "status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{FUNDING_STATUS_LABELS[r.status]}</Badge> },
    { key: "type", header: "Type", render: (r) => (r.fundingType === "credits" ? "Credits" : "Cash") },
    { key: "requested", header: "Requested", align: "right", sortKey: "requested", render: (r) => money(r.requestedAmount) },
    { key: "deadline", header: "Deadline", sortKey: "deadline", render: (r) => r.deadline ?? "—" },
  ];

  return (
    <PageShell>
      <PageHeader title="Funding submissions" subtitle="Apply for AWS funding and track each application through approval." actions={<ApplyDrawer triggerLabel="New submission" />} />
      <FundingNav />

      <MetricStrip>
        <MetricCard label="Open" value={String(summary.open)} sub="in flight" />
        <MetricCard label="Approved / funded" value={String(summary.approved)} tone="ok" sub={`${summary.funded} funded`} />
        <MetricCard label="Requested" value={money(summary.requested)} sub={`${money(summary.approvedAmount)} approved`} />
        <MetricCard label="At deadline" value={String(summary.atDeadline)} tone={summary.atDeadline > 0 ? "danger" : "neutral"} sub="within 30 days" />
      </MetricStrip>

      <SegmentedControl
        options={FUNDING_VIEWS.map((v) => ({ value: v, label: `${FUNDING_VIEW_LABELS[v]} (${counts[v]})` }))}
        value={view}
        hrefFor={(v) => listHref("/funding/submissions", { view: v, q: params.q })}
        size="sm"
      />

      <SavedViewsBar listKey="funding_submissions" current={{ view, q: params.q, sort: params.sort, dir: params.dir }} />
      <SearchForm q={params.q} placeholder="Search submissions…" hidden={{ view }} />

      <Table columns={columns} rows={rows} rowKey={(r) => r.id} empty="No submissions in this view yet." sort={sortState} />

      <Pagination
        page={params.page}
        totalPages={pageCount(total, params.pageSize)}
        total={total}
        prevHref={listHref("/funding/submissions", { view, q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
        nextHref={listHref("/funding/submissions", { view, q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
      />
    </PageShell>
  );
}
