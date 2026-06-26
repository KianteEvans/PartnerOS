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
import { MetricCard, type MetricTrend } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import {
  IconOnboarding,
  IconAssessments,
  IconRoadmaps,
  IconMdf,
  IconTasks,
  type IconProps,
} from "@/components/ui/icons";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { loadHubTrends, captureMetricSnapshot } from "@/domain/command/trends-load";
import { trendDelta } from "@/domain/trend";
import type { Decision } from "@/domain/command/brief";

function mkTrend(
  series: number[],
  opts?: { invert?: boolean; suffix?: string },
): MetricTrend | undefined {
  if (series.length < 2) return undefined;
  return { values: series, delta: trendDelta(series), invert: opts?.invert, deltaSuffix: opts?.suffix };
}

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
    return (
      <PageShell width={560}>
        <Panel title="Sign in">
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            PartnerOS — AWS partner readiness, MDF, compliance, and ROI in one workspace.
          </p>
          <div style={{ marginTop: 14 }}>
            <ButtonLink href="/api/auth/login" external>
              Sign in with OIDC
            </ButtonLink>
          </div>
        </Panel>
      </PageShell>
    );
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

  const { tenant, onboardingComplete } = await withTenant(identity, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, identity.tenantId));
    const [ob] = await tx
      .select({ status: onboarding.status })
      .from(onboarding)
      .where(eq(onboarding.tenantId, identity.tenantId));
    return { tenant, onboardingComplete: ob?.status === "completed" };
  });

  // First-run: a focused onboarding screen instead of the full hub.
  if (!onboardingComplete) {
    return (
      <PageShell width={720}>
        <PageHeader title={`Welcome${tenant?.name ? ` to ${tenant.name}` : ""}`} />
        <Panel>
          <EmptyState
            icon={<IconOnboarding size={30} />}
            title="Finish setting up your workspace"
            hint="Complete onboarding to unlock PartnerOS — we'll seed a starter readiness assessment and your first tasks."
            action={<ButtonLink href="/onboarding">Continue onboarding</ButtonLink>}
          />
        </Panel>
      </PageShell>
    );
  }

  const data = await loadCommandData(identity);
  const cc = buildCommandCenter(data.inputs, today);
  // Record today's metrics (idempotent, best-effort) so the daily series grows, then
  // read the dense history back for the sparklines.
  await captureMetricSnapshot(
    identity,
    {
      openWork: cc.work.open,
      overdue: cc.work.overdue,
      activePrograms: cc.progress.programsActive,
      programsTotal: cc.progress.programsTotal,
      tierPercent: cc.progress.tierPercent ?? null,
      healthScore: cc.health.score,
    },
    today,
  ).catch(() => undefined);
  const trends = await loadHubTrends(identity);
  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  const ownerName = (id: string | null): string => (id ? emailById.get(id) ?? "—" : "Unassigned");
  const decisions = cc.decisions.slice(0, 5);

  const quickActions: ReadonlyArray<{
    perm: Permission;
    href: string;
    label: string;
    hint: string;
    Icon: (p: IconProps) => ReactNode;
  }> = [
    { perm: "assessment:create", href: "/assessments/new", label: "New assessment", hint: "Readiness or GTM", Icon: IconAssessments },
    { perm: "roadmap:create", href: "/roadmaps/new", label: "New roadmap", hint: "Compose from catalog", Icon: IconRoadmaps },
    { perm: "mdf:create", href: "/mdf", label: "Request MDF", hint: "Start a funding claim", Icon: IconMdf },
    { perm: "task:create", href: "/tasks", label: "New task", hint: "Assign to your team", Icon: IconTasks },
  ];
  const actions = quickActions.filter((q) => can(identity.role, q.perm));

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
        <div
          style={{
            flex: 1,
            minWidth: 244,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
            gap: 12,
          }}
        >
          <MetricCard
            label="Open work"
            value={String(cc.work.open)}
            sub="tasks in flight"
            trend={mkTrend(trends.openWork)}
          />
          <MetricCard
            label="Overdue"
            value={String(cc.work.overdue)}
            tone={cc.work.overdue > 0 ? "danger" : "neutral"}
            tint={cc.work.overdue > 0 ? "danger" : undefined}
            sub={cc.work.overdue > 0 ? "needs action" : "all on time"}
            trend={mkTrend(trends.overdue, { invert: true })}
          />
          <MetricCard
            label="Active programs"
            value={`${cc.progress.programsActive}/${cc.progress.programsTotal}`}
            sub="competencies & tiers"
            trend={mkTrend(trends.activePrograms)}
          />
          <MetricCard
            label="Tier progress"
            value={cc.progress.tierPercent == null ? "—" : `${cc.progress.tierPercent}%`}
            sub="to next tier"
            trend={cc.progress.tierPercent == null ? undefined : mkTrend(trends.tierProgress, { suffix: "%" })}
          />
        </div>
      </section>

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
          <p style={{ color: "var(--muted)", margin: 0 }}>You&apos;re all caught up — no open decisions.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {decisions.map((d) => (
              <DecisionRow key={d.id} d={d} ownerName={ownerName} />
            ))}
          </div>
        )}
      </Panel>

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
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            {data.receipts.slice(0, 6).map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  color: "var(--muted)",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 4,
                }}
              >
                <span>
                  <strong style={{ color: "var(--text)", fontWeight: 600 }}>{r.action}</strong> · {r.resourceType}
                </span>
                <span style={{ whiteSpace: "nowrap" }}>
                  {ownerName(r.actorUserId)} · {r.createdAt.toISOString().slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
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
