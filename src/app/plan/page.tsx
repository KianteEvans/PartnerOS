import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { assessments } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlanNav } from "@/app/plan/PlanNav";
import { Table } from "@/components/ui/Table";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { IconAssessments, IconTasks, IconReports, IconApplications } from "@/components/ui/icons";
import { Badge, statusTone } from "@/components/ui/Badge";
import { AskAws } from "@/components/ui/AskAws";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { bulkDeleteAssessments } from "@/domain/assessments/actions";
import { env } from "@/env";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import {
  PRESET_LABELS,
  type PresetId,
} from "@/domain/assessments/catalog";

const ASSESSMENT_SORT = {
  created: assessments.createdAt,
  name: assessments.name,
  status: assessments.status,
  score: assessments.overallScore,
} as const;

/**
 * Readiness Assessments list. Server component: the read is tenant-scoped via
 * withTenant, so RLS guarantees it can only ever return this tenant's rows.
 */
export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const params = parseListParams(await searchParams, {
    sortable: ["created", "name", "status", "score"],
    defaultSort: "created",
  });

  const { rows, total, agg } = await withTenant(identity, async (tx) => {
    const conds = [eq(assessments.tenantId, identity.tenantId)];
    if (params.q) conds.push(ilike(assessments.name, `%${params.q}%`));
    const where = and(...conds);
    const col = ASSESSMENT_SORT[params.sort as keyof typeof ASSESSMENT_SORT];
    const ordered = params.dir === "asc" ? asc(col) : desc(col);
    const rows = await tx
      .select({
        id: assessments.id,
        name: assessments.name,
        preset: assessments.preset,
        status: assessments.status,
        overallScore: assessments.overallScore,
        createdAt: assessments.createdAt,
      })
      .from(assessments)
      .where(where)
      .orderBy(ordered, asc(assessments.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const totalRows = await tx.select({ n: count() }).from(assessments).where(where);
    // Portfolio scoring stats (all assessments, not search-filtered) for the strip.
    const [agg] = await tx
      .select({
        total: sql<number>`count(*)`,
        scored: sql<number>`count(*) filter (where ${assessments.status} = 'scored')`,
        drafts: sql<number>`count(*) filter (where ${assessments.status} = 'draft')`,
        avgScore: sql<string | null>`avg(${assessments.overallScore})`,
      })
      .from(assessments)
      .where(eq(assessments.tenantId, identity.tenantId));
    return { rows, total: totalRows[0]?.n ?? 0, agg };
  });

  const stats = {
    total: Number(agg?.total ?? 0),
    scored: Number(agg?.scored ?? 0),
    drafts: Number(agg?.drafts ?? 0),
    avg: agg?.avgScore == null ? null : Math.round(Number(agg.avgScore)),
  };

  const totalPages = pageCount(total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/plan", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
      }),
  };

  return (
    <PageShell>
      <PageHeader
        title="Readiness Assessments"
        actions={
          <Link
            href="/plan/new"
            style={{
              background: "var(--accent)",
              color: "var(--accent-ink)",
              padding: "8px 16px",
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            New assessment
          </Link>
        }
      />
      <PlanNav />
      <SavedViewsBar listKey="assessments" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      {stats.total > 0 && (
        <MetricStrip>
          <MetricCard label="Assessments" value={String(stats.total)} sub="total" icon={<IconAssessments size={15} />} />
          <MetricCard label="Scored" value={String(stats.scored)} tone="ok" sub="completed" icon={<IconTasks size={15} />} />
          <MetricCard label="Avg score" value={stats.avg == null ? "—" : String(stats.avg)} tone="info" sub="across scored" icon={<IconReports size={15} />} size="lg" />
          <MetricCard label="Drafts" value={String(stats.drafts)} sub="in progress" icon={<IconApplications size={15} />} />
        </MetricStrip>
      )}

      <Panel title="Ask AWS — grounded in AWS docs" accent="var(--section-accent)">
        <AskAws enabled={Boolean(env.ANTHROPIC_API_KEY)} />
      </Panel>

      <Panel actions={<SearchForm q={params.q} placeholder="Search by name…" hidden={{ sort: params.sort, dir: params.dir }} />}>
        <BulkProvider allIds={rows.filter((r) => r.status === "draft").map((r) => r.id)}>
        <Table
          rows={rows}
          rowKey={(r) => r.id}
          sort={sortState}
          empty={
            <EmptyState
              icon={<IconAssessments size={28} />}
              title={params.q ? "No matching assessments" : "No assessments yet"}
              hint={params.q ? `Nothing matches “${params.q}”.` : "Create one to get started."}
              action={
                <Link
                  href="/plan/new"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  New assessment
                </Link>
              }
            />
          }
          columns={[
            {
              key: "select",
              header: "",
              render: (r) => (r.status === "draft" ? <BulkCheckbox id={r.id} /> : null),
            },
            {
              key: "name",
              header: "Name",
              sortKey: "name",
              render: (r) => (
                <Link
                  href={`/plan/${r.id}`}
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {r.name}
                </Link>
              ),
            },
            {
              key: "preset",
              header: "Preset",
              render: (r) => PRESET_LABELS[r.preset as PresetId],
            },
            {
              key: "status",
              header: "Status",
              sortKey: "status",
              render: (r) => (
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              ),
            },
            {
              key: "score",
              header: "Overall",
              align: "right",
              sortKey: "score",
              render: (r) =>
                r.overallScore === null ? "—" : `${r.overallScore}/100`,
            },
            {
              key: "created",
              header: "Created",
              sortKey: "created",
              render: (r) => r.createdAt.toISOString().slice(0, 10),
            },
          ]}
        />
        <BulkBar>
          <BulkActionForm
            action={bulkDeleteAssessments}
            submitLabel="Delete drafts"
            variant="danger"
            confirmMessage="Delete the selected draft assessments? This cannot be undone."
            successMessage="Draft assessments deleted."
          />
        </BulkBar>
        </BulkProvider>
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={total}
          prevHref={listHref("/plan", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/plan", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
