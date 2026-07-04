import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { roadmaps, roadmapMilestones } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlanNav } from "@/app/plan/PlanNav";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Badge, statusTone } from "@/components/ui/Badge";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { formLabel, formLabelSpan, formControl } from "@/components/ui/form-styles";
import { bulkSetRoadmapsArchived, createRoadmap } from "@/domain/roadmaps/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { HORIZON_LABELS, SCENARIO_LABELS } from "@/domain/roadmaps/planner";
import type { HorizonId, ScenarioId } from "@/domain/roadmaps/planner";
import {
  roadmapProgress,
  type RoadmapProgress,
  type MilestoneStatusValue,
} from "@/domain/roadmaps/progress";

const ROADMAP_SORT = {
  created: roadmaps.createdAt,
  name: roadmaps.name,
  status: roadmaps.status,
} as const;

const ctaStyle = {
  background: "var(--accent)",
  color: "var(--accent-ink)",
  padding: "8px 16px",
  borderRadius: 8,
  fontWeight: 600,
  textDecoration: "none",
} as const;

export default async function RoadmapsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const sp = await searchParams;
  const params = parseListParams(sp, {
    sortable: ["created", "name", "status"],
    defaultSort: "created",
  });
  const view = sp.view === "archived" ? "archived" : "";
  const today = new Date().toISOString().slice(0, 10);

  const { rows, total, msRows, archivedTotal } = await withTenant(identity, async (tx) => {
    const conds = [
      eq(roadmaps.tenantId, identity.tenantId),
      view === "archived" ? isNotNull(roadmaps.archivedAt) : isNull(roadmaps.archivedAt),
    ];
    if (params.q) conds.push(ilike(roadmaps.name, `%${params.q}%`));
    const where = and(...conds);
    const col = ROADMAP_SORT[params.sort as keyof typeof ROADMAP_SORT];
    const ordered = params.dir === "asc" ? asc(col) : desc(col);
    const rows = await tx
      .select({
        id: roadmaps.id,
        name: roadmaps.name,
        horizon: roadmaps.horizon,
        status: roadmaps.status,
        source: roadmaps.source,
        createdAt: roadmaps.createdAt,
      })
      .from(roadmaps)
      .where(where)
      .orderBy(ordered, asc(roadmaps.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const ids = rows.map((r) => r.id);
    const msRows =
      ids.length === 0
        ? []
        : await tx
            .select({
              roadmapId: roadmapMilestones.roadmapId,
              status: roadmapMilestones.status,
              targetDate: roadmapMilestones.targetDate,
            })
            .from(roadmapMilestones)
            .where(
              and(
                eq(roadmapMilestones.tenantId, identity.tenantId),
                inArray(roadmapMilestones.roadmapId, ids),
              ),
            );
    const totalRows = await tx.select({ n: count() }).from(roadmaps).where(where);
    const archivedRows = await tx
      .select({ n: count() })
      .from(roadmaps)
      .where(and(eq(roadmaps.tenantId, identity.tenantId), isNotNull(roadmaps.archivedAt)));
    return {
      rows,
      total: totalRows[0]?.n ?? 0,
      msRows,
      archivedTotal: archivedRows[0]?.n ?? 0,
    };
  });

  // Per-roadmap progress, computed with the same pure rollup as the detail page.
  const byRoadmap = new Map<
    string,
    Array<{ status: MilestoneStatusValue; targetDate: string }>
  >();
  for (const m of msRows) {
    const arr = byRoadmap.get(m.roadmapId) ?? [];
    arr.push({ status: m.status, targetDate: m.targetDate });
    byRoadmap.set(m.roadmapId, arr);
  }
  const progressById = new Map<string, RoadmapProgress>();
  for (const r of rows) {
    progressById.set(r.id, roadmapProgress(byRoadmap.get(r.id) ?? [], today));
  }

  const totalPages = pageCount(total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/plan/roadmaps", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "desc" ? "asc" : "desc",
        view,
      }),
  };

  // Quick create posts the same createRoadmap action the builder uses and lands
  // on the new detail page — for a bare plan without the catalog composer.
  const quickCreate = (
    <FormDrawer
      triggerLabel="Quick create"
      triggerVariant="secondary"
      title="Quick create roadmap"
      action={createRoadmap}
      submitLabel="Create"
      successMessage="Roadmap created."
    >
      <label style={formLabel}>
        <span style={formLabelSpan}>Name</span>
        <input name="name" required maxLength={200} placeholder="e.g. H2 2026 partnership plan" style={formControl} />
      </label>
      <label style={formLabel}>
        <span style={formLabelSpan}>Objective (optional)</span>
        <input name="objective" maxLength={500} placeholder="What this roadmap drives toward" style={formControl} />
      </label>
      <label style={formLabel}>
        <span style={formLabelSpan}>Horizon</span>
        <select name="horizon" defaultValue="m6" style={formControl}>
          {(Object.keys(HORIZON_LABELS) as HorizonId[]).map((h) => (
            <option key={h} value={h}>
              {HORIZON_LABELS[h]}
            </option>
          ))}
        </select>
      </label>
      <label style={formLabel}>
        <span style={formLabelSpan}>Scenario</span>
        <select name="scenario" defaultValue="standard" style={formControl}>
          {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((s) => (
            <option key={s} value={s}>
              {SCENARIO_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label style={formLabel}>
        <span style={formLabelSpan}>Start date</span>
        <input name="startDate" type="date" defaultValue={today} required style={formControl} />
      </label>
    </FormDrawer>
  );

  const newRoadmap = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {quickCreate}
      <Link href="/plan/roadmaps/new" style={ctaStyle}>
        New roadmap
      </Link>
    </div>
  );

  return (
    <PageShell>
      <PageHeader title="Roadmap Builder" actions={newRoadmap} />
      <PlanNav />

      {total === 0 && !params.q && view !== "archived" && archivedTotal === 0 ? (
        <Panel>
          <EmptyState
            title="No roadmaps yet"
            hint="Compose a plan from the AWS programs and tier advancement you want to pursue — or start one from an assessment."
            action={
              <Link href="/plan/roadmaps/new" style={ctaStyle}>
                Build your first roadmap
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          <SavedViewsBar
            listKey="roadmaps"
            current={{ q: params.q, sort: params.sort, dir: params.dir }}
          />
          {(archivedTotal > 0 || view === "archived") && (
            <nav aria-label="Roadmap view" style={{ display: "flex" }}>
              <SegmentedControl
                size="sm"
                options={[
                  { value: "", label: "Active" },
                  { value: "archived", label: `Archived (${archivedTotal})` },
                ]}
                value={view}
                hrefFor={(v) =>
                  listHref("/plan/roadmaps", { q: params.q, sort: params.sort, dir: params.dir, view: v })
                }
              />
            </nav>
          )}
          <Panel
            actions={
              <SearchForm
                q={params.q}
                placeholder="Search by name…"
                hidden={{ sort: params.sort, dir: params.dir, ...(view ? { view } : {}) }}
              />
            }
          >
            <BulkProvider allIds={rows.map((r) => r.id)}>
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              sort={sortState}
              empty={
                view === "archived"
                  ? "No archived roadmaps."
                  : `No roadmaps match “${params.q}”.`
              }
              columns={[
                {
                  key: "select",
                  header: "",
                  render: (r) => <BulkCheckbox id={r.id} />,
                },
                {
                  key: "name",
                  header: "Name",
                  sortKey: "name",
                  render: (r) => (
                    <Link
                      href={`/plan/roadmaps/${r.id}`}
                      style={{ color: "var(--accent)", textDecoration: "none" }}
                    >
                      {r.name}
                    </Link>
                  ),
                },
                {
                  key: "progress",
                  header: "Progress",
                  render: (r) => {
                    const p = progressById.get(r.id);
                    if (!p || p.total === 0) {
                      return <span style={{ color: "var(--muted)" }}>—</span>;
                    }
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 70,
                            height: 6,
                            background: "var(--border)",
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${p.percentDone}%`,
                              height: "100%",
                              background: "var(--ok)",
                              borderRadius: 999,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {p.done}/{p.total}
                        </span>
                      </div>
                    );
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  sortKey: "status",
                  render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                },
                {
                  key: "nextDue",
                  header: "Next due",
                  render: (r) => {
                    const p = progressById.get(r.id);
                    if (!p || p.total === 0) {
                      return <span style={{ color: "var(--muted)" }}>—</span>;
                    }
                    if (p.nextDue === null) {
                      return <Badge tone="ok">Complete</Badge>;
                    }
                    return (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          style={{
                            color: p.overdue > 0 ? "var(--danger)" : "var(--text)",
                            fontSize: 13,
                          }}
                        >
                          {p.nextDue}
                        </span>
                        {p.overdue > 0 && (
                          <Badge tone="danger">{p.overdue} overdue</Badge>
                        )}
                      </span>
                    );
                  },
                },
                {
                  key: "horizon",
                  header: "Horizon",
                  render: (r) => HORIZON_LABELS[r.horizon as HorizonId],
                },
                {
                  key: "source",
                  header: "Source",
                  render: (r) => (
                    <span style={{ textTransform: "capitalize" }}>{r.source}</span>
                  ),
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
              {view === "archived" ? (
                <BulkActionForm
                  action={bulkSetRoadmapsArchived}
                  hidden={{ archived: "0" }}
                  submitLabel="Restore"
                  successMessage="Roadmaps restored."
                />
              ) : (
                <BulkActionForm
                  action={bulkSetRoadmapsArchived}
                  hidden={{ archived: "1" }}
                  submitLabel="Archive"
                  successMessage="Roadmaps archived. Find them under the Archived view."
                />
              )}
            </BulkBar>
            </BulkProvider>
            <Pagination
              page={params.page}
              totalPages={totalPages}
              total={total}
              prevHref={listHref("/plan/roadmaps", { q: params.q, sort: params.sort, dir: params.dir, view, page: params.page - 1 })}
              nextHref={listHref("/plan/roadmaps", { q: params.q, sort: params.sort, dir: params.dir, view, page: params.page + 1 })}
            />
          </Panel>
        </>
      )}
    </PageShell>
  );
}
