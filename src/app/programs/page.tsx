import type { ReactNode } from "react";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { programs, programRequirements, evidence, users } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { LifecycleNav } from "@/app/programs/LifecycleNav";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { RingGauge } from "@/components/ui/RingGauge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconPrograms, IconPortfolio, IconMdf } from "@/components/ui/icons";
import { MutationForm } from "@/components/ui/MutationForm";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/list-view";
import { adoptProgram, bulkUpdateProgram } from "@/domain/programs/actions";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { loadProgramRoi } from "@/domain/programs/roi-load";
import { roiRollup } from "@/domain/programs/roi";
import { loadCompetencyRecommendations } from "@/domain/programs/recommend-load";
import { RecommendNarrative } from "@/components/ui/RecommendNarrative";
import { loadSolutions } from "@/domain/solutions/load";
import { SolutionsView } from "@/app/programs/SolutionsView";
import { PursuitTracker } from "@/app/programs/PursuitTracker";
import { topPursued } from "@/domain/programs/pursue";
import { FIT_BAND_LABELS, type FitBand } from "@/domain/evidence/fit";
import { loadProgramFit } from "@/domain/evidence/fit-load";
import { FitView } from "@/app/programs/FitView";
import { TopCompetencyFit } from "@/app/programs/TopCompetencyFit";
import { PROGRAM_LIBRARY, FUNDING_FIT_LABELS } from "@/domain/programs/library";
import {
  computeReadinessGate,
  requirementProgress,
  filterPrograms,
  portfolioCounts,
  GATE_LABELS,
  PORTFOLIO_VIEWS,
  PORTFOLIO_VIEW_LABELS,
  type PortfolioView,
  type RequirementState,
  type ProgramStatusValue,
} from "@/domain/programs/gate";
import { money } from "@/domain/format";

function isView(v: string | undefined): v is PortfolioView {
  return v !== undefined && (PORTFOLIO_VIEWS as readonly string[]).includes(v);
}


// Sort options for the portfolio card grid. Each key sets a sensible default
// direction (newest-first, A→Z, lowest-readiness-first to surface gaps).
const PORTFOLIO_SORTS = [
  { value: "created", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "readiness", label: "Readiness" },
] as const;
const PORTFOLIO_SORT_DIR: Record<string, "asc" | "desc"> = {
  created: "desc",
  name: "asc",
  status: "asc",
  readiness: "desc",
};

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const programParam = Array.isArray(sp.program) ? sp.program[0] : sp.program;
  // "roi" and "recommended" are body-swapping special views (like "available") that
  // live outside the PortfolioView union; branch on the raw string so gate.ts stays clean.
  const isRoi = viewParam === "roi";
  const isRecommended = viewParam === "recommended";
  const isSolutions = viewParam === "solutions";
  const isFit = viewParam === "fit";
  const solutionsLayout: "grid" | "timeline" =
    (Array.isArray(sp.layout) ? sp.layout[0] : sp.layout) === "timeline" ? "timeline" : "grid";
  const view: PortfolioView = isView(viewParam) ? viewParam : "all";
  const list = parseListParams(sp, {
    sortable: ["created", "name", "status", "readiness"],
    defaultSort: "created",
  });
  const today = new Date().toISOString().slice(0, 10);

  const roiItems = isRoi ? await loadProgramRoi(identity) : [];
  const rollup = roiRollup(roiItems.map((r) => ({ name: r.name, roi: r.roi })));
  const recView = isRecommended ? await loadCompetencyRecommendations(identity, today) : null;
  const solutionItems = isSolutions ? await loadSolutions(identity, today) : [];
  // Program Fit powers both the `?view=fit` dashboard and the default-view "Top
  // competency fit" tracker, so load it whenever neither of the other body-swap
  // views is active (i.e. the default Pursue view OR `?view=fit`).
  const fit = !(isRoi || isRecommended || isSolutions)
    ? await loadProgramFit(identity, today)
    : null;

  const { progs, reqs, members } = await withTenant(identity, async (tx) => {
    const progs = await tx
      .select()
      .from(programs)
      .where(eq(programs.tenantId, identity.tenantId))
      .orderBy(desc(programs.createdAt));
    const reqs = await tx
      .select({
        programId: programRequirements.programId,
        status: programRequirements.status,
        evidenceStatus: evidence.status,
      })
      .from(programRequirements)
      .leftJoin(evidence, eq(evidence.id, programRequirements.evidenceId))
      .where(eq(programRequirements.tenantId, identity.tenantId));
    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    return { progs, reqs, members };
  });

  const statesByProgram = new Map<string, RequirementState[]>();
  for (const r of reqs) {
    const arr = statesByProgram.get(r.programId) ?? [];
    arr.push({ status: r.status, evidenceApproved: r.evidenceStatus === "approved" });
    statesByProgram.set(r.programId, arr);
  }

  // The Pursue headline: the in-flight competencies closest to being earned.
  const pursuit = topPursued(
    progs.map((p) => ({
      id: p.id,
      name: p.name,
      programType: p.programType,
      status: p.status,
      expirationDate: p.expirationDate,
      states: statesByProgram.get(p.id) ?? [],
    })),
    today,
  );

  const counts = portfolioCounts(
    progs.map((p) => ({ status: p.status, expirationDate: p.expirationDate })),
    today,
  );
  // Portfolio readiness: requirements met across every adopted program.
  let metSum = 0;
  let totSum = 0;
  const readinessByProgram = new Map<string, number>();
  for (const p of progs) {
    const pr = requirementProgress(statesByProgram.get(p.id) ?? []);
    metSum += pr.met;
    totSum += pr.total;
    readinessByProgram.set(p.id, pr.total > 0 ? pr.met / pr.total : 0);
  }
  const avgReadiness = totSum > 0 ? Math.round((metSum / totSum) * 100) : 0;
  const adoptedKeys = new Set(progs.map((p) => p.libraryKey));
  const available = PROGRAM_LIBRARY.filter((p) => !adoptedKeys.has(p.key));
  const visible = filterPrograms(progs, view, today);

  // Search + sort + paginate the active list in-memory (programs need their requirement
  // states loaded for the readiness gate, and the library is a fixed catalog).
  const ql = list.q.toLowerCase();
  const portfolioView = tableView(visible, list, {
    search: (p) => p.name,
    comparators: {
      created: (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
      readiness: (a, b) =>
        (readinessByProgram.get(a.id) ?? 0) - (readinessByProgram.get(b.id) ?? 0) || a.name.localeCompare(b.name),
    },
  });
  const pagedPortfolio = portfolioView.rows;
  const searchedLibrary = list.q ? available.filter((p) => p.name.toLowerCase().includes(ql)) : available;
  const pagedLibrary = searchedLibrary.slice(list.offset, list.offset + list.pageSize);
  const total = view === "available" ? searchedLibrary.length : portfolioView.total;
  const totalPages = pageCount(total, list.pageSize);

  return (
    <PageShell>
      <PageHeader title="Program Management" />
      <LifecycleNav />

      {!isRoi && !isRecommended && !isSolutions && !isFit && (
        <MetricStrip min={140}>
          <MetricCard label="Active" value={String(counts.active)} tone={counts.active > 0 ? "ok" : "neutral"} />
          <MetricCard label="In progress" value={String(counts.pending)} tone={counts.pending > 0 ? "warn" : "neutral"} />
          <MetricCard
            label="Expiring soon"
            value={String(counts.expiring)}
            tone={counts.expiring > 0 ? "danger" : "neutral"}
            {...(counts.expiring > 0 ? { tint: "danger" as const } : {})}
          />
          <MetricCard label="Avg readiness" value={`${avgReadiness}%`} />
        </MetricStrip>
      )}

      {!isRoi && !isRecommended && !isSolutions && !isFit && fit && (
        <TopCompetencyFit fits={fit.fits} adoptedKeys={fit.adoptedKeys} hasEvidence={fit.hasEvidence} />
      )}

      {!isRoi && !isRecommended && !isSolutions && !isFit && <PursuitTracker items={pursuit} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <nav aria-label="Portfolio views" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <SegmentedControl
            options={PORTFOLIO_VIEWS.map((v) => ({
              value: v,
              label: `${PORTFOLIO_VIEW_LABELS[v]} (${v === "available" ? available.length : counts[v]})`,
            }))}
            value={isRoi || isRecommended || isSolutions || isFit ? "" : view}
            hrefFor={(v) => listHref("/programs", { view: v, q: list.q })}
          />
          <SegmentedControl
            options={[
              { value: "recommended", label: "Recommended" },
              { value: "roi", label: "ROI" },
              { value: "solutions", label: "Solutions" },
              { value: "fit", label: "Program Fit" },
            ]}
            value={isFit ? "fit" : isSolutions ? "solutions" : isRoi ? "roi" : isRecommended ? "recommended" : ""}
            hrefFor={(v) => listHref("/programs", { view: v })}
          />
        </nav>
        {!isRoi && !isRecommended && !isSolutions && !isFit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {view !== "available" && (
              <SegmentedControl
                options={[...PORTFOLIO_SORTS]}
                value={list.sort}
                hrefFor={(v) => listHref("/programs", { view, q: list.q, sort: v, dir: PORTFOLIO_SORT_DIR[v] })}
                size="sm"
              />
            )}
            <SearchForm q={list.q} placeholder="Search by name…" hidden={{ view, sort: list.sort, dir: list.dir }} />
          </div>
        )}
      </div>

      {!isRoi && !isRecommended && !isSolutions && !isFit && <SavedViewsBar listKey="programs" current={{ view, q: list.q }} />}

      {isFit && fit ? (
        <FitView view={fit} {...(programParam ? { programKey: programParam } : {})} />
      ) : isSolutions ? (
        <SolutionsView
          items={solutionItems}
          today={today}
          layout={solutionsLayout}
          programOptions={progs.map((p) => ({ id: p.id, name: p.name }))}
        />
      ) : isRecommended && recView ? (
        <RecommendedView view={recView} />
      ) : isRoi ? (
        <RoiView roiItems={roiItems} rollup={rollup} />
      ) : view === "available" ? (
        <Panel title="Program Library">
          {pagedLibrary.length === 0 ? (
            <EmptyState
              title={list.q ? "No library programs match" : "Library fully adopted"}
              hint={
                list.q ? `Nothing matches “${list.q}”.` : "Every library program is already in your portfolio."
              }
            />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {pagedLibrary.map((p) => (
                <Card key={p.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {p.programType} · {p.deliveryModel} · {FUNDING_FIT_LABELS[p.fundingFit] ?? p.fundingFit}
                    </span>
                  </div>
                  <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 10px" }}>
                    {p.description} · {p.requirements.length} requirements
                  </p>
                  <MutationForm action={adoptProgram} submitLabel="Add to portfolio" hidden={{ libraryKey: p.key }} />
                </Card>
              ))}
            </div>
          )}
        </Panel>
      ) : pagedPortfolio.length === 0 ? (
        <EmptyState
          title={list.q ? "No programs match" : "No programs in this view"}
          hint={list.q ? `Nothing matches “${list.q}”.` : "Adopt an AWS program from the library to start tracking it."}
          action={
            list.q ? undefined : (
              <Link href="/programs?view=available" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
                Browse the library →
              </Link>
            )
          }
        />
      ) : (
        <BulkProvider allIds={pagedPortfolio.map((p) => p.id)}>
          <div style={{ display: "grid", gap: 12 }}>
            {pagedPortfolio.map((p) => {
              const states = statesByProgram.get(p.id) ?? [];
              const gate = computeReadinessGate(
                p.status as ProgramStatusValue,
                states,
                p.expirationDate,
                today,
              );
              const prog = requirementProgress(states);
              return (
                <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <BulkCheckbox id={p.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Card>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <Link href={`/programs/${p.id}`} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
                          {p.name}
                        </Link>
                        <Badge tone={statusTone(gate)} title={GATE_LABELS[gate]}>
                          {GATE_LABELS[gate]}
                        </Badge>
                      </div>
                      <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                        {p.programType} · {p.status} · {prog.met}/{prog.total} requirements met
                        {p.expirationDate ? ` · expires ${p.expirationDate}` : ""}
                      </p>
                    </Card>
                  </div>
                </div>
              );
            })}
          </div>
          <BulkBar>
            <BulkActionForm
              action={bulkUpdateProgram}
              field="status"
              options={[
                { value: "active", label: "Active" },
                { value: "pending", label: "In progress" },
                { value: "expired", label: "Expired" },
              ]}
              submitLabel="Set status"
            />
            <BulkActionForm
              action={bulkUpdateProgram}
              field="ownerUserId"
              options={members.map((m) => ({ value: m.id, label: m.email }))}
              submitLabel="Set owner"
            />
          </BulkBar>
        </BulkProvider>
      )}

      {!isRoi && !isRecommended && !isSolutions && !isFit && (
        <Pagination
          page={list.page}
          totalPages={totalPages}
          total={total}
          prevHref={listHref("/programs", { view, q: list.q, sort: list.sort, dir: list.dir, page: list.page - 1 })}
          nextHref={listHref("/programs", { view, q: list.q, sort: list.sort, dir: list.dir, page: list.page + 1 })}
        />
      )}
    </PageShell>
  );
}

const BAND_TONE: Record<FitBand, Tone> = {
  ready: "ok",
  close: "info",
  emerging: "warn",
  exploratory: "neutral",
};
const BAND_COLOR: Record<FitBand, string> = {
  ready: "var(--ok)",
  close: "var(--info)",
  emerging: "var(--warn)",
  exploratory: "var(--muted)",
};

function RecommendedView({
  view,
}: {
  view: Awaited<ReturnType<typeof loadCompetencyRecommendations>>;
}): ReactNode {
  const { recommendations, hasProfile, hasAssessment, hasEvidence, adoptedIdByKey, aiEnabled } = view;

  const missing: string[] = [];
  if (!hasEvidence) missing.push("no evidence in the locker");
  if (!hasProfile) missing.push("no business model set in onboarding");
  if (!hasAssessment) missing.push("no scored readiness assessment");

  if (recommendations.length === 0) {
    return <EmptyState title="No competencies to recommend" hint="The program library is empty." />;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Best-fit AWS Competencies, ranked by your evidence coverage, business model, and readiness.{" "}
          <Link href="/programs?view=fit" style={{ color: "var(--accent)" }}>
            Evidence-only view →
          </Link>
        </p>
        <RecommendNarrative enabled={aiEnabled} />
      </div>
      {missing.length > 0 && (
        <Card compact>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Ranking is partial — {missing.join(", ")}. Fill these in to sharpen it.
          </span>
        </Card>
      )}

      {recommendations.map((r) => {
        const adoptedId = adoptedIdByKey.get(r.programKey);
        return (
          <Card key={r.programKey}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <RingGauge value={r.recommendationScore} size={84} thickness={9} color={BAND_COLOR[r.band]} caption="fit" />
              <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15 }}>{r.name}</strong>
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone={BAND_TONE[r.band]}>{FIT_BAND_LABELS[r.band]}</Badge>
                    {r.isAdopted && <Badge tone="info">In portfolio</Badge>}
                  </span>
                </div>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {r.programType} · {r.deliveryModel} · {FUNDING_FIT_LABELS[r.fundingFit] ?? r.fundingFit} · evidence {r.coveragePercent}%
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.rationale.map((c, i) => (
                    <Badge key={i} tone={c.tone} title={c.detail}>
                      {c.label}
                    </Badge>
                  ))}
                </div>
                <div>
                  {r.isAdopted && adoptedId ? (
                    <Link href={`/programs/${adoptedId}`} style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
                      Open in Program Management →
                    </Link>
                  ) : (
                    <MutationForm action={adoptProgram} submitLabel="Add to portfolio" hidden={{ libraryKey: r.programKey }} />
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RoiView({
  roiItems,
  rollup,
}: {
  roiItems: Awaited<ReturnType<typeof loadProgramRoi>>;
  rollup: ReturnType<typeof roiRollup>;
}): ReactNode {
  if (roiItems.length === 0) {
    return (
      <EmptyState
        title="No Competency programs yet"
        hint="Adopt a Competency from the library, then tag the ACE deals it drives to measure ROI."
        action={
          <Link href="/programs?view=available" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
            Browse the library →
          </Link>
        }
      />
    );
  }
  const withWins = rollup.byProgram.filter((p) => p.wonTCV > 0);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <MetricStrip>
        <MetricCard label="Competencies" value={String(rollup.programs)} icon={<IconPrograms size={15} />} />
        <MetricCard label="Attributed deals" value={String(rollup.attributedCount)} icon={<IconPortfolio size={15} />} />
        <MetricCard label="Open pipeline" value={money(rollup.openTCV)} tone="info" icon={<IconPortfolio size={15} />} />
        <MetricCard label="Won TCV" value={money(rollup.wonTCV)} tone="ok" icon={<IconMdf size={15} />} size="lg" />
        <MetricCard label="Won since achieved" value={money(rollup.influencedWonTCV)} tone="ok" icon={<IconMdf size={15} />} />
      </MetricStrip>

      <Panel title="Won TCV by Competency">
        {withWins.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
            No won deals attributed yet — tag closed-won ACE opportunities to a Competency in ACE.
          </p>
        ) : (
          <BarChart
            color="var(--ok)"
            data={withWins.map((p) => ({ label: p.name, value: p.wonTCV, display: money(p.wonTCV) }))}
          />
        )}
      </Panel>

      <Panel title="Per-Competency ROI">
        <div style={{ display: "grid", gap: 10 }}>
          {roiItems.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <Link href={`/programs/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
                  {r.name}
                </Link>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                {r.roi.attributedCount} attributed · open {money(r.roi.openTCV)} · won {money(r.roi.wonTCV)} ·{" "}
                launched {r.roi.launchedCount} · won since achieved{" "}
                {r.roi.influencedWonTCV === null ? "—" : money(r.roi.influencedWonTCV)}
              </p>
            </Card>
          ))}
        </div>
      </Panel>
    </div>
  );
}
