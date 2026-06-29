import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Table } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { RingGauge } from "@/components/ui/RingGauge";
import { Callout } from "@/components/ui/Callout";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MdfNav } from "@/app/mdf/MdfNav";
import { createMdfPlan } from "@/domain/mdf/plan-actions";
import { loadPlans, availableMdf } from "@/domain/mdf/plan-load";
import { APPROVED_ACTIVITIES, INELIGIBLE_ACTIVITIES, type CatalogActivity } from "@/domain/mdf/activity-catalog";

const SECTION = "var(--section-accent)";
const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;
const money = (n: number): string => `$${n.toLocaleString()}`;

const CATEGORY_LABELS: Record<string, string> = {
  event: "Event",
  campaign: "Campaign",
  content: "Content",
  enablement: "Enablement",
  other: "Other",
};

export default async function MdfPlannerPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const [plans, avail] = await Promise.all([loadPlans(identity), availableMdf(identity, today)]);

  return (
    <PageShell>
      <PageHeader
        title="Marketing Event Planner"
        actions={
          <FormDrawer
            triggerLabel="New plan"
            title="New marketing plan"
            action={createMdfPlan}
            submitLabel="Create plan"
            successMessage="Plan created."
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Plan title</span>
              <input name="title" required maxLength={200} placeholder="e.g. H2 2026 demand-gen" style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Notes</span>
              <input name="notes" maxLength={2000} style={controlStyle} />
            </label>
          </FormDrawer>
        }
      />
      <MdfNav />

      {/* Available MDF to plan against (the active budget's remaining headroom). */}
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
        {avail.hasBudget ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 150 }}>
              <RingGauge
                value={avail.allocated > 0 ? Math.min(100, Math.round((avail.committed / avail.allocated) * 100)) : 0}
                color={SECTION}
                caption="committed"
                size={120}
              />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{avail.budget?.periodLabel}</span>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <MetricStrip min={150}>
                <MetricCard label="Available to plan" value={money(avail.available)} tone="accent" />
                <MetricCard label="Budget allocated" value={money(avail.allocated)} />
                <MetricCard label="Already committed" value={money(avail.committed)} tone={avail.committed > 0 ? "warn" : "neutral"} />
              </MetricStrip>
            </div>
          </>
        ) : (
          <Callout tone="info" title="No active MDF budget">
            Set a budget on the <Link href="/mdf" style={{ color: "var(--accent)" }}>MDF Overview</Link> to plan events against your available funds. You can still draft plans below.
          </Callout>
        )}
      </section>

      <Panel title={`Plans (${plans.length})`} accent={SECTION}>
        <Table
          rows={plans}
          rowKey={(p) => p.id}
          empty="No marketing plans yet. Create one to assemble candidate events."
          columns={[
            {
              key: "title",
              header: "Plan",
              render: (p) => (
                <Link href={`/mdf/plan/${p.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{p.title}</Link>
              ),
            },
            { key: "status", header: "Status", render: (p) => <Badge tone={p.status === "archived" ? "neutral" : "info"}>{p.status}</Badge> },
            { key: "events", header: "Events", align: "right", render: (p) => String(p.itemCount) },
            { key: "cost", header: "Planned cost", align: "right", render: (p) => money(p.plannedCost) },
            { key: "updated", header: "Updated", render: (p) => p.updatedAt.toISOString().slice(0, 10) },
          ]}
        />
      </Panel>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Panel title={`AWS-approved activities (${APPROVED_ACTIVITIES.length})`} accent="var(--ok)">
          <CatalogList activities={APPROVED_ACTIVITIES} approved />
        </Panel>
        <Panel title={`Ineligible activities (${INELIGIBLE_ACTIVITIES.length})`} accent="var(--danger)">
          <CatalogList activities={INELIGIBLE_ACTIVITIES} approved={false} />
        </Panel>
      </div>
    </PageShell>
  );
}

function CatalogList({ activities, approved }: { activities: readonly CatalogActivity[]; approved: boolean }): ReactNode {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {activities.map((a) => (
        <div key={a.key} style={{ display: "grid", gap: 3, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: approved ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>{approved ? "✓" : "✕"}</span>
            <strong style={{ fontSize: 13.5 }}>{a.label}</strong>
            <Badge tone="neutral">{CATEGORY_LABELS[a.category] ?? a.category}</Badge>
          </div>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.description}</span>
          {a.proofRequirement ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Proof: {a.proofRequirement}</span> : null}
          {a.reason ? <span style={{ fontSize: 11.5, color: "var(--danger)" }}>{a.reason}</span> : null}
          {a.notes ? <span style={{ fontSize: 11.5, color: "var(--accent-2)" }}>Note: {a.notes}</span> : null}
        </div>
      ))}
    </div>
  );
}
