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
  syncTierMeasured,
} from "@/domain/tiers/actions";
import { TIER_LABELS, tiersAbove, type TierId, type RequirementKind } from "@/domain/tiers/catalog";
import { tierLadder } from "@/domain/tiers/ladder";
import {
  gapFor,
  planSummary,
  advancementPlan,
  isAchievable,
  coverage,
  type RequirementValue,
} from "@/domain/tiers/gap";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Callout } from "@/components/ui/Callout";
import { loadTierPath, type TierPathData } from "@/domain/tiers/path-load";
import { tierPath, tierVelocity, ownerLoad, cheapestCompetencyStack } from "@/domain/tiers/path";
import { loadBenchmarks, pickPosition } from "@/domain/benchmarks/load";
import { BenchmarkBand } from "@/components/ui/BenchmarkBand";
import type { Position } from "@/domain/benchmarks/percentiles";

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

export default async function TiersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const view: "overview" | "path" = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "path" ? "path" : "overview";

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
        kind: tierRequirements.kind,
        secondaryLabel: tierRequirements.secondaryLabel,
        secondaryUnit: tierRequirements.secondaryUnit,
        secondaryThreshold: tierRequirements.secondaryThreshold,
        secondaryCurrentValue: tierRequirements.secondaryCurrentValue,
        note: tierRequirements.note,
        informational: tierRequirements.informational,
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
  const pathData = view === "path" && data.plan ? await loadTierPath(identity, today) : null;
  // Benchmarks (Bet B): where tier readiness sits vs the anonymized peer cohort.
  const benchmarks = await loadBenchmarks(identity).catch(() => ({ participating: false as const }));
  const tierBand = pickPosition(benchmarks, "tier_percent")?.position ?? null;

  return (
    <PageShell>
      <PageHeader title="Partner Tier Management" />
      <LifecycleNav />

      {data.plan === null ? (
        <NoPlan currentTier={currentTier} />
      ) : (
        <Plan plan={data.plan} reqs={data.reqs} members={data.members} currentTier={currentTier} today={today} view={view} pathData={pathData} tierBand={tierBand} />
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
  kind: string;
  secondaryLabel: string | null;
  secondaryUnit: string | null;
  secondaryThreshold: number | null;
  secondaryCurrentValue: number;
  note: string;
  informational: boolean;
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
  kind: r.kind as RequirementKind,
  secondaryThreshold: r.secondaryThreshold,
  secondaryCurrentValue: r.secondaryCurrentValue,
  informational: r.informational,
});

function Plan({
  plan,
  reqs,
  members,
  currentTier,
  today,
  view,
  pathData,
  tierBand,
}: {
  plan: typeof tierPlans.$inferSelect;
  reqs: ReqRow[];
  members: ReadonlyArray<{ id: string; email: string }>;
  currentTier: TierId;
  today: string;
  view: "overview" | "path";
  pathData: TierPathData | null;
  tierBand: Position | null;
}): ReactNode {
  const values = reqs.map(toValue);
  const summary = planSummary(values);
  const phases = advancementPlan(values);
  const achievable = isAchievable(values);
  const achieved = plan.status === "achieved";
  const targetTier = plan.targetTier as TierId;
  const cov = coverage(
    reqs.filter((r) => !r.informational).map((r) => ({ met: gapFor(toValue(r)).met, hasTask: !!r.taskId, hasEvidence: !!r.evidenceId })),
  );
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
          {tierBand ? <BenchmarkBand position={tierBand} /> : null}
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
              <MutationForm action={syncTierMeasured} submitLabel="Sync measured values" variant="secondary" />
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

      {!achieved && (
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "path", label: "Path simulator" },
          ]}
          value={view}
          hrefFor={(v) => (v === "path" ? "/programs/tiers?view=path" : "/programs/tiers")}
        />
      )}

      {view === "path" && !achieved ? (
        <PathSimulator values={values} reqs={reqs} plan={plan} members={members} today={today} targetTier={targetTier} pathData={pathData} />
      ) : (
        <>
      <Panel title="Requirement progress">
        <BarChart
          max={100}
          data={reqs
            .filter((r) => !r.informational)
            .map((r) => {
              const g = gapFor(toValue(r));
              return {
                label: r.label,
                value: g.progress,
                color: g.met ? "var(--ok)" : "var(--warn)",
                display: r.kind === "boolean" ? (g.met ? "yes" : "no") : `${r.currentValue}/${r.threshold} ${r.unit}`,
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
          {reqs.map((r) => (
            <RequirementCard key={r.id} r={r} members={members} achieved={achieved} />
          ))}
        </div>
      </Panel>
        </>
      )}
    </>
  );
}

/** Forward "Path to ‹tier›" simulator: dated scenarios + ETA, velocity reality-check,
 *  a fewest-effort competency stack, and owner-capacity — all advisory (never writes). */
function PathSimulator({
  values,
  reqs,
  plan,
  members,
  today,
  targetTier,
  pathData,
}: {
  values: RequirementValue[];
  reqs: ReqRow[];
  plan: typeof tierPlans.$inferSelect;
  members: ReadonlyArray<{ id: string; email: string }>;
  today: string;
  targetTier: TierId;
  pathData: TierPathData | null;
}): ReactNode {
  const targetLabel = TIER_LABELS[targetTier];
  const path = tierPath(values, today, targetLabel);
  const summary = planSummary(values);

  if (path.achievable) {
    return (
      <Panel title={`Path to ${targetLabel}`} accent="var(--ok)">
        <p style={{ margin: 0, fontSize: 14 }}>
          Every requirement meets its threshold — you&apos;re ready to advance. Switch to <strong>Overview</strong> to approve.
        </p>
      </Panel>
    );
  }

  const steady = path.scenarios.find((s) => s.id === "steady") ?? path.scenarios[0];
  const velocity = pathData
    ? tierVelocity(pathData.history, summary.percent, today, plan.targetDate)
    : ({ velocityPerDay: null, projectedDate: null, band: "none" } as const);

  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const unmet = reqs.filter((r) => !r.informational && !gapFor(toValue(r)).met);
  const cap = ownerLoad(unmet.map((r) => ({ ownerUserId: r.ownerUserId, label: r.label })));

  // The competency-count requirement (Premier "3 Competencies") → recommend which to earn.
  const compValue = values.find((v) => !v.informational && v.category === "competencies" && !gapFor(v).met);
  const stack = compValue && pathData ? cheapestCompetencyStack(pathData.competencyOptions, gapFor(compValue).delta, pathData.adoptedKeys) : [];
  const generalComps = !compValue && pathData ? cheapestCompetencyStack(pathData.competencyOptions, 3, pathData.adoptedKeys) : [];

  const inDays = (iso: string): string => {
    const d = Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
    return d <= 0 ? "now" : `in ${d}d`;
  };

  return (
    <>
      <Panel title={`Path to ${targetLabel}`} accent="var(--accent-2)">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{steady?.etaDate ?? "—"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              projected at a steady pace{steady?.etaDate ? ` (${inDays(steady.etaDate)})` : ""}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{path.remaining}</strong> requirement{path.remaining === 1 ? "" : "s"} remaining ({summary.percent}% ready).{" "}
            {velocity.band === "none"
              ? "Not enough tier-progress history yet to gauge your actual pace."
              : velocity.band === "slow"
                ? `At your current pace you'd finish ~${velocity.projectedDate} — behind your target date.`
                : `At your current pace you're trending to ~${velocity.projectedDate}.`}
          </div>
        </div>
      </Panel>

      <Panel title="Scenarios">
        <MetricStrip min={150}>
          {path.scenarios.map((s) => (
            <MetricCard key={s.id} label={s.label} value={s.etaDate ?? "—"} sub={s.etaDate ? inDays(s.etaDate) : ""} tone={s.id === "steady" ? "accent" : "neutral"} />
          ))}
        </MetricStrip>
      </Panel>

      <Panel title="Dated plan — steady pace">
        <div style={{ display: "grid", gap: 8 }}>
          {(steady?.steps ?? []).map((step) => (
            <div key={step.key} style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>{step.label}</strong>
                <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{step.detail} · by {step.targetDate}</span>
              </div>
              <div style={{ height: 4, background: "var(--border)", borderRadius: 999 }}>
                <div style={{ width: `${step.progress}%`, height: "100%", background: "var(--accent-2)", borderRadius: 999 }} />
              </div>
              {compValue && step.key === compValue.key && stack.length > 0 ? (
                <div style={{ display: "grid", gap: 3, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Fewest-effort competencies to earn:</span>
                  {stack.map((c) => (
                    <div key={c.programKey} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                      <span>{c.name}</span>
                      <span style={{ color: "var(--muted)" }}>{c.gapCount === 0 ? "ready" : `${c.gapCount} gap${c.gapCount === 1 ? "" : "s"}`}</span>
                    </div>
                  ))}
                  <Link href="/programs?view=recommended" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>Pursue competencies →</Link>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {generalComps.length > 0 ? (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "var(--muted)" }}>
            Competencies that would strengthen your path:{" "}
            {generalComps.map((c, i) => (
              <span key={c.programKey}>{i > 0 ? ", " : ""}{c.name} ({c.gapCount === 0 ? "ready" : `${c.gapCount} gaps`})</span>
            ))}.{" "}
            <Link href="/programs?view=recommended" style={{ color: "var(--accent)", textDecoration: "none" }}>See recommendations →</Link>
          </p>
        ) : null}
      </Panel>

      <Panel title="Team capacity">
        {cap.bottleneck ? (
          <Callout tone="warn" title="Capacity bottleneck">
            {cap.unowned > 0
              ? `${cap.unowned} open requirement${cap.unowned === 1 ? " has" : "s have"} no owner — assign owners so the plan can move.`
              : "One owner is carrying half or more of the remaining work — consider redistributing."}
          </Callout>
        ) : null}
        <div style={{ display: "grid", gap: 6, marginTop: cap.bottleneck ? 12 : 0, fontSize: 13 }}>
          {cap.loads.map((l) => (
            <div key={l.ownerUserId ?? "none"} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: l.ownerUserId === null ? "var(--warn)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.ownerUserId === null ? "Unassigned" : emailById.get(l.ownerUserId) ?? l.ownerUserId}
              </span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{l.count}</strong>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

const DERIVED_KEYS = new Set(["launched_opportunities", "competencies", "sustained_attainment"]);

/** One requirement card, rendered per kind: count, count+secondary, boolean, or informational context. */
function RequirementCard({
  r,
  members,
  achieved,
}: {
  r: ReqRow;
  members: ReadonlyArray<{ id: string; email: string }>;
  achieved: boolean;
}): ReactNode {
  // Informational (the annual fee): context only — no gate, bar, or handoffs.
  if (r.informational) {
    return (
      <Card style={{ background: "var(--panel-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: 14 }}>{r.label}</strong>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Context — not required to advance.</span>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
            {`$${r.threshold.toLocaleString()}${r.unit.replace("$", "")}`}
          </span>
        </div>
      </Card>
    );
  }

  const gap = gapFor(toValue(r));
  const isBoolean = r.kind === "boolean";
  const derived = DERIVED_KEYS.has(r.requirementKey);
  const secMet = r.secondaryThreshold === null || r.secondaryCurrentValue >= r.secondaryThreshold;
  const headline = isBoolean
    ? gap.met
      ? "Yes · met"
      : "No · not met"
    : `${r.currentValue}/${r.threshold} ${r.unit} · ${gap.met ? "met" : `${gap.delta} to go`}`;

  return (
    <Card
      {...(gap.met
        ? { style: { background: "var(--surface-tint-ok)", borderColor: "color-mix(in srgb, var(--ok) 20%, var(--border))" } }
        : {})}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{r.label}</strong>
          {derived && <Badge tone="info">Auto-measured</Badge>}
        </div>
        <span style={{ color: gap.met ? "var(--ok)" : "var(--muted)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
          {headline}
        </span>
      </div>

      {r.note ? <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>{r.note}</p> : null}

      {r.secondaryThreshold !== null ? (
        <p style={{ fontSize: 12, color: secMet ? "var(--ok)" : "var(--warn)", margin: "6px 0 0", fontWeight: 600 }}>
          {r.secondaryLabel}: {r.secondaryCurrentValue.toLocaleString()} / {r.secondaryThreshold.toLocaleString()} {r.secondaryUnit}
        </p>
      ) : null}

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
            {derived && (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                Auto-measured from your data — &quot;Sync measured values&quot; refreshes it.
              </p>
            )}
            {isBoolean ? (
              <label style={labelStyle}>
                <span style={spanStyle}>Status</span>
                <select name="currentValue" defaultValue={r.currentValue >= 1 ? "1" : "0"} style={controlStyle}>
                  <option value="0">Not done</option>
                  <option value="1">Done</option>
                </select>
              </label>
            ) : (
              <>
                <label style={labelStyle}>
                  <span style={spanStyle}>Current value</span>
                  <input name="currentValue" type="number" min={0} defaultValue={r.currentValue} style={controlStyle} />
                </label>
                {r.secondaryThreshold !== null ? (
                  <label style={labelStyle}>
                    <span style={spanStyle}>
                      {r.secondaryLabel} ({r.secondaryUnit})
                    </span>
                    <input name="secondaryCurrentValue" type="number" min={0} defaultValue={r.secondaryCurrentValue} style={controlStyle} />
                  </label>
                ) : null}
              </>
            )}
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
}
