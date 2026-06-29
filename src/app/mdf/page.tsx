import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { mdfRequests } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Badge, statusTone } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { RingGauge } from "@/components/ui/RingGauge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Callout } from "@/components/ui/Callout";
import { DeltaChip } from "@/components/ui/DeltaChip";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import {
  createMdfRequest,
  bulkApproveMdf,
  bulkRejectMdf,
  createMdfBudget,
  updateMdfBudget,
} from "@/domain/mdf/actions";
import { MDF_STATUS_LABELS, type MdfStatus } from "@/domain/mdf/lifecycle";
import {
  portfolioSummary,
  deadlineRisk,
  reimbursementRate,
  summaryByActivity,
  type MdfLike,
} from "@/domain/mdf/analytics";
import {
  MDF_VIEWS,
  MDF_VIEW_LABELS,
  isMdfView,
  filterRequests,
  sortRequests,
  viewCounts,
  type MdfView,
  type MdfSort,
} from "@/domain/mdf/views";
import { budgetStatus, committedInPeriod } from "@/domain/mdf/budget";
import { captureMdfSnapshot, loadMdfTrends, loadActiveBudget } from "@/domain/mdf/load";
import { APPROVED_ACTIVITIES, INELIGIBLE_ACTIVITIES } from "@/domain/mdf/activity-catalog";
import { MdfNav } from "@/app/mdf/MdfNav";
import { trendDelta } from "@/domain/trend";
import { addDays } from "@/domain/dates";
import { parseListParams, listHref, pageCount } from "@/domain/list";

const SECTION = "var(--section-accent)";

const ACTIVITY_LABELS: Record<string, string> = {
  event: "Event",
  campaign: "Campaign",
  content: "Content",
  enablement: "Enablement",
  other: "Other",
};
const ACTIVITY_FILTERS = ["all", "event", "campaign", "content", "enablement", "other"] as const;

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;
const secondaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
} as const;

const money = (n: number | null): string => (n == null ? "—" : `$${n.toLocaleString()}`);

function pillStyle(active: boolean, secondary = false): CSSProperties {
  return {
    padding: secondary ? "4px 10px" : "6px 12px",
    borderRadius: 999,
    fontSize: secondary ? 12 : 13,
    textDecoration: "none",
    border: "1px solid var(--border)",
    background: active ? SECTION : "transparent",
    color: active ? "var(--accent-ink)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
  };
}

export default async function MdfPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: MdfView = isMdfView(viewParam) ? viewParam : "all";
  const activityParam = Array.isArray(sp.activity) ? sp.activity[0] : sp.activity;
  const activity =
    activityParam && (ACTIVITY_FILTERS as readonly string[]).includes(activityParam)
      ? activityParam
      : "all";
  const params = parseListParams(sp, {
    sortable: ["created", "title", "status", "requested", "approved", "deadline"],
    defaultSort: "created",
  });

  // The overview aggregates the whole portfolio and the list filters/sorts it in
  // memory, so a single tenant-scoped read serves both (accurate per-view counts).
  const allRows = await withTenant(identity, (tx) =>
    tx.select().from(mdfRequests).where(eq(mdfRequests.tenantId, identity.tenantId)),
  );

  const summary = portfolioSummary(allRows as MdfLike[], today);

  // Best-effort daily snapshot for the hero sparklines, then read the series back.
  await captureMdfSnapshot(identity, summary, today).catch(() => undefined);
  const trends = await loadMdfTrends(identity).catch(() => ({
    reimbursementPct: [] as number[],
    reimbursed: [] as number[],
    remaining: [] as number[],
    openCount: [] as number[],
  }));
  const budget = await loadActiveBudget(identity, today).catch(() => null);

  const ctx = { userId: identity.userId, today };
  const counts = viewCounts(allRows as MdfLike[], ctx);
  const filtered = sortRequests(
    filterRequests(allRows, { view, activity, q: params.q }, ctx),
    params.sort as MdfSort,
    params.dir,
  );
  const total = filtered.length;
  const totalPages = pageCount(total, params.pageSize);
  const pageRows = filtered.slice(params.offset, params.offset + params.pageSize);

  const activitySummary = summaryByActivity(allRows as (MdfLike & { activityType: string })[]);
  const canApprove = can(identity.role, "mdf:approve");

  const committed = budget
    ? committedInPeriod(
        allRows.map((r) => ({
          status: r.status,
          approvedAmount: r.approvedAmount,
          startDate: r.startDate,
          createdAt: r.createdAt.toISOString().slice(0, 10),
        })),
        budget.periodStart,
        budget.periodEnd,
      )
    : 0;
  const bs = budget ? budgetStatus(budget.amount, committed) : null;

  const activeQ = activity === "all" ? "" : activity;
  const reimbDelta = trendDelta(trends.reimbursementPct);

  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/mdf", {
        view,
        activity: activeQ,
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
      }),
  };

  const table = (
    <Table
      rows={pageRows}
      rowKey={(r) => r.id}
      sort={sortState}
      empty={params.q ? `No requests match “${params.q}”.` : "No MDF requests in this view."}
      columns={[
        {
          key: "title",
          header: "Title",
          sortKey: "title",
          render: (r) => (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {canApprove ? <BulkCheckbox id={r.id} /> : null}
              <Link href={`/mdf/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                {r.title}
              </Link>
            </span>
          ),
        },
        {
          key: "activity",
          header: "Activity",
          render: (r) => <Badge tone="info">{ACTIVITY_LABELS[r.activityType] ?? r.activityType}</Badge>,
        },
        {
          key: "status",
          header: "Status",
          sortKey: "status",
          render: (r) => <Badge tone={statusTone(r.status)}>{MDF_STATUS_LABELS[r.status as MdfStatus]}</Badge>,
        },
        { key: "requested", header: "Requested", align: "right", sortKey: "requested", render: (r) => money(r.requestedAmount) },
        { key: "approved", header: "Approved", align: "right", sortKey: "approved", render: (r) => money(r.approvedAmount) },
        {
          key: "deadline",
          header: "Claim by",
          sortKey: "deadline",
          render: (r) =>
            r.claimDeadline ? (
              <span style={{ color: deadlineRisk(r as MdfLike, today) ? "var(--danger)" : "var(--muted)" }}>
                {r.claimDeadline}
              </span>
            ) : (
              "—"
            ),
        },
      ]}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="MDF Management"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/mdf/export" style={secondaryBtn} prefetch={false}>
              Export CSV
            </Link>
            <FormDrawer
              triggerLabel="New request"
              title="New MDF request"
              action={createMdfRequest}
              submitLabel="Create request"
              successMessage="MDF request created."
            >
              <label style={labelStyle}>
                <span style={spanStyle}>Title</span>
                <input name="title" required maxLength={200} style={controlStyle} />
              </label>
              <label style={labelStyle}>
                <span style={spanStyle}>Activity</span>
                <select name="activityType" defaultValue="campaign" style={controlStyle}>
                  <option value="event">Event</option>
                  <option value="campaign">Campaign</option>
                  <option value="content">Content</option>
                  <option value="enablement">Enablement</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span style={spanStyle}>Requested amount ($)</span>
                <input name="requestedAmount" type="number" min={0} defaultValue={0} style={controlStyle} />
              </label>
              <label style={labelStyle}>
                <span style={spanStyle}>Expected pipeline ($)</span>
                <input name="expectedPipeline" type="number" min={0} defaultValue={0} style={controlStyle} />
              </label>
              <label style={labelStyle}><span style={spanStyle}>Start</span><input name="startDate" type="date" style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>End</span><input name="endDate" type="date" style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Claim deadline</span><input name="claimDeadline" type="date" style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Opportunity ref</span><input name="opportunityRef" maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>AWS activity (optional — grounds compliance)</span>
                <select name="catalogKey" defaultValue="" style={controlStyle}>
                  <option value="">— None —</option>
                  <optgroup label="Approved">
                    {APPROVED_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </optgroup>
                  <optgroup label="Ineligible (blocks submission)">
                    {INELIGIBLE_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Total activity cost ($, optional)</span><input name="totalCost" type="number" min={0} style={controlStyle} /></label>
            </FormDrawer>
          </div>
        }
      />
      <MdfNav />

      {/* Health hero: reimbursement completion + headline funding KPIs with trend. */}
      <section
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
          background: "var(--surface-hero)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 150 }}>
          <RingGauge value={reimbursementRate(summary)} color="var(--ok)" caption="reimbursed" size={120} />
          {reimbDelta !== null ? <DeltaChip delta={reimbDelta} suffix="%" /> : <span style={{ fontSize: 12, color: "var(--muted)" }}>of approved funds</span>}
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <MetricStrip min={130}>
            <MetricCard label="Approved" value={money(summary.approved)} />
            <MetricCard
              label="Reimbursed"
              value={money(summary.reimbursed)}
              tone="ok"
              {...(trends.reimbursed.length >= 2
                ? { trend: { values: trends.reimbursed, delta: trendDelta(trends.reimbursed) } }
                : {})}
            />
            <MetricCard
              label="Pending claim"
              value={money(summary.remaining)}
              tone={summary.remaining > 0 ? "warn" : "neutral"}
              {...(trends.remaining.length >= 2
                ? { trend: { values: trends.remaining, delta: trendDelta(trends.remaining), invert: true } }
                : {})}
            />
            <MetricCard label="Expected pipeline" value={money(summary.pipeline)} />
            <MetricCard label="Avg ROI" value={summary.roi == null ? "—" : `${summary.roi}x`} tone="accent" />
            <MetricCard
              label="Open"
              value={String(summary.openCount)}
              {...(trends.openCount.length >= 2
                ? { trend: { values: trends.openCount, delta: trendDelta(trends.openCount), invert: true } }
                : {})}
            />
            <MetricCard
              label="Deadline risks"
              value={String(summary.deadlineRisks)}
              tone={summary.deadlineRisks > 0 ? "danger" : "neutral"}
              {...(summary.deadlineRisks > 0 ? { tint: "danger" as const } : {})}
            />
          </MetricStrip>
        </div>
      </section>

      {/* Budget allocation vs committed funds for the active period. */}
      <Panel
        title="Budget"
        accent={SECTION}
        actions={
          canApprove ? (
            budget ? (
              <FormDrawer
                triggerLabel="Edit budget"
                triggerVariant="secondary"
                title="Edit MDF budget"
                action={updateMdfBudget}
                submitLabel="Save budget"
                submitVariant="secondary"
                successMessage="Budget updated."
                hidden={{ budgetId: budget.id }}
              >
                <BudgetFields defaults={budget} today={today} />
              </FormDrawer>
            ) : (
              <FormDrawer
                triggerLabel="Set budget"
                title="Set MDF budget"
                action={createMdfBudget}
                submitLabel="Set budget"
                successMessage="Budget set."
              >
                <BudgetFields defaults={null} today={today} />
              </FormDrawer>
            )
          ) : undefined
        }
      >
        {budget && bs ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>
                {budget.periodLabel} · {budget.periodStart} → {budget.periodEnd}
              </span>
              <span>
                <strong>{money(bs.committed)}</strong> committed of {money(bs.allocated)}
              </span>
            </div>
            <div
              style={{
                height: 12,
                borderRadius: 999,
                overflow: "hidden",
                background: "color-mix(in srgb, var(--text) 8%, transparent)",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, bs.percent)}%`,
                  height: "100%",
                  background: bs.over
                    ? "var(--danger)"
                    : `linear-gradient(90deg, ${SECTION}, color-mix(in srgb, ${SECTION} 55%, #fff))`,
                }}
              />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {bs.remaining >= 0
                ? `${money(bs.remaining)} remaining · ${bs.percent}% committed`
                : `${money(-bs.remaining)} over budget · ${bs.percent}% committed`}
            </div>
            {bs.over ? (
              <Callout tone="danger" title="Over budget">
                Committed MDF exceeds this period&rsquo;s allocation by {money(bs.committed - bs.allocated)}.
              </Callout>
            ) : null}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            No budget set for the current period.
            {canApprove ? " Set one to track committed funds against an allocation." : ""}
          </p>
        )}
      </Panel>

      {/* Where the money goes: approved spend per activity type + per-type ROI. */}
      <Panel title="Spend by activity type" accent={SECTION}>
        {activitySummary.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No requests yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <BarChart
              max={Math.max(1, ...activitySummary.map((a) => a.approved))}
              data={activitySummary.map((a) => ({
                label: ACTIVITY_LABELS[a.activityType] ?? a.activityType,
                value: a.approved,
                display: money(a.approved),
                color: SECTION,
              }))}
            />
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)" }}>
              {activitySummary.map((a) => (
                <span key={a.activityType}>
                  <strong style={{ color: "var(--text)" }}>{ACTIVITY_LABELS[a.activityType] ?? a.activityType}</strong>{" "}
                  {a.roi == null ? "—" : `${a.roi}x`} ROI · {a.count} {a.count === 1 ? "request" : "requests"}
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Reconciliation funnel">
        {/* Funnel: each lifecycle stage as a share of the total requested. */}
        <BarChart
          max={summary.requested}
          data={[
            { label: "Requested", value: summary.requested, display: money(summary.requested), color: "var(--info)" },
            { label: "Approved", value: summary.approved, display: money(summary.approved), color: "var(--accent)" },
            { label: "Deployed", value: summary.deployed, display: money(summary.deployed), color: "var(--accent)" },
            { label: "Claimed", value: summary.claimed, display: money(summary.claimed), color: "var(--warn)" },
            { label: "Reimbursed", value: summary.reimbursed, display: money(summary.reimbursed), color: "var(--ok)" },
          ]}
        />
      </Panel>

      {/* Triage controls: status views (primary) + activity-type filter (secondary). */}
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MDF_VIEWS.map((v) => (
              <Link
                key={v}
                href={listHref("/mdf", { view: v, activity: activeQ, q: params.q })}
                style={pillStyle(v === view)}
              >
                {MDF_VIEW_LABELS[v]} ({counts[v]})
              </Link>
            ))}
          </nav>
          <SearchForm
            q={params.q}
            placeholder="Search by title…"
            hidden={{ view, ...(activity !== "all" ? { activity } : {}), sort: params.sort, dir: params.dir }}
          />
        </div>
        <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Activity:</span>
          {ACTIVITY_FILTERS.map((a) => (
            <Link
              key={a}
              href={listHref("/mdf", { view, activity: a === "all" ? "" : a, q: params.q })}
              style={pillStyle(a === activity, true)}
            >
              {a === "all" ? "All" : ACTIVITY_LABELS[a]}
            </Link>
          ))}
        </nav>
      </div>

      <SavedViewsBar
        listKey="mdf"
        current={{ view, ...(activity !== "all" ? { activity } : {}), q: params.q, sort: params.sort, dir: params.dir }}
      />

      <Panel title={`Requests (${total})`}>
        {canApprove ? (
          <BulkProvider allIds={pageRows.map((r) => r.id)}>
            {table}
            <BulkBar>
              <BulkActionForm action={bulkApproveMdf} submitLabel="Approve as requested" variant="primary" successMessage="Approved." />
              <BulkActionForm action={bulkRejectMdf} submitLabel="Reject" variant="danger" successMessage="Rejected." />
            </BulkBar>
          </BulkProvider>
        ) : (
          table
        )}
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={total}
          prevHref={listHref("/mdf", { view, activity: activeQ, q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/mdf", { view, activity: activeQ, q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}

/** Shared field set for the Set/Edit budget drawers. */
function BudgetFields({
  defaults,
  today,
}: {
  defaults: { periodLabel: string; amount: number; periodStart: string; periodEnd: string } | null;
  today: string;
}): ReactNode {
  return (
    <>
      <label style={labelStyle}>
        <span style={spanStyle}>Period label</span>
        <input name="periodLabel" required maxLength={120} placeholder="e.g. Q3 2026" defaultValue={defaults?.periodLabel ?? ""} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Allocation ($)</span>
        <input name="amount" type="number" min={1} defaultValue={defaults?.amount ?? 0} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Period start</span>
        <input name="periodStart" type="date" required defaultValue={defaults?.periodStart ?? today} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Period end</span>
        <input name="periodEnd" type="date" required defaultValue={defaults?.periodEnd ?? addDays(today, 90)} style={controlStyle} />
      </label>
    </>
  );
}
