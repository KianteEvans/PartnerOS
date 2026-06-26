import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { mdfRequests } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Badge, statusTone } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { createMdfRequest } from "@/domain/mdf/actions";
import { MDF_STATUS_LABELS, type MdfStatus } from "@/domain/mdf/lifecycle";
import { portfolioSummary, deadlineRisk, type MdfLike } from "@/domain/mdf/analytics";
import { parseListParams, listHref, pageCount } from "@/domain/list";

const MDF_SORT = {
  created: mdfRequests.createdAt,
  title: mdfRequests.title,
  status: mdfRequests.status,
  requested: mdfRequests.requestedAmount,
  approved: mdfRequests.approvedAmount,
} as const;

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;

const money = (n: number | null): string => (n == null ? "—" : `$${n.toLocaleString()}`);

export default async function MdfPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const params = parseListParams(await searchParams, {
    sortable: ["created", "title", "status", "requested", "approved"],
    defaultSort: "created",
  });

  const { allRows, pageRows, total } = await withTenant(identity, async (tx) => {
    // The reconciliation overview aggregates the whole portfolio, so it reads
    // every row; only the table is paginated/filtered.
    const allRows = await tx
      .select()
      .from(mdfRequests)
      .where(eq(mdfRequests.tenantId, identity.tenantId));

    const conds = [eq(mdfRequests.tenantId, identity.tenantId)];
    if (params.q) conds.push(ilike(mdfRequests.title, `%${params.q}%`));
    const where = and(...conds);
    const col = MDF_SORT[params.sort as keyof typeof MDF_SORT];
    const ordered = params.dir === "asc" ? asc(col) : desc(col);

    const pageRows = await tx
      .select()
      .from(mdfRequests)
      .where(where)
      .orderBy(ordered, asc(mdfRequests.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const totalRows = await tx.select({ n: count() }).from(mdfRequests).where(where);
    return { allRows, pageRows, total: totalRows[0]?.n ?? 0 };
  });

  const summary = portfolioSummary(allRows as MdfLike[], today);
  const totalPages = pageCount(total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/mdf", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
      }),
  };

  return (
    <PageShell>
      <PageHeader
        title="MDF Management"
        actions={
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
          </FormDrawer>
        }
      />

      <Panel title="Reconciliation overview">
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 12,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          {([
            ["Remaining", money(summary.remaining)],
            ["Pipeline", money(summary.pipeline)],
            ["ROI", summary.roi == null ? "—" : `${summary.roi}x`],
            ["Deadline risks", String(summary.deadlineRisks)],
            ["Open", String(summary.openCount)],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <SavedViewsBar listKey="mdf" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Requests (${total})`}
        actions={
          <SearchForm
            q={params.q}
            placeholder="Search by title…"
            hidden={{ sort: params.sort, dir: params.dir }}
          />
        }
      >
        <Table
          rows={pageRows}
          rowKey={(r) => r.id}
          sort={sortState}
          empty={params.q ? `No requests match “${params.q}”.` : "No MDF requests yet."}
          columns={[
            {
              key: "title",
              header: "Title",
              sortKey: "title",
              render: (r) => (
                <Link href={`/mdf/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.title}</Link>
              ),
            },
            { key: "status", header: "Status", sortKey: "status", render: (r) => <Badge tone={statusTone(r.status)}>{MDF_STATUS_LABELS[r.status as MdfStatus]}</Badge> },
            { key: "requested", header: "Requested", align: "right", sortKey: "requested", render: (r) => money(r.requestedAmount) },
            { key: "approved", header: "Approved", align: "right", sortKey: "approved", render: (r) => money(r.approvedAmount) },
            {
              key: "deadline",
              header: "Claim by",
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
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={total}
          prevHref={listHref("/mdf", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/mdf", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
