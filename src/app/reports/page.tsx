import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Card } from "@/components/ui/Card";
import { IconReports, IconTasks, IconEvidence, IconApplications } from "@/components/ui/icons";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MutationForm } from "@/components/ui/MutationForm";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { Badge, statusTone } from "@/components/ui/Badge";
import { generateReport } from "@/domain/reports/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS_LABELS,
  type ReportType,
  type ReportStatus,
} from "@/domain/reports/metrics";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const REPORT_SORT = {
  created: reports.createdAt,
  title: reports.title,
  status: reports.status,
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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("reports");
  if (fenced) return <PackageFence feature="reports" previewTier={fenced} />;

  const params = parseListParams(await searchParams, {
    sortable: ["created", "title", "status"],
    defaultSort: "created",
  });

  const { rows, total, agg } = await withTenant(identity, async (tx) => {
    const conds = [eq(reports.tenantId, identity.tenantId)];
    if (params.q) conds.push(ilike(reports.title, `%${params.q}%`));
    const where = and(...conds);
    const col = REPORT_SORT[params.sort as keyof typeof REPORT_SORT];
    const ordered = params.dir === "asc" ? asc(col) : desc(col);
    const rows = await tx
      .select({
        id: reports.id,
        title: reports.title,
        reportType: reports.reportType,
        status: reports.status,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(where)
      .orderBy(ordered, asc(reports.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const totalRows = await tx.select({ n: count() }).from(reports).where(where);
    // Portfolio status mix (all reports, not search-filtered) for the strip.
    const [agg] = await tx
      .select({
        total: sql<number>`count(*)`,
        approved: sql<number>`count(*) filter (where ${reports.status} = 'approved')`,
        exported: sql<number>`count(*) filter (where ${reports.status} = 'exported')`,
        drafts: sql<number>`count(*) filter (where ${reports.status} = 'draft')`,
      })
      .from(reports)
      .where(eq(reports.tenantId, identity.tenantId));
    return { rows, total: totalRows[0]?.n ?? 0, agg };
  });

  const stats = {
    total: Number(agg?.total ?? 0),
    approved: Number(agg?.approved ?? 0),
    exported: Number(agg?.exported ?? 0),
    drafts: Number(agg?.drafts ?? 0),
  };

  const totalPages = pageCount(total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/reports", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
      }),
  };

  return (
    <PageShell>
      <PageHeader
        title="Reporting"
        actions={
          <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Link
              href="/reports/forecasts"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Forecasts →
            </Link>
            <Link
              href="/reports/winloss"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Win/Loss →
            </Link>
            <Link
              href="/reports/roi"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Program ROI →
            </Link>
          </span>
        }
      />

      {stats.total > 0 && (
        <MetricStrip>
          <MetricCard label="Reports" value={String(stats.total)} sub="generated" icon={<IconReports size={15} />} />
          <MetricCard label="Approved" value={String(stats.approved)} tone="ok" sub="signed off" icon={<IconTasks size={15} />} />
          <MetricCard label="Exported" value={String(stats.exported)} tone="info" sub="shared" icon={<IconEvidence size={15} />} />
          <MetricCard label="Drafts" value={String(stats.drafts)} sub="in progress" icon={<IconApplications size={15} />} />
        </MetricStrip>
      )}

      {/* The always-on analytical reports — computed live, no generation step. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {[
          { href: "/reports/roi", title: "ROI loops", desc: "Spend → pipeline → won revenue → tier credit, with where the loop leaks." },
          { href: "/reports/winloss", title: "Win/loss mining", desc: "What drives your wins and losses — factor lifts, loss reasons, rep win rates." },
          { href: "/reports/forecasts", title: "Forecasts", desc: "Monte-Carlo projections for revenue, health, win rate, and roadmap completion." },
        ].map((r) => (
          <Link key={r.href} href={r.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card interactive style={{ display: "grid", gap: 4, height: "100%", alignContent: "start" }}>
              <strong style={{ fontSize: 14, color: "var(--accent)" }}>{r.title} →</strong>
              <span style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{r.desc}</span>
            </Card>
          </Link>
        ))}
      </div>

      <Panel title="AWS QBR packet" accent="var(--accent-2)">
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
          One click assembles a partner&harr;AWS Quarterly Business Review: a partnership-health
          arc vs. last quarter, this quarter&rsquo;s committed-vs-achieved results, and a
          next-quarter commitment plan grounded in your tier path and highest-leverage moves.
          Open the report&rsquo;s <strong>Print</strong> view for the executive packet.
        </p>
        <MutationForm action={generateReport} submitLabel="Generate AWS QBR">
          <input type="hidden" name="reportType" value="qbr" />
          <label style={labelStyle}>
            <span style={spanStyle}>Title</span>
            <input name="title" required maxLength={200} defaultValue="AWS Quarterly Business Review" style={controlStyle} />
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={labelStyle}><span style={spanStyle}>Period start</span><input name="periodStart" type="date" style={controlStyle} /></label>
            <label style={labelStyle}><span style={spanStyle}>Period end</span><input name="periodEnd" type="date" style={controlStyle} /></label>
          </div>
        </MutationForm>
      </Panel>

      <Panel title="Generate report">
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
          Generating snapshots live metrics from MDF, ACE, programs, tiers, evidence,
          tasks, and assessments into an auditable package.
        </p>
        <MutationForm action={generateReport} submitLabel="Generate">
          <label style={labelStyle}>
            <span style={spanStyle}>Title</span>
            <input name="title" required maxLength={200} placeholder="Q3 Partnership Review" style={controlStyle} />
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={labelStyle}>
              <span style={spanStyle}>Type</span>
              <select name="reportType" defaultValue="executive_plan" style={controlStyle}>
                {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((t) => (
                  <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}><span style={spanStyle}>Period start</span><input name="periodStart" type="date" style={controlStyle} /></label>
            <label style={labelStyle}><span style={spanStyle}>Period end</span><input name="periodEnd" type="date" style={controlStyle} /></label>
          </div>
        </MutationForm>
      </Panel>

      <SavedViewsBar listKey="reports" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Reports (${total})`}
        actions={<SearchForm q={params.q} placeholder="Search by title…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <Table
          rows={rows}
          rowKey={(r) => r.id}
          sort={sortState}
          empty={params.q ? `No reports match “${params.q}”.` : "No reports yet."}
          columns={[
            {
              key: "title",
              header: "Title",
              sortKey: "title",
              render: (r) => (
                <Link href={`/reports/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.title}</Link>
              ),
            },
            { key: "type", header: "Type", render: (r) => REPORT_TYPE_LABELS[r.reportType as ReportType] },
            {
              key: "status",
              header: "Status",
              sortKey: "status",
              render: (r) => (
                <Badge tone={statusTone(r.status)}>{REPORT_STATUS_LABELS[r.status as ReportStatus]}</Badge>
              ),
            },
            {
              key: "period",
              header: "Period",
              render: (r) => (r.periodStart && r.periodEnd ? `${r.periodStart} → ${r.periodEnd}` : "—"),
            },
            { key: "created", header: "Created", sortKey: "created", render: (r) => r.createdAt.toISOString().slice(0, 10) },
          ]}
        />
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={total}
          prevHref={listHref("/reports", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/reports", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
