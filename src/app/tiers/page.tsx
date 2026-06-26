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
import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
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
import {
  gapFor,
  planSummary,
  advancementPlan,
  isAchievable,
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

      {data.plan === null ? (
        <NoPlan currentTier={currentTier} />
      ) : (
        <Plan plan={data.plan} reqs={data.reqs} members={data.members} currentTier={currentTier} />
      )}
    </PageShell>
  );
}

function NoPlan({ currentTier }: { currentTier: TierId }): ReactNode {
  const targets = tiersAbove(currentTier);
  return (
    <Panel title="Build an advancement plan">
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        Current tier: <strong>{TIER_LABELS[currentTier]}</strong>.
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

function Plan({
  plan,
  reqs,
  members,
  currentTier,
}: {
  plan: typeof tierPlans.$inferSelect;
  reqs: ReqRow[];
  members: ReadonlyArray<{ id: string; email: string }>;
  currentTier: TierId;
}): ReactNode {
  const values: RequirementValue[] = reqs.map((r) => ({
    key: r.requirementKey,
    label: r.label,
    category: r.category,
    threshold: r.threshold,
    currentValue: r.currentValue,
  }));
  const summary = planSummary(values);
  const phases = advancementPlan(values);
  const achievable = isAchievable(values);
  const achieved = plan.status === "achieved";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
            <strong>{TIER_LABELS[currentTier]}</strong> → <strong>{TIER_LABELS[plan.targetTier as TierId]}</strong> ·{" "}
            {summary.met}/{summary.total} requirements met ({summary.percent}%) ·{" "}
            {achieved ? "Achieved 🎉" : "Active"}
          </p>
          <div style={{ height: 8, background: "var(--border)", borderRadius: 999, marginTop: 8 }}>
            <div style={{ width: `${summary.percent}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
          </div>
        </div>
        {!achieved && (
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
        )}
      </div>

      {!achieved && (
        <Panel title="Advancement" actions={<a href="/tiers/export" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>Export packet (CSV)</a>}>
          {achievable ? (
            <>
              <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
                Every requirement meets its threshold. Approving advances the workspace to{" "}
                {TIER_LABELS[plan.targetTier as TierId]} and records a receipt.
              </p>
              <MutationForm action={advanceTier} submitLabel={`Approve advancement to ${TIER_LABELS[plan.targetTier as TierId]}`} hidden={{ planId: plan.id }} />
            </>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>30 / 60 / 90-day plan for the open gaps:</p>
              {([["Next 30 days", phases.phase30], ["31–60 days", phases.phase60], ["61–90 days", phases.phase90]] as const).map(([label, items]) => (
                <div key={label}>
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                  {items.length === 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: 13 }}> — none</span>
                  ) : (
                    <ul style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
                      {items.map((i) => (
                        <li key={i.key}>{i.label} (need {gapFor(i).delta} more {i.category === "certifications" ? "certs" : ""})</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      <Panel title={`Requirements (${reqs.length})`}>
        <div style={{ display: "grid", gap: 14 }}>
          {reqs.map((r) => {
            const gap = gapFor({ key: r.requirementKey, label: r.label, category: r.category, threshold: r.threshold, currentValue: r.currentValue });
            return (
              <Card key={r.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{r.label}</strong>
                  <span style={{ color: gap.met ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                    {r.currentValue}/{r.threshold} {r.unit} · {gap.met ? "met" : `${gap.delta} to go`}
                  </span>
                </div>
                <div style={{ height: 5, background: "var(--border)", borderRadius: 999, margin: "8px 0 10px" }}>
                  <div style={{ width: `${gap.progress}%`, height: "100%", background: gap.met ? "var(--accent)" : "var(--warn)", borderRadius: 999 }} />
                </div>
                <p style={{ fontSize: 12, margin: "0 0 10px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Evidence: {r.evidenceId && r.evidenceStatus ? <Link href="/evidence" style={{ color: "var(--accent)" }}>linked <Badge tone={statusTone(r.evidenceStatus)}>{r.evidenceStatus}</Badge></Link> : <span style={spanStyle}>none</span>}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Task: {r.taskId && r.taskStatus ? <Link href="/tasks" style={{ color: "var(--accent)" }}>created <Badge tone={statusTone(r.taskStatus)}>{r.taskStatus}</Badge></Link> : <span style={spanStyle}>none</span>}</span>
                </p>

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
