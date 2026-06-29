import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { tenants, tierPlans, tierRequirements, evidence, tasks, users } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { LifecycleNav } from "@/app/programs/LifecycleNav";
import { TierLadder } from "@/app/programs/tiers/TierLadder";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import {
  createTierPlan,
  updateTierRequirement,
  updateTierPlan,
  createTierRequirementTask,
  stageTierRequirementEvidence,
  advanceTier,
} from "@/domain/tiers/actions";
import { TIER_LABELS, tiersAbove, type TierId } from "@/domain/tiers/catalog";
import { tierLadder } from "@/domain/tiers/ladder";
import {
  gapFor,
  planSummary,
  advancementPlan,
  isAchievable,
  coverage,
  type RequirementValue,
} from "@/domain/tiers/gap";

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

export default async function TiersPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const data = await withTenant(identity, async (tx) => {
    const [tenant] = await tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, identity.tenantId));
    const [plan] = await tx
      .select()
      .from(tierPlans)
      .where(eq(tierPlans.tenantId, identity.tenantId));
    if (!plan) return { tenant, plan: null, reqs: [], members: [] };
    const reqs = await tx
      .select({
        id: tierRequirements.id,
        requirementKey: tierRequirements.requirementKey,
        label: tierRequirements.label,
        category: tierRequirements.category,
        unit: tierRequirements.unit,
        threshold: tierRequirements.threshold,
        currentValue: tierRequirements.currentValue,
        ownerUserId: tierRequirements.ownerUserId,
        targetDate: tierRequirements.targetDate,
        evidenceId: tierRequirements.evidenceId,
        evidenceStatus: evidence.status,
        taskId: tierRequirements.taskId,
        taskStatus: tasks.status,
      })
      .from(tierRequirements)
      .leftJoin(evidence, eq(evidence.id, tierRequirements.evidenceId))
      .leftJoin(tasks, eq(tasks.id, tierRequirements.taskId))
      .where(and(eq(tierRequirements.planId, plan.id), eq(tierRequirements.tenantId, identity.tenantId)))
      .orderBy(asc(tierRequirements.requirementKey));
    const members = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, identity.tenantId));
    return { tenant, plan, reqs, members };
  });

  const currentTier = (data.tenant?.tier ?? "registered") as TierId;

  return (
    <PageShell>
      <PageHeader title="Partner Tier Management" />
      <LifecycleNav />

      {data.plan === null ? (
        <NoPlan currentTier={currentTier} />
      ) : (
        <Plan plan={data.plan} reqs={data.reqs} members={data.members} currentTier={currentTier} today={today} />
      )}
    </PageShell>
  );
}

function NoPlan({ currentTier }: { currentTier: TierId }): ReactNode {
  const targets = tiersAbove(currentTier);
  return (
    <>
      <TierLadder steps={tierLadder(currentTier)} />
      <Panel title="Build an advancement plan">
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
          You are at <strong>{TIER_LABELS[currentTier]}</strong>. Start a plan to track the requirements for your next tier.
        </p>
        {targets.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>You are at the top tier — nothing to advance to.</p>
        ) : (
          <MutationForm action={createTierPlan} submitLabel="Create plan">
            <label style={labelStyle}>
              <span style={spanStyle}>Target tier</span>
              <select name="targetTier" defaultValue={targets[0]} style={controlStyle}>
                {targets.map((t) => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
              </select>
            </label>
          </MutationForm>
        )}
      </Panel>
    </>
  );
}

type ReqRow = {
  id: string;
  requirementKey: string;
  label: string;
  category: string;
  unit: string;
  threshold: number;
  currentValue: number;
  ownerUserId: string | null;
  targetDate: string | null;
  evidenceId: string | null;
  evidenceStatus: string | null;
  taskId: string | null;
  taskStatus: string | null;
};

const toValue = (r: ReqRow): RequirementValue => ({
  key: r.requirementKey,
  label: r.label,
  category: r.category,
  threshold: r.threshold,
  currentValue: r.currentValue,
});

function Plan({
  plan,
  reqs,
  members,
  currentTier,
  today,
}: {
  plan: typeof tierPlans.$inferSelect;
  reqs: ReqRow[];
  members: ReadonlyArray<{ id: string; email: string }>;
  currentTier: TierId;
  today: string;
}): ReactNode {
  const values = reqs.map(toValue);
  const summary = planSummary(values);
  const phases = advancementPlan(values);
  const achievable = isAchievable(values);
  const achieved = plan.status === "achieved";
  const targetTier = plan.targetTier as TierId;
  const cov = coverage(reqs.map((r) => ({ met: gapFor(toValue(r)).met, hasTask: !!r.taskId, hasEvidence: !!r.evidenceId })));
  const ringColor = achievable || achieved ? "var(--ok)" : "var(--accent-2)";
  const daysLeft = plan.targetDate ? Math.round((Date.parse(plan.targetDate) - Date.parse(today)) / 86_400_000) : null;

  const editPlan = (
    <FormDrawer
      triggerLabel="Edit plan"
      triggerVariant="secondary"
      title="Edit plan details"
      action={updateTierPlan}
      submitLabel="Save changes"
      successMessage="Plan updated."
      submitVariant="secondary"
      hidden={{ planId: plan.id }}
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Owner</span>
        <select name="ownerUserId" defaultValue={plan.ownerUserId ?? ""} style={controlStyle}>
          <option value="">Unassigned</option>
          {members.map((m) => (<option key={m.id} value={m.id}>{m.email}</option>))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Target date</span>
        <input name="targetDate" type="date" defaultValue={plan.targetDate ?? ""} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Notes</span>
        <input name="notes" maxLength={2000} defaultValue={plan.notes} style={controlStyle} />
      </label>
    </FormDrawer>
  );

  return (
    <>
      {/* Readiness hero */}
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 150 }}>
          <RingGauge value={summary.percent} color={ringColor} label={`${summary.percent}%`} caption="ready" size={120} />
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{TIER_LABELS[currentTier]}</strong> →{" "}
            <strong style={{ color: "var(--text)" }}>{TIER_LABELS[targetTier]}</strong>
          </p>
          <Badge tone={achieved || achievable ? "ok" : "info"}>
            {achieved ? "Achieved 🎉" : achievable ? "Ready to advance" : "In progress"}
          </Badge>
        </div>

        <div style={{ flex: 1, minWidth: 260, display: "grid", gap: 12 }}>
          <MetricStrip min={132}>
            <MetricCard label="Requirements met" value={`${summary.met}/${summary.total}`} tone={achievable ? "ok" : "neutral"} />
            <MetricCard
              label="Open gaps"
              value={String(cov.open)}
              tone={cov.open > 0 ? "danger" : "ok"}
              {...(cov.open > 0 ? { tint: "danger" as const } : {})}
            />
            <MetricCard
              label="Gaps actioned"
              value={cov.open > 0 ? `${cov.actioned}/${cov.open}` : "—"}
              sub={cov.open > 0 ? "have task / evidence" : "no open gaps"}
            />
            <MetricCard
              label="Target date"
              value={plan.targetDate ?? "—"}
              sub={daysLeft === null ? "no date set" : daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d left`}
              tone={daysLeft !== null && daysLeft < 0 && !achieved ? "danger" : "neutral"}
            />
          </MetricStrip>
          {!achieved && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {editPlan}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV export is a route handler (download), not a page */}
              <a
                href="/programs/tiers/export"
                style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
              >
                Export packet (CSV) ↓
              </a>
            </div>
          )}
        </div>
      </section>

      <TierLadder steps={tierLadder(currentTier, targetTier)} readinessPercent={summary.percent} />

      <Panel title="Requirement progress">
        <BarChart
          max={100}
          data={reqs.map((r) => {
            const g = gapFor(toValue(r));
            return {
              label: r.label,
              value: g.progress,
              color: g.met ? "var(--ok)" : "var(--warn)",
              display: `${r.currentValue}/${r.threshold} ${r.unit}`,
            };
          })}
        />
      </Panel>

      {!achieved &&
        (achievable ? (
          <Panel title="Ready to advance">
            <div
              style={{
                background: "var(--surface-tint-ok)",
                border: "1px solid color-mix(in srgb, var(--ok) 22%, var(--border))",
                borderRadius: "var(--radius)",
                padding: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
                Every requirement meets its threshold. Approving advances the workspace to{" "}
                <strong>{TIER_LABELS[targetTier]}</strong> and records a receipt.
              </p>
              <MutationForm action={advanceTier} submitLabel={`Approve advancement to ${TIER_LABELS[targetTier]}`} hidden={{ planId: plan.id }} />
            </div>
          </Panel>
        ) : (
          <Panel title="30 / 60 / 90-day plan">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {([["Next 30 days", phases.phase30, "var(--accent)"], ["31–60 days", phases.phase60, "var(--accent-2)"], ["61–90 days", phases.phase90, "var(--muted)"]] as const).map(
                ([label, items, dot]) => (
                  <div
                    key={label}
                    style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, display: "grid", gap: 8, alignContent: "start" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
                      <strong style={{ fontSize: 13 }}>{label}</strong>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{items.length}</span>
                    </div>
                    {items.length === 0 ? (
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Nothing queued</span>
                    ) : (
                      items.map((it) => {
                        const g = gapFor(it);
                        return (
                          <div key={it.key} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 12.5 }}>
                              <span style={{ fontWeight: 600 }}>{it.label}</span>
                              <span style={{ color: "var(--warn)", whiteSpace: "nowrap" }}>need {g.delta}</span>
                            </div>
                            <div style={{ height: 4, background: "var(--border)", borderRadius: 999 }}>
                              <div style={{ width: `${g.progress}%`, height: "100%", background: "var(--warn)", borderRadius: 999 }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ),
              )}
            </div>
          </Panel>
        ))}

      <Panel title={`Requirements (${reqs.length})`}>
        <div style={{ display: "grid", gap: 14 }}>
          {reqs.map((r) => {
            const gap = gapFor(toValue(r));
            return (
              <Card
                key={r.id}
                {...(gap.met
                  ? { style: { background: "var(--surface-tint-ok)", borderColor: "color-mix(in srgb, var(--ok) 20%, var(--border))" } }
                  : {})}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{r.label}</strong>
                  <span style={{ color: gap.met ? "var(--ok)" : "var(--muted)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                    {r.currentValue}/{r.threshold} {r.unit} · {gap.met ? "met" : `${gap.delta} to go`}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 999, margin: "8px 0 10px" }}>
                  <div style={{ width: `${gap.progress}%`, height: "100%", background: gap.met ? "var(--ok)" : "var(--warn)", borderRadius: 999 }} />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: achieved ? 0 : 12 }}>
                  {r.taskId && r.taskStatus ? (
                    <Link href="/command/tasks" style={{ textDecoration: "none" }}>
                      <Badge tone="ok">Task ✓ {r.taskStatus}</Badge>
                    </Link>
                  ) : (
                    <Badge tone="neutral">No task</Badge>
                  )}
                  {r.evidenceId && r.evidenceStatus ? (
                    <Link href="/programs/evidence" style={{ textDecoration: "none" }}>
                      <Badge tone={statusTone(r.evidenceStatus)}>Evidence ✓ {r.evidenceStatus}</Badge>
                    </Link>
                  ) : (
                    <Badge tone="neutral">No evidence</Badge>
                  )}
                </div>

                {!achieved && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <FormDrawer
                      triggerLabel="Edit"
                      triggerVariant="secondary"
                      title={`Edit requirement — ${r.label}`}
                      action={updateTierRequirement}
                      submitLabel="Save changes"
                      successMessage="Requirement updated."
                      submitVariant="secondary"
                      hidden={{ requirementId: r.id }}
                    >
                      <label style={labelStyle}>
                        <span style={spanStyle}>Current value</span>
                        <input name="currentValue" type="number" min={0} defaultValue={r.currentValue} style={controlStyle} />
                      </label>
                      <label style={labelStyle}>
                        <span style={spanStyle}>Owner</span>
                        <select name="ownerUserId" defaultValue={r.ownerUserId ?? ""} style={controlStyle}>
                          <option value="">Unassigned</option>
                          {members.map((m) => (<option key={m.id} value={m.id}>{m.email}</option>))}
                        </select>
                      </label>
                      <label style={labelStyle}>
                        <span style={spanStyle}>Target date</span>
                        <input name="targetDate" type="date" defaultValue={r.targetDate ?? ""} style={controlStyle} />
                      </label>
                    </FormDrawer>
                    {!r.taskId && <MutationForm action={createTierRequirementTask} submitLabel="Create task" variant="secondary" hidden={{ requirementId: r.id }} />}
                    {!r.evidenceId && <MutationForm action={stageTierRequirementEvidence} submitLabel="Stage evidence" variant="secondary" hidden={{ requirementId: r.id }} />}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
