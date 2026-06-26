import type { ReactNode } from "react";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { opportunities, aceRelationships, aceInteractions, users, partnerCentralOpportunities, awsConnection, solutions, opportunityAwsTeam, programs } from "@/db/schema";
import { addDays } from "@/domain/dates";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { RingGauge } from "@/components/ui/RingGauge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { Pagination } from "@/components/ui/Pagination";
import { parseListParams, listHref, pageCount, type ListParams } from "@/domain/list";
import {
  createOpportunity,
  updateOpportunity,
  approveRouting,
  createRelationship,
  updateRelationship,
  logInteraction,
} from "@/domain/ace/actions";
import { syncPartnerCentral } from "@/domain/aws/actions";
import {
  filterOpportunities,
  viewCounts,
  pipelineSummary,
  repWorkload,
  stageFunnel,
  winRate,
  priorityScore,
  hygieneIssues,
  isHighValue,
  isAtRisk,
  STAGE_LABELS,
  SOURCE_LABELS,
  OPP_VIEWS,
  OPP_VIEW_LABELS,
  type OppView,
  type OppLike,
  type FunnelStage,
} from "@/domain/ace/opportunities";
import { coverageByAccount, ROLE_LABELS } from "@/domain/ace/relationships";
import {
  computeRepHealth,
  repHealthSummary,
  HEALTH_BAND_LABELS,
  type HealthBand,
} from "@/domain/ace/rep-intelligence";
import {
  repRollups,
  prioritizeReps,
  rollupByRole,
  rollupByAccount,
  coverageGaps,
  salesOrgSummary,
  AWS_ORG_TITLE_LABELS,
  type RepRollup,
  type SalesOrgOpp,
  type TeamEdge,
} from "@/domain/ace/sales-org";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;
const money = (n: number): string => `$${n.toLocaleString()}`;
const ctaLink = { color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 600 } as const;
const CADENCE_WINDOW_DAYS = 90;
const KIND_LABELS = { meeting: "Meeting", email: "Email", call: "Call", qbr: "QBR", note: "Note" } as const;

const HEALTH_TONE: Record<HealthBand, "ok" | "info" | "warn" | "danger"> = {
  strong: "ok",
  healthy: "ok",
  fair: "info",
  weak: "warn",
  dormant: "danger",
};

type Tab = "opportunities" | "relationships" | "reps";
const TABS: { key: Tab; label: string }[] = [
  { key: "opportunities", label: "Pipeline" },
  { key: "relationships", label: "Relationships" },
  { key: "reps", label: "Sales Org" },
];

function isOppView(v: string | undefined): v is OppView {
  return v !== undefined && (OPP_VIEWS as readonly string[]).includes(v);
}

export default async function AcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canApprove = can(identity.role, "ace:approve");

  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const tab: Tab = tabParam === "relationships" || tabParam === "reps" ? tabParam : "opportunities";
  const view: OppView = isOppView(viewParam) ? viewParam : "all";
  const list = parseListParams(sp, { sortable: [], defaultSort: "created" });
  const today = new Date().toISOString().slice(0, 10);

  const { opps, rels, members, synced, awsConn, interactions, sols, team, progs } = await withTenant(identity, async (tx) => {
    const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, identity.tenantId)).orderBy(desc(opportunities.createdAt));
    const rels = await tx.select().from(aceRelationships).where(eq(aceRelationships.tenantId, identity.tenantId)).orderBy(desc(aceRelationships.createdAt));
    const members = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, identity.tenantId));
    const synced = await tx.select().from(partnerCentralOpportunities).where(eq(partnerCentralOpportunities.tenantId, identity.tenantId)).orderBy(desc(partnerCentralOpportunities.syncedAt));
    const [awsConn] = await tx.select().from(awsConnection).where(eq(awsConnection.tenantId, identity.tenantId));
    const interactions = await tx
      .select({ contactId: aceInteractions.contactId, occurredOn: aceInteractions.occurredOn, kind: aceInteractions.kind })
      .from(aceInteractions)
      .where(eq(aceInteractions.tenantId, identity.tenantId))
      .orderBy(desc(aceInteractions.occurredOn));
    const sols = await tx
      .select({ id: solutions.id, title: solutions.title })
      .from(solutions)
      .where(eq(solutions.tenantId, identity.tenantId))
      .orderBy(desc(solutions.createdAt));
    // Competency programs a deal can be credited to for ROI (any status — influence
    // is only counted post-achievement by the ROI engine).
    const progs = await tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.tenantId, identity.tenantId), eq(programs.programType, "Competency")))
      .orderBy(desc(programs.createdAt));
    const team = await tx
      .select({
        opportunityId: opportunityAwsTeam.opportunityId,
        relationshipId: opportunityAwsTeam.relationshipId,
        title: opportunityAwsTeam.title,
      })
      .from(opportunityAwsTeam)
      .where(eq(opportunityAwsTeam.tenantId, identity.tenantId));
    return { opps, rels, members, synced, awsConn, interactions, sols, team, progs };
  });

  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const summary = pipelineSummary(opps as OppLike[], today);

  // Cadence per AWS contact: touchpoints in the trailing window + latest touch.
  // Interactions are ordered newest-first, so the first seen per contact is latest.
  const cadenceByContact = new Map<string, { count: number; lastOn: string; lastKind: string }>();
  for (const i of interactions) {
    const inWindow = i.occurredOn >= addDays(today, -CADENCE_WINDOW_DAYS);
    const cur = cadenceByContact.get(i.contactId);
    if (!cur) {
      cadenceByContact.set(i.contactId, { count: inWindow ? 1 : 0, lastOn: i.occurredOn, lastKind: i.kind });
    } else if (inWindow) {
      cur.count += 1;
    }
  }

  // Persistent ACE command strip + "needs attention" band (shown on every tab so the
  // section reads as one workspace). Reuses the same pure engines the tabs use.
  const healths = computeRepHealth(
    rels.map((r) => ({ id: r.id, name: r.name, role: r.role, accountName: r.accountName, strength: r.strength, lastContact: r.lastContact })),
    opps.map((o) => ({ accountName: o.accountName, status: o.status, amount: o.amount, source: o.source, awsContactId: o.awsContactId })),
    today,
  );
  const teamOppIds = new Set(team.map((e) => e.opportunityId));
  const teamOpps = opps
    .filter((o) => teamOppIds.has(o.id))
    .map((o) => ({ id: o.id, accountName: o.accountName, status: o.status, amount: o.amount }));
  const repRoll = repRollups(
    rels.map((r) => ({ id: r.id, name: r.name, email: r.email, accountName: r.accountName })),
    team,
    teamOpps,
    healths,
  );
  const gaps = coverageGaps(teamOpps, team);
  const atRiskValue = opps.filter((o) => isAtRisk(o as OppLike, today)).reduce((s, o) => s + o.amount, 0);
  const wr = winRate(opps as OppLike[]);
  const funnel = stageFunnel(opps as OppLike[]);
  const coolingReps = repRoll.filter((r) => r.atRisk).length;

  const attention: { tone: Tone; title: string; detail: string; href: string }[] = [];
  const coolTop = [...repRoll].filter((r) => r.atRisk).sort((a, b) => b.openTCV - a.openTCV)[0];
  if (coolTop) {
    attention.push({
      tone: "warn",
      title: `Cooling AWS rep: ${coolTop.name}`,
      detail: `${money(coolTop.openTCV)} open pipeline · last contact ${coolTop.daysSinceContact === null ? "never" : `${coolTop.daysSinceContact}d ago`}.`,
      href: "/ace?tab=reps",
    });
  }
  const riskOpp = [...opps]
    .filter((o) => isAtRisk(o as OppLike, today) && isHighValue(o as OppLike))
    .sort((a, b) => b.amount - a.amount)[0];
  if (riskOpp) {
    attention.push({
      tone: "danger",
      title: `At-risk opportunity: ${riskOpp.name}`,
      detail: `${money(riskOpp.amount)} · ${STAGE_LABELS[riskOpp.stage]} — stale or past its close date.`,
      href: "/ace",
    });
  }
  if (gaps.length > 0) {
    attention.push({
      tone: "warn",
      title: "AWS coverage gap",
      detail: `${gaps.length} open ${gaps.length === 1 ? "deal is" : "deals are"} missing a Sales Rep or PSM.`,
      href: "/ace?tab=reps",
    });
  }

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { label: "ACE Intelligence" }]}
        title="ACE Intelligence"
        subtitle="Co-sell pipeline, AWS relationships, and sales-org coverage."
        actions={
          tab === "opportunities" ? (
            <FormDrawer
              triggerLabel="New opportunity"
              title="New opportunity"
              action={createOpportunity}
              submitLabel="Add"
              successMessage="Opportunity added."
            >
              <label style={labelStyle}><span style={spanStyle}>Name</span><input name="name" required maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Account</span><input name="accountName" maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>Stage</span>
                <select name="stage" defaultValue="qualified" style={controlStyle}>
                  {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={labelStyle}>
                <span style={spanStyle}>Source</span>
                <select name="source" defaultValue="partner_originated" style={controlStyle}>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Amount ($)</span><input name="amount" type="number" min={0} defaultValue={0} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Close date</span><input name="closeDate" type="date" style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>AWS seller (free text)</span><input name="awsSeller" maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>AWS contact (link)</span>
                <select name="awsContactId" defaultValue="" style={controlStyle}>
                  <option value="">— none —</option>
                  {rels.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            </FormDrawer>
          ) : tab === "relationships" ? (
            <FormDrawer
              triggerLabel="New relationship"
              title="New relationship"
              action={createRelationship}
              submitLabel="Add"
              successMessage="Relationship added."
            >
              <label style={labelStyle}><span style={spanStyle}>Name</span><input name="name" required maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>Role</span>
                <select name="role" defaultValue="seller" style={controlStyle}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Account</span><input name="accountName" maxLength={200} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Strength (0–100)</span><input name="strength" type="number" min={0} max={100} defaultValue={50} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Last contact</span><input name="lastContact" type="date" style={controlStyle} /></label>
            </FormDrawer>
          ) : undefined
        }
      />

      {/* Persistent command strip — one orientation surface across every tab. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <MetricCard label="Open pipeline" value={money(summary.openValue)} sub={`${summary.open} open ${summary.open === 1 ? "deal" : "deals"}`} tone="accent" />
        <MetricCard label="Win rate" value={wr === null ? "—" : `${wr}%`} sub={`${summary.won} won · ${money(summary.wonValue)}`} tone="ok" />
        <MetricCard label="Pipeline at risk" value={money(atRiskValue)} sub={`${summary.atRisk} ${summary.atRisk === 1 ? "deal" : "deals"}`} tone={atRiskValue > 0 ? "warn" : "neutral"} />
        <MetricCard label="Cooling AWS reps" value={String(coolingReps)} sub="open pipeline going cold" tone={coolingReps > 0 ? "warn" : "neutral"} />
        <MetricCard label="Coverage gaps" value={String(gaps.length)} sub="missing Sales Rep / PSM" tone={gaps.length > 0 ? "warn" : "neutral"} />
      </div>

      {attention.length > 0 && (
        <Panel title="Needs attention">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {attention.map((a) => (
              <Link key={a.title} href={a.href} style={{ textDecoration: "none", color: "inherit" }}>
                <Card interactive style={{ borderLeft: `3px solid ${toneColor(a.tone)}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{a.detail}</div>
                </Card>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link key={t.key} href={`/ace?tab=${t.key}`} style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, textDecoration: "none", border: "1px solid var(--border)", background: active ? "var(--accent)" : "transparent", color: active ? "var(--accent-ink)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === "opportunities" && (
        <>
          <PipelineSummaryPanel summary={summary} funnel={funnel} winRate={wr} />
          <SyncedPartnerCentral synced={synced} connection={awsConn} />
          <Opportunities opps={opps} rels={rels} view={view} today={today} members={members} emailById={emailById} canApprove={canApprove} list={list} sols={sols} progs={progs} />
        </>
      )}
      {tab === "relationships" && <Relationships rels={rels} opps={opps} cadence={cadenceByContact} today={today} list={list} />}
      {tab === "reps" && (
        <Reps
          opps={opps}
          rels={rels}
          members={members}
          team={team}
          today={today}
          rsort={Array.isArray(sp.rsort) ? sp.rsort[0] : sp.rsort}
        />
      )}
    </PageShell>
  );
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "var(--ok)";
    case "warn":
      return "var(--warn)";
    case "danger":
      return "var(--danger)";
    case "accent":
    case "info":
      return "var(--accent)";
    default:
      return "var(--text)";
  }
}

/** Blue while a deal is in flight; green once it converts (Launched = won). */
function stageColor(stage: string): string {
  return stage === "launched" ? "var(--ok)" : "var(--info)";
}

function StageFunnel({ stages }: { stages: FunnelStage[] }): ReactNode {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {stages.map((s) => (
        <div key={s.stage} style={{ display: "grid", gridTemplateColumns: "118px 1fr auto", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
          <div style={{ height: 16, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(s.count / max) * 100}%`, height: "100%", background: stageColor(s.stage), minWidth: s.count > 0 ? 3 : 0, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 12, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {s.count}
            {s.value > 0 ? <span style={{ color: "var(--muted)" }}> · {money(s.value)}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function PipelineSummaryPanel({
  summary,
  funnel,
  winRate: wr,
}: {
  summary: ReturnType<typeof pipelineSummary>;
  funnel: FunnelStage[];
  winRate: number | null;
}): ReactNode {
  return (
    <Panel title="Pipeline" actions={<a href="/ace/export" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>Account plan (CSV)</a>}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
        <RingGauge value={wr ?? 0} max={100} size={120} color="var(--ok)" label={wr === null ? "—" : `${wr}%`} caption="Win rate" />
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Opportunities by stage</div>
          <StageFunnel stages={funnel} />
        </div>
      </div>
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
          ["Open value", money(summary.openValue)],
          ["Won value", money(summary.wonValue)],
          ["Amazon-orig.", String(summary.bySource.amazon_originated)],
          ["Marketplace", String(summary.bySource.marketplace)],
        ] as const).map(([k, v]) => (
          <div key={k}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SyncedPartnerCentral({
  synced,
  connection,
}: {
  synced: (typeof partnerCentralOpportunities.$inferSelect)[];
  connection: typeof awsConnection.$inferSelect | undefined;
}): ReactNode {
  const configured = Boolean(connection?.enabled);
  const lastSynced = connection?.lastSyncedAt ? connection.lastSyncedAt.toISOString().slice(0, 10) : null;
  return (
    <Panel title="Synced from AWS Partner Central">
      {!configured ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Connect AWS in{" "}
          <Link href="/settings?section=integrations" style={{ color: "var(--accent)" }}>
            Settings → Integrations
          </Link>{" "}
          to sync co-sell opportunities from Partner Central (Sandbox).
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {synced.length} synced · catalog {connection?.catalog ?? "Sandbox"}
              {lastSynced ? ` · last sync ${lastSynced}` : " · never synced"}
            </span>
            <MutationForm action={syncPartnerCentral} submitLabel="Sync now" variant="secondary" />
          </div>
          {synced.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
              No synced opportunities yet — click <strong>Sync now</strong> to pull from Partner Central.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {synced.map((o) => (
                <Card key={o.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <strong style={{ fontSize: 14 }}>{o.name}</strong>
                    <Badge tone="info">AWS</Badge>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                    {o.accountName || "—"} · {STAGE_LABELS[o.stage]} · {money(o.amount)} ·{" "}
                    <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Opportunities({
  opps,
  rels,
  view,
  today,
  members,
  emailById,
  canApprove,
  list,
  sols,
  progs,
}: {
  opps: (typeof opportunities.$inferSelect)[];
  rels: (typeof aceRelationships.$inferSelect)[];
  view: OppView;
  today: string;
  members: ReadonlyArray<{ id: string; email: string }>;
  emailById: Map<string, string>;
  canApprove: boolean;
  list: ListParams;
  sols: ReadonlyArray<{ id: string; title: string }>;
  progs: ReadonlyArray<{ id: string; name: string }>;
}): ReactNode {
  const relNameById = new Map(rels.map((r) => [r.id, r.name]));
  const counts = viewCounts(opps as OppLike[], { today });
  const filtered = filterOpportunities(opps, view, { today });
  const searched = list.q
    ? filtered.filter((o) => o.name.toLowerCase().includes(list.q.toLowerCase()))
    : filtered;
  const total = searched.length;
  const paged = searched.slice(list.offset, list.offset + list.pageSize);
  const totalPages = pageCount(total, list.pageSize);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {OPP_VIEWS.map((v) => {
            const active = v === view;
            return (
              <Link key={v} href={listHref("/ace", { tab: "opportunities", view: v, q: list.q })} style={{ padding: "5px 10px", borderRadius: 999, fontSize: 12, textDecoration: "none", border: "1px solid var(--border)", background: active ? "var(--accent)" : "transparent", color: active ? "var(--accent-ink)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>
                {OPP_VIEW_LABELS[v]} ({counts[v]})
              </Link>
            );
          })}
        </nav>
        <SearchForm q={list.q} placeholder="Search by name…" hidden={{ tab: "opportunities", view }} />
      </div>

      <SavedViewsBar listKey="ace:opportunities" current={{ tab: "opportunities", view, q: list.q }} />

      {paged.length === 0 ? (
        <Panel>
          <EmptyState
            title={list.q ? "No matches" : "No opportunities yet"}
            hint={
              list.q
                ? `No opportunities match “${list.q}” in this view.`
                : "Add a co-sell opportunity with “New opportunity” above, or sync them from AWS Partner Central."
            }
            action={
              list.q ? (
                <Link href="/ace?tab=opportunities" style={ctaLink}>Clear search</Link>
              ) : (
                <Link href="/settings?tab=integrations" style={ctaLink}>Connect AWS Partner Central →</Link>
              )
            }
          />
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {paged.map((o) => {
            const issues = hygieneIssues(o as OppLike, today);
            return (
              <Card key={o.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{o.name}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    P{priorityScore(o as OppLike, today)} · {money(o.amount)} · {SOURCE_LABELS[o.source]}
                    {isHighValue(o as OppLike) ? " · high-value" : ""}
                    {isAtRisk(o as OppLike, today) ? " · at-risk" : ""}
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {o.accountName || "—"} · {STAGE_LABELS[o.stage]} · <Badge tone={statusTone(o.status)}>{o.status}</Badge> · Owner {o.ownerUserId ? emailById.get(o.ownerUserId) ?? "—" : "Unassigned"} · routing <Badge tone={statusTone(o.routingStatus)}>{o.routingStatus}</Badge>
                  {o.awsContactId ? ` · AWS ${relNameById.get(o.awsContactId) ?? "contact"}` : o.awsSeller ? ` · AWS ${o.awsSeller}` : ""}
                </p>
                {issues.length > 0 && (
                  <p style={{ color: "var(--warn)", fontSize: 12, margin: "0 0 8px" }}>⚠ {issues.join(" · ")}</p>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  <FormDrawer
                    triggerLabel="Edit"
                    triggerVariant="secondary"
                    title="Edit opportunity"
                    action={updateOpportunity}
                    submitLabel="Save changes"
                    successMessage="Opportunity updated."
                    submitVariant="secondary"
                    hidden={{ opportunityId: o.id }}
                  >
                    <label style={labelStyle}>
                      <span style={spanStyle}>Owner (route)</span>
                      <select name="ownerUserId" defaultValue={o.ownerUserId ?? ""} style={controlStyle}>
                        <option value="">Unassigned</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Stage</span>
                      <select name="stage" defaultValue={o.stage} style={controlStyle}>
                        {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Status</span>
                      <select name="status" defaultValue={o.status} style={controlStyle}>
                        <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
                      </select>
                    </label>
                    <label style={labelStyle}><span style={spanStyle}>Last interaction</span><input name="lastInteraction" type="date" defaultValue={o.lastInteraction ?? ""} style={controlStyle} /></label>
                    <label style={labelStyle}><span style={spanStyle}>Next step</span><input name="nextStep" maxLength={500} defaultValue={o.nextStep} style={controlStyle} /></label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>AWS contact (link)</span>
                      <select name="awsContactId" defaultValue={o.awsContactId ?? ""} style={controlStyle}>
                        <option value="">— none —</option>
                        {rels.map((rr) => <option key={rr.id} value={rr.id}>{rr.name}</option>)}
                      </select>
                    </label>
                    {sols.length > 0 && (
                      <label style={labelStyle}>
                        <span style={spanStyle}>Solution (renewal credit)</span>
                        <select name="solutionId" defaultValue={o.solutionId ?? ""} style={controlStyle}>
                          <option value="">— none —</option>
                          {sols.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                        </select>
                      </label>
                    )}
                    {progs.length > 0 && (
                      <label style={labelStyle}>
                        <span style={spanStyle}>Competency (ROI credit)</span>
                        <select name="programId" defaultValue={o.programId ?? ""} style={controlStyle}>
                          <option value="">— none —</option>
                          {progs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                  </FormDrawer>

                  {o.routingStatus === "approved" ? (
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      <span style={{ color: "var(--accent)" }}>Routing approved</span>
                      {o.taskId && <> · <Link href="/tasks" style={{ color: "var(--accent)" }}>follow-up task</Link></>}
                    </span>
                  ) : o.routingStatus === "routed" && canApprove ? (
                    <MutationForm action={approveRouting} submitLabel="Approve routing → task" variant="secondary" hidden={{ opportunityId: o.id }} />
                  ) : o.routingStatus === "routed" ? (
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>Routed — awaiting approval</span>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>Assign an owner to route</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Pagination
        page={list.page}
        totalPages={totalPages}
        total={total}
        prevHref={listHref("/ace", { tab: "opportunities", view, q: list.q, page: list.page - 1 })}
        nextHref={listHref("/ace", { tab: "opportunities", view, q: list.q, page: list.page + 1 })}
      />
    </>
  );
}

function Relationships({
  rels,
  opps,
  cadence,
  today,
  list,
}: {
  rels: (typeof aceRelationships.$inferSelect)[];
  opps: (typeof opportunities.$inferSelect)[];
  cadence: Map<string, { count: number; lastOn: string; lastKind: string }>;
  today: string;
  list: ListParams;
}): ReactNode {
  // Measured relationship health: each AWS contact scored against the co-sell
  // opportunities in its account. Most-needing-attention first.
  const healths = computeRepHealth(rels, opps, today);
  const summary = repHealthSummary(healths);
  const relById = new Map(rels.map((r) => [r.id, r]));
  const coverage = coverageByAccount(rels);

  const searched = list.q
    ? healths.filter((h) => h.name.toLowerCase().includes(list.q.toLowerCase()))
    : healths;
  const total = searched.length;
  const paged = searched.slice(list.offset, list.offset + list.pageSize);
  const totalPages = pageCount(total, list.pageSize);

  return (
    <>
      {healths.length > 0 && (
        <Panel title="Relationship health">
          <BarChart
            formatValue={(n) => String(n)}
            data={[
              { label: "Strong", value: summary.byBand.strong, color: "var(--ok)" },
              { label: "Healthy", value: summary.byBand.healthy, color: "var(--ok)" },
              { label: "Fair", value: summary.byBand.fair, color: "var(--info)" },
              { label: "Weak", value: summary.byBand.weak, color: "var(--warn)" },
              { label: "Dormant", value: summary.byBand.dormant, color: "var(--danger)" },
            ]}
          />
          <div style={{ display: "flex", gap: 24, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            {([
              ["AWS relationships", String(summary.total)],
              ["Avg health", `${summary.avgScore}/100`],
              ["Pipeline at risk", money(summary.pipelineAtRisk)],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: k === "Pipeline at risk" && summary.pipelineAtRisk > 0 ? "var(--danger)" : undefined }}>{v}</div>
              </div>
            ))}
          </div>
          {summary.atRiskCount > 0 && (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: "12px 0 0" }}>
              ⚠ {summary.atRiskCount} cooling relationship{summary.atRiskCount === 1 ? "" : "s"} with {money(summary.pipelineAtRisk)} of pipeline at stake — re-engage soon.
            </p>
          )}
        </Panel>
      )}

      {coverage.length > 0 && (
        <Panel title="Account coverage">
          <div style={{ display: "grid", gap: 6 }}>
            {coverage.map((c) => (
              <div key={c.account} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
                <span>{c.account}</span>
                <span style={{ color: c.hasStrong ? "var(--accent)" : "var(--warn)" }}>{c.contacts} contact(s) · best {c.maxStrength}{c.hasStrong ? "" : " · no strong tie"}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <SearchForm q={list.q} placeholder="Search by name…" hidden={{ tab: "relationships" }} />
      </div>

      <SavedViewsBar listKey="ace:relationships" current={{ tab: "relationships", q: list.q }} />

      {paged.length === 0 ? (
        <Panel>
          <EmptyState
            title={list.q ? "No matches" : "No AWS relationships yet"}
            hint={
              list.q
                ? `No relationships match “${list.q}”.`
                : "Add an AWS contact with “New relationship” above, or enable Enrich AWS team on the Partner Central connection to pull them in automatically."
            }
            action={
              list.q ? (
                <Link href="/ace?tab=relationships" style={ctaLink}>Clear search</Link>
              ) : (
                <Link href="/settings?tab=integrations" style={ctaLink}>Connect AWS Partner Central →</Link>
              )
            }
          />
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {paged.map((h) => {
            const r = relById.get(h.id);
            const cad = cadence.get(h.id);
            return (
              <Card key={h.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{h.name}</strong>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Badge tone={HEALTH_TONE[h.band]}>{HEALTH_BAND_LABELS[h.band]}</Badge>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{h.score}/100</span>
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                  {ROLE_LABELS[h.role]} · {h.accountName || "—"} · last contact {h.daysSinceContact === null ? "never" : `${h.daysSinceContact}d ago`}
                </p>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>
                  Recency {h.recency} · Strength {h.strength} · Momentum {h.momentum}
                  {h.openCount > 0 ? ` · ${h.openCount} open · ${money(h.openValue)} pipeline` : ""}
                  {h.originated > 0 ? ` · ${h.originated} AWS-originated` : ""}
                </p>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>
                  {cad
                    ? `${cad.count} touch${cad.count === 1 ? "" : "es"} / 90d · last ${KIND_LABELS[cad.lastKind as keyof typeof KIND_LABELS]} ${cad.lastOn}`
                    : "No touchpoints logged"}
                </p>
                {h.atStake && (
                  <p style={{ color: "var(--danger)", fontSize: 12, margin: "6px 0 0" }}>
                    ⚠ {money(h.openValue)} pipeline at risk — relationship cooling
                  </p>
                )}
                {r && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                    <FormDrawer
                      triggerLabel="Log touch"
                      triggerVariant="secondary"
                      title={`Log touch — ${r.name}`}
                      action={logInteraction}
                      submitLabel="Log"
                      successMessage="Touchpoint logged."
                      submitVariant="secondary"
                      hidden={{ contactId: r.id }}
                    >
                      <label style={labelStyle}><span style={spanStyle}>Date</span><input name="occurredOn" type="date" defaultValue={today} style={controlStyle} /></label>
                      <label style={labelStyle}>
                        <span style={spanStyle}>Type</span>
                        <select name="kind" defaultValue="meeting" style={controlStyle}>
                          {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </label>
                      <label style={labelStyle}><span style={spanStyle}>Note</span><input name="note" maxLength={2000} style={controlStyle} /></label>
                    </FormDrawer>
                    <FormDrawer
                      triggerLabel="Edit"
                      triggerVariant="secondary"
                      title="Edit relationship"
                      action={updateRelationship}
                      submitLabel="Save changes"
                      successMessage="Relationship updated."
                      submitVariant="secondary"
                      hidden={{ relationshipId: r.id }}
                    >
                      <label style={labelStyle}>
                        <span style={spanStyle}>Role</span>
                        <select name="role" defaultValue={r.role} style={controlStyle}>
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </label>
                      <label style={labelStyle}><span style={spanStyle}>Strength</span><input name="strength" type="number" min={0} max={100} defaultValue={r.strength} style={controlStyle} /></label>
                      <label style={labelStyle}><span style={spanStyle}>Last contact</span><input name="lastContact" type="date" defaultValue={r.lastContact ?? ""} style={controlStyle} /></label>
                      <label style={labelStyle}><span style={spanStyle}>Notes</span><input name="notes" maxLength={2000} defaultValue={r.notes} style={controlStyle} /></label>
                    </FormDrawer>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Pagination
        page={list.page}
        totalPages={totalPages}
        total={total}
        prevHref={listHref("/ace", { tab: "relationships", q: list.q, page: list.page - 1 })}
        nextHref={listHref("/ace", { tab: "relationships", q: list.q, page: list.page + 1 })}
      />
    </>
  );
}

function sortRollups(rollups: readonly RepRollup[], key: string): RepRollup[] {
  if (key === "open") return [...rollups].sort((a, b) => b.openCount - a.openCount || b.openTCV - a.openTCV);
  if (key === "tcv") return [...rollups].sort((a, b) => b.openTCV - a.openTCV);
  if (key === "won") return [...rollups].sort((a, b) => b.closedWonTCV - a.closedWonTCV);
  if (key === "last") {
    const d = (n: number | null): number => (n === null ? Number.POSITIVE_INFINITY : n);
    return [...rollups].sort((a, b) => d(b.daysSinceContact) - d(a.daysSinceContact));
  }
  return prioritizeReps(rollups);
}

const REP_SORT_KEYS = new Set(["open", "tcv", "won", "last"]);

function Reps({
  opps,
  rels,
  members,
  team,
  today,
  rsort,
}: {
  opps: (typeof opportunities.$inferSelect)[];
  rels: (typeof aceRelationships.$inferSelect)[];
  members: ReadonlyArray<{ id: string; email: string }>;
  team: ReadonlyArray<TeamEdge>;
  today: string;
  rsort: string | undefined;
}): ReactNode {
  const emailById = new Map(members.map((m) => [m.id, m.email]));

  // Per-AWS-rep health (band/recency/at-stake) over all opps, then precise rollups
  // over the junction restricted to AWS-team-linked opportunities.
  const healths = computeRepHealth(
    rels.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      accountName: r.accountName,
      strength: r.strength,
      lastContact: r.lastContact,
    })),
    opps.map((o) => ({ accountName: o.accountName, status: o.status, amount: o.amount, source: o.source, awsContactId: o.awsContactId })),
    today,
  );
  const teamOppIds = new Set(team.map((e) => e.opportunityId));
  const teamOpps: SalesOrgOpp[] = opps
    .filter((o) => teamOppIds.has(o.id))
    .map((o) => ({ id: o.id, accountName: o.accountName, status: o.status, amount: o.amount }));
  const salesRels = rels.map((r) => ({ id: r.id, name: r.name, email: r.email, accountName: r.accountName }));

  const rollups = repRollups(salesRels, team, teamOpps, healths);
  const roles = rollupByRole(team, teamOpps);
  const accounts = rollupByAccount(team, teamOpps);
  const gaps = coverageGaps(teamOpps, team);
  const summary = salesOrgSummary(teamOpps, rollups, gaps);
  const noSalesRep = gaps.filter((g) => g.missingSalesRep).length;
  const noPsm = gaps.filter((g) => g.missingPsm).length;

  const activeSort = rsort && REP_SORT_KEYS.has(rsort) ? rsort : "priority";
  const sortState = { sort: activeSort, dir: "desc" as const, href: (k: string) => `/ace?tab=reps&rsort=${k}` };
  const sorted = sortRollups(rollups, activeSort);

  const internal = repWorkload(opps as OppLike[]);
  const roleMax = Math.max(1, ...roles.map((r) => r.openTCV));

  const internalPanel = (
    <Panel title="Your team (internal workload)">
      <Table
        rows={internal}
        rowKey={(r) => r.ownerUserId}
        empty="No routed opportunities yet."
        columns={[
          { key: "rep", header: "Rep", render: (r) => emailById.get(r.ownerUserId) ?? "—" },
          { key: "open", header: "Open opps", align: "right", render: (r) => String(r.openCount) },
          { key: "value", header: "Open value", align: "right", render: (r) => money(r.openValue) },
        ]}
      />
    </Panel>
  );

  if (rollups.length === 0) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Panel title="AWS sales org">
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            No AWS sales contacts yet. Enable <strong>Enrich AWS team</strong> on the AWS Partner
            Central connection in{" "}
            <Link href="/settings?tab=integrations" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Settings
            </Link>{" "}
            and run a sync to pull each deal&apos;s AWS Sales Rep / PSM / PDM, or link an AWS contact
            on an opportunity manually. Then this tab shows per-rep open opportunities, closed-won TCV,
            and coverage gaps.
          </p>
        </Panel>
        {internalPanel}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="AWS sales org">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <Stat label="AWS reps" value={String(summary.reps)} />
          <Stat label="Open pipeline" value={money(summary.openTCV)} />
          <Stat label="Closed-won TCV" value={money(summary.closedWonTCV)} />
          <Stat label="Coverage gaps" value={String(summary.gaps)} tone={summary.gaps > 0 ? "warn" : undefined} />
        </div>
        {(noSalesRep > 0 || noPsm > 0) && (
          <p style={{ margin: "0 0 12px", color: "var(--warn)", fontSize: 12 }}>
            ⚠ {noSalesRep} open {noSalesRep === 1 ? "deal" : "deals"} without an AWS Sales Rep · {noPsm}{" "}
            without a PSM — parts of the sales org to engage.
          </p>
        )}
        {roles.length > 0 && (
          <BarChart
            color="var(--accent-2)"
            data={roles.map((r) => ({
              label: `${AWS_ORG_TITLE_LABELS[r.title]} (${r.reps})`,
              value: r.openTCV,
              display: money(r.openTCV),
            }))}
            max={roleMax}
          />
        )}
      </Panel>

      <Panel title={`AWS reps (${rollups.length})`}>
        <Table
          rows={sorted}
          rowKey={(r) => r.id}
          sort={sortState}
          rowStyle={(r) => (r.atRisk ? { background: "color-mix(in srgb, var(--warn) 9%, transparent)" } : undefined)}
          empty="No AWS reps linked yet."
          columns={[
            {
              key: "rep",
              header: "AWS rep",
              render: (r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <Avatar name={r.name} />
                  <span>
                    {r.atRisk ? <span title="Open pipeline on a cooling relationship" style={{ color: "var(--warn)" }}>⚠ </span> : null}
                    <strong>{r.name}</strong>
                    {r.email ? <span style={{ color: "var(--muted)", fontSize: 12 }}> · {r.email}</span> : null}
                  </span>
                </span>
              ),
            },
            { key: "title", header: "Role", render: (r) => <Badge>{AWS_ORG_TITLE_LABELS[r.primaryTitle]}</Badge> },
            { key: "accounts", header: "Accounts", render: (r) => r.accounts.join(", ") || "—" },
            { key: "open", header: "Open opps", align: "right", sortKey: "open", render: (r) => String(r.openCount) },
            { key: "openTCV", header: "Open pipeline", align: "right", sortKey: "tcv", render: (r) => money(r.openTCV) },
            { key: "wonTCV", header: "Closed-won TCV", align: "right", sortKey: "won", render: (r) => money(r.closedWonTCV) },
            {
              key: "last",
              header: "Last contact",
              align: "right",
              sortKey: "last",
              render: (r) => (r.daysSinceContact === null ? "never" : `${r.daysSinceContact}d`),
            },
            {
              key: "health",
              header: "Health",
              render: (r) =>
                r.band ? <Badge tone={HEALTH_TONE[r.band]}>{HEALTH_BAND_LABELS[r.band]}</Badge> : <Badge>—</Badge>,
            },
          ]}
        />
      </Panel>

      <Panel title="Account coverage">
        <Table
          rows={accounts}
          rowKey={(a) => a.account}
          empty="No AWS-team accounts yet."
          columns={[
            { key: "account", header: "Account", render: (a) => a.account },
            { key: "open", header: "Open pipeline", align: "right", render: (a) => money(a.openTCV) },
            { key: "won", header: "Closed-won TCV", align: "right", render: (a) => money(a.closedWonTCV) },
            {
              key: "coverage",
              header: "Coverage",
              render: (a) => (
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={a.hasSalesRep ? "ok" : "warn"}>{a.hasSalesRep ? "Sales Rep" : "no Sales Rep"}</Badge>
                  <Badge tone={a.hasPsm ? "ok" : "warn"}>{a.hasPsm ? "PSM" : "no PSM"}</Badge>
                </span>
              ),
            },
          ]}
        />
      </Panel>

      {internalPanel}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | undefined }): ReactNode {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 20, fontWeight: 600, color: tone === "warn" ? "var(--warn)" : "var(--text)" }}>
        {value}
      </span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || "?").toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase() || "?";
}

/** Deterministic initials avatar — a colored chip per AWS rep, to humanize the directory. */
function Avatar({ name }: { name: string }): ReactNode {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: `hsl(${hue} 55% 88%)`,
        color: `hsl(${hue} 45% 32%)`,
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
