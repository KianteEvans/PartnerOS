import type { ReactNode } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { can, type Permission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { tenants, onboarding } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { ActivityList } from "@/components/ui/ActivityList";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { ButtonLink } from "@/components/ui/Button";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  IconOnboarding,
  IconAssessments,
  IconRoadmaps,
  IconMdf,
  IconTasks,
  IconClock,
  IconPrograms,
  IconTiers,
  IconMarketplace,
  type IconProps,
} from "@/components/ui/icons";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { loadHubTrends, captureMetricSnapshot } from "@/domain/command/trends-load";
import { deferAfterResponse } from "@/http/defer";
import { loadMarketplaceTrends } from "@/domain/marketplace/load";
import { winRate } from "@/domain/ace/opportunities";
import { completeness } from "@/domain/evidence/inventory";
import { portfolioSummary as mdfPortfolioSummary } from "@/domain/mdf/analytics";
import { loadBenchmarks } from "@/domain/benchmarks/load";
import { BenchmarksPanel } from "@/app/BenchmarksPanel";
import { mkTrend } from "@/domain/trend";
import type { Decision } from "@/domain/command/brief";
import { progressPercent, stepIndex, WIZARD_STEPS, type OnboardingStepId } from "@/domain/onboarding/catalog";
import { loadActivation } from "@/domain/onboarding/activation-load";
import { activationChecklist } from "@/domain/onboarding/activation";
import { HomeActivation } from "@/app/HomeActivation";
import { moneyFromCents } from "@/domain/format";
import { isPathIncluded } from "@/domain/packaging/catalog";
import { effectivePackageTier } from "@/domain/packaging/preview";

const money = (cents: number): string => moneyFromCents(cents, 0);

/**
 * Workspace home — a true hub rather than a status card. It reuses the Command
 * Center aggregations verbatim (loadCommandData + buildCommandCenter), so the
 * partnership-health, "needs attention", and progress numbers stay in lockstep
 * with the Command Center and the notification bell. Identity is from the verified
 * session (Rule 4); all reads are tenant-scoped (Rule 7).
 */

const BAND_TONE: Record<string, Tone> = { strong: "ok", fair: "warn", at_risk: "danger" };
const BAND_LABEL: Record<string, string> = { strong: "Strong", fair: "Fair", at_risk: "At risk" };

export default async function HomePage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) {
    return <MarketingHome />;
  }
  return <SignedIn identity={identity} />;
}

async function SignedIn({
  identity,
}: {
  identity: NonNullable<Awaited<ReturnType<typeof tryGetServerIdentity>>>;
}): Promise<ReactNode> {
  const today = new Date().toISOString().slice(0, 10);
  const canReceipts = can(identity.role, "audit:read");

  const { tenant, onboardingComplete, onboardingStep } = await withTenant(identity, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, identity.tenantId));
    const [ob] = await tx
      .select({ status: onboarding.status, step: onboarding.step })
      .from(onboarding)
      .where(eq(onboarding.tenantId, identity.tenantId));
    return {
      tenant,
      onboardingComplete: ob?.status === "completed",
      onboardingStep: (ob?.step ?? null) as OnboardingStepId | null,
    };
  });

  // First-run: a focused onboarding screen instead of the full hub — now with the
  // partner's real progress + a Resume button so they can pick up where they left off.
  if (!onboardingComplete) {
    const step: OnboardingStepId = onboardingStep ?? "context";
    const started = onboardingStep !== null;
    const pct = progressPercent(step);
    return (
      <PageShell width={720}>
        <PageHeader title={`Welcome${tenant?.name ? ` to ${tenant.name}` : ""}`} />
        <Panel>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            <RingGauge value={pct} max={100} size={96} caption="set up" />
            <div style={{ flex: 1, minWidth: 260, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <IconOnboarding size={20} />
                <h2 style={{ margin: 0, fontSize: 16 }}>Finish setting up your workspace</h2>
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.5 }}>
                {started
                  ? `Step ${stepIndex(step) + 1} of ${WIZARD_STEPS.length} · ${pct}% complete. We'll seed a starter readiness assessment, kickoff tasks, and a roadmap tailored to your goals.`
                  : "A quick 4-step setup that seeds a starter readiness assessment, kickoff tasks, and a roadmap tailored to your goals."}
              </p>
              <div style={{ marginTop: 4 }}>
                <ButtonLink href="/onboarding">{started ? "Resume onboarding" : "Start onboarding"}</ButtonLink>
              </div>
            </div>
          </div>
        </Panel>
      </PageShell>
    );
  }

  const data = await loadCommandData(identity);
  const cc = buildCommandCenter(data.inputs, today, data.dismissedIds);
  // Marketplace KPIs for the hub card + snapshot — the last point of each daily series is
  // today's value (captured on read). Best-effort so a marketplace hiccup never blocks home.
  const mp = await loadMarketplaceTrends(identity, today).catch(() => null);
  const mpRevenueCents = mp?.revenue.at(-1) ?? 0;
  // The three extra benchmarkable metrics (Bet B) — computed from the same
  // already-loaded inputs, so the snapshot feeds the cross-tenant cohorts.
  const mdfRoi = mdfPortfolioSummary(data.inputs.mdf, today).roi;
  // Today's metrics, captured by value AFTER the response streams (idempotent,
  // best-effort); the sparkline read below overlays the same values in memory so
  // the series still ends at "now" before the write lands.
  const snapshotValues = {
    openWork: cc.work.open,
    overdue: cc.work.overdue,
    activePrograms: cc.progress.programsActive,
    programsTotal: cc.progress.programsTotal,
    tierPercent: cc.progress.tierPercent ?? null,
    healthScore: cc.health.score,
    marketplacePublished: mp?.published.at(-1) ?? 0,
    marketplaceActiveEntitlements: mp?.activeEntitlements.at(-1) ?? 0,
    marketplaceRevenueCents: mpRevenueCents,
    winRatePercent: winRate(data.inputs.opportunities),
    evidencePercent: completeness(data.inputs.evidence).percent,
    mdfRoiX100: mdfRoi == null ? null : Math.round(mdfRoi * 100),
  };
  await deferAfterResponse(() => captureMetricSnapshot(identity, snapshotValues, today));
  const trends = await loadHubTrends(identity, { today, values: snapshotValues });
  // Cross-tenant benchmarks (Bet B) — best-effort; gated on reciprocal opt-in.
  const benchmarks = await loadBenchmarks(identity).catch(() => ({ participating: false as const }));
  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  const ownerName = (id: string | null): string => (id ? emailById.get(id) ?? "—" : "Unassigned");
  const decisions = cc.decisions.slice(0, 5);

  // "Getting started" activation checklist — guides newly-onboarded partners to
  // first value; retires itself once every item is done.
  const { answers, counts } = await loadActivation(identity);
  const activation = activationChecklist(answers, counts);

  const quickActions: ReadonlyArray<{
    perm: Permission;
    href: string;
    label: string;
    hint: string;
    Icon: (p: IconProps) => ReactNode;
  }> = [
    { perm: "assessment:create", href: "/plan/new", label: "New assessment", hint: "Readiness or GTM", Icon: IconAssessments },
    { perm: "roadmap:create", href: "/plan/roadmaps/new", label: "New roadmap", hint: "Compose from catalog", Icon: IconRoadmaps },
    { perm: "mdf:create", href: "/mdf", label: "Request MDF", hint: "Start a funding claim", Icon: IconMdf },
    { perm: "task:create", href: "/command/tasks", label: "New task", hint: "Assign to your team", Icon: IconTasks },
  ];
  const previewTier = await effectivePackageTier();
  const actions = quickActions.filter((q) => can(identity.role, q.perm) && isPathIncluded(previewTier, q.href));

  return (
    <PageShell>
      <PageHeader
        title="Workspace"
        subtitle={
          <>
            {tenant?.name ?? "—"} · {tenant?.tier ?? "—"} tier · signed in as {identity.email}
          </>
        }
      />

      {/* Hero: partnership health + headline metrics */}
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 140 }}>
          <RingGauge value={cc.health.score} color="var(--accent-2)" size={118} />
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Health</span>
            <Badge tone={BAND_TONE[cc.health.band] ?? "neutral"}>{BAND_LABEL[cc.health.band] ?? cc.health.band}</Badge>
          </div>
        </div>
        <MetricStrip min={132} style={{ flex: 1, minWidth: 244 }}>
          <MetricCard
            label="Open work"
            href="/command/tasks"
            icon={<IconTasks size={15} />}
            value={String(cc.work.open)}
            sub="tasks in flight"
            trend={mkTrend(trends.openWork)}
          />
          <MetricCard
            label="Overdue"
            href="/command/tasks?view=overdue"
            icon={<IconClock size={15} />}
            value={String(cc.work.overdue)}
            tone={cc.work.overdue > 0 ? "danger" : "neutral"}
            tint={cc.work.overdue > 0 ? "danger" : undefined}
            sub={cc.work.overdue > 0 ? "needs action" : "all on time"}
            trend={mkTrend(trends.overdue, { invert: true })}
          />
          <MetricCard
            label="Active programs"
            href="/programs?view=active"
            icon={<IconPrograms size={15} />}
            value={`${cc.progress.programsActive}/${cc.progress.programsTotal}`}
            sub="competencies & tiers"
            trend={mkTrend(trends.activePrograms)}
          />
          <MetricCard
            label="Tier progress"
            href="/programs/tiers"
            icon={<IconTiers size={15} />}
            value={cc.progress.tierPercent == null ? "—" : `${cc.progress.tierPercent}%`}
            sub="to next tier"
            trend={cc.progress.tierPercent == null ? undefined : mkTrend(trends.tierProgress, { suffix: "%" })}
          />
          <MetricCard
            label="Marketplace revenue"
            href="/marketplace"
            icon={<IconMarketplace size={15} />}
            size="lg"
            value={money(mpRevenueCents)}
            sub="attributed (AWS)"
            tint="accent"
            trend={mkTrend(mp?.revenue ?? [])}
          />
        </MetricStrip>
      </section>

      {/* Getting started — shown only until the partner is activated */}
      {!activation.complete && <HomeActivation activation={activation} />}

      {/* Needs attention — the same decisions the notification bell shows */}
      <Panel
        title="Needs attention"
        actions={
          <Link
            href="/command?mode=workbench"
            style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
          >
            View all in Command Center →
          </Link>
        }
      >
        {decisions.length === 0 ? (
          <EmptyState title="You're all caught up" hint="No open decisions right now." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {decisions.map((d) => (
              <DecisionRow key={d.id} d={d} ownerName={ownerName} />
            ))}
          </div>
        )}
      </Panel>

      {/* Benchmarks — how you compare to anonymized peer cohorts (impossible in ACE) */}
      <BenchmarksPanel view={benchmarks} />

      {/* Quick actions */}
      {actions.length > 0 && (
        <section>
          <h2 style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px", fontWeight: 600 }}>Quick actions</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {actions.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="card-interactive"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow-sm)",
                  padding: "12px 14px",
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <q.Icon size={17} />
                </span>
                <span style={{ display: "grid" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{q.label}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{q.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity (audit ledger) */}
      {canReceipts && data.receipts.length > 0 && (
        <Panel title="Recent activity">
          <ActivityList
            items={data.receipts.slice(0, 6).map((r) => ({
              action: r.action,
              resourceType: r.resourceType,
              actor: ownerName(r.actorUserId),
              at: r.createdAt,
            }))}
          />
        </Panel>
      )}
    </PageShell>
  );
}

function DecisionRow({ d, ownerName }: { d: Decision; ownerName: (id: string | null) => string }): ReactNode {
  return (
    <Card compact interactive style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <span style={{ marginRight: 8 }}>
          <Badge tone={statusTone(d.severity)}>{d.severity}</Badge>
        </span>
        <Link href={d.link} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14 }}>
          {d.title}
        </Link>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>{d.detail}</p>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
        {ownerName(d.ownerUserId)}
        {d.dueDate ? (
          <>
            <br />
            due {d.dueDate}
          </>
        ) : null}
      </div>
    </Card>
  );
}
