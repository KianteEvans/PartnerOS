import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import {
  filterDecisions,
  DECISION_VIEWS,
  DECISION_VIEW_LABELS,
  type DecisionView,
  type Decision,
  type Severity,
} from "@/domain/command/brief";

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--danger)",
  high: "var(--warn)",
  medium: "var(--muted)",
};
const BAND_COLOR: Record<string, string> = {
  strong: "var(--ok)",
  fair: "var(--warn)",
  at_risk: "var(--danger)",
};

function isView(v: string | undefined): v is DecisionView {
  return v !== undefined && (DECISION_VIEWS as readonly string[]).includes(v);
}

const pctOf = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 100);

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; view?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canReceipts = can(identity.role, "audit:read");

  const { mode: modeParam, view: viewParam } = await searchParams;
  const mode = modeParam === "workbench" ? "workbench" : "executive";
  const view: DecisionView = isView(viewParam) ? viewParam : "all";
  const today = new Date().toISOString().slice(0, 10);

  const data = await loadCommandData(identity);
  const cc = buildCommandCenter(data.inputs, today);
  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  const ownerName = (id: string | null) => (id ? emailById.get(id) ?? "—" : "Unassigned");

  // Executive mode emphasizes the few critical/high items; workbench shows all.
  const decisions =
    mode === "executive"
      ? cc.decisions.filter((d) => d.severity !== "medium").slice(0, 6)
      : filterDecisions(cc.decisions, view);

  return (
    <PageShell>
      <PageHeader
        title="Command Center"
        actions={
          <>
            <SegmentedControl
              options={[
                { value: "executive", label: "Executive" },
                { value: "workbench", label: "Workbench" },
              ]}
              value={mode}
              hrefFor={(m) => `/command?mode=${m}`}
            />
            <a href="/command/export" style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, textDecoration: "none", border: "1px solid var(--border)", color: "var(--accent)" }}>Export packet</a>
          </>
        }
      />

      {/* Today's Command Brief */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Panel title="Partnership health">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <RingGauge
              value={cc.health.score}
              color={BAND_COLOR[cc.health.band]}
              caption={cc.health.band.replace("_", " ")}
              size={112}
            />
            {mode === "workbench" && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <BarChart
                  data={cc.health.drivers.map((d) => ({ label: d.label, value: d.score }))}
                  max={100}
                  color={BAND_COLOR[cc.health.band]}
                  formatValue={(n) => String(n)}
                />
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Highest-priority risk">
          {cc.topRisk ? (
            <div style={{ fontSize: 14 }}>
              <div style={{ color: SEVERITY_COLOR[cc.topRisk.severity], fontWeight: 600, textTransform: "capitalize" }}>{cc.topRisk.severity}</div>
              <Link href={cc.topRisk.link} style={{ color: "var(--accent)", textDecoration: "none" }}>{cc.topRisk.title}</Link>
              <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>{cc.topRisk.detail}</p>
            </div>
          ) : (
            <p style={{ color: "var(--muted)", margin: 0 }}>No open risks. 🎉</p>
          )}
        </Panel>

        <Panel title="Required decision">
          {cc.requiredDecision ? (
            <div style={{ fontSize: 14 }}>
              <Link href={cc.requiredDecision.link} style={{ color: "var(--accent)", textDecoration: "none" }}>{cc.requiredDecision.title}</Link>
              <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>
                Owner: {ownerName(cc.requiredDecision.ownerUserId)}{cc.requiredDecision.dueDate ? ` · due ${cc.requiredDecision.dueDate}` : ""}
              </p>
            </div>
          ) : (
            <p style={{ color: "var(--muted)", margin: 0 }}>Nothing requires a decision.</p>
          )}
        </Panel>

        <Panel title="Work">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
            <Stat label="Open" value={cc.work.open} />
            <Stat label="Overdue" value={cc.work.overdue} danger={cc.work.overdue > 0} />
            <Stat label="Blocked" value={cc.work.blocked} danger={cc.work.blocked > 0} />
            <Stat label="Critical" value={cc.work.critical} danger={cc.work.critical > 0} />
          </div>
        </Panel>
      </div>

      {/* Decision queue */}
      <Panel title="Decision queue">
        {mode === "workbench" && (
          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {DECISION_VIEWS.map((v) => {
              const n = filterDecisions(cc.decisions, v).length;
              const active = v === view;
              return (
                <Link key={v} href={`/command?mode=workbench&view=${v}`} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, textDecoration: "none", border: "1px solid var(--border)", background: active ? "var(--accent)" : "transparent", color: active ? "var(--accent-ink)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>
                  {DECISION_VIEW_LABELS[v]} ({n})
                </Link>
              );
            })}
          </nav>
        )}
        {decisions.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No decisions in this view.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {decisions.map((d) => (
              <DecisionRow key={d.id} d={d} ownerName={ownerName} />
            ))}
          </div>
        )}
      </Panel>

      {/* Progress */}
      <Panel title="Progress">
        <BarChart
          max={100}
          color="var(--accent-2)"
          data={[
            {
              label: "Programs active",
              value: pctOf(cc.progress.programsActive, cc.progress.programsTotal),
              display: `${cc.progress.programsActive}/${cc.progress.programsTotal}`,
            },
            {
              label: "Tasks done",
              value: pctOf(cc.progress.tasksDone, cc.progress.tasksTotal),
              display: `${cc.progress.tasksDone}/${cc.progress.tasksTotal}`,
            },
            {
              label: "Tier progress",
              value: cc.progress.tierPercent ?? 0,
              display: cc.progress.tierPercent == null ? "—" : `${cc.progress.tierPercent}%`,
            },
          ]}
        />
      </Panel>

      {/* Recent workflow receipts (audit ledger) */}
      {canReceipts && (
        <Panel title="Recent workflow receipts">
          {data.receipts.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No activity yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {data.receipts.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", borderBottom: "1px solid var(--border)", paddingBottom: 3 }}>
                  <span><strong style={{ color: "var(--text)" }}>{r.action}</strong> · {r.resourceType}</span>
                  <span>{ownerName(r.actorUserId)} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </PageShell>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }): ReactNode {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: danger ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function DecisionRow({ d, ownerName }: { d: Decision; ownerName: (id: string | null) => string }): ReactNode {
  return (
    <Card compact interactive style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <span style={{ marginRight: 8 }}><Badge tone={statusTone(d.severity)}>{d.severity}</Badge></span>
        <Link href={d.link} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14 }}>{d.title}</Link>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>{d.detail}</p>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
        {ownerName(d.ownerUserId)}
        {d.dueDate ? <><br />due {d.dueDate}</> : null}
      </div>
    </Card>
  );
}
