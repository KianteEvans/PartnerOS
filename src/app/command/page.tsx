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
import { MetricCard } from "@/components/ui/MetricCard";
import { ActivityList } from "@/components/ui/ActivityList";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CommandNav } from "@/app/command/CommandNav";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { pipelineSummary } from "@/domain/ace/opportunities";
import { portfolioSummary } from "@/domain/mdf/analytics";
import {
  filterDecisions,
  DECISION_VIEWS,
  DECISION_VIEW_LABELS,
  SITUATION_LABELS,
  type DecisionView,
  type Decision,
  type Severity,
  type Situation,
} from "@/domain/command/brief";
import { daysBetween } from "@/domain/dates";

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
/** Health drivers drill through to the section that drives the score. */
const DRIVER_LINK: Record<string, string> = {
  Evidence: "/programs/evidence",
  Programs: "/programs",
  Tier: "/programs/tiers",
  Tasks: "/command/tasks",
  ACE: "/ace",
  MDF: "/mdf",
};
const COHORT_SITUATIONS: readonly Situation[] = [
  "overdue_work",
  "blocked_work",
  "mdf_deadline",
  "aws_review",
  "roadmap_risk",
  "renewal_due",
  "evidence",
];
const driverColor = (score: number): string =>
  score >= 70 ? "var(--ok)" : score >= 45 ? "var(--warn)" : "var(--danger)";

function isView(v: string | undefined): v is DecisionView {
  return v !== undefined && (DECISION_VIEWS as readonly string[]).includes(v);
}

const pctOf = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 100);

const money = (n: number): string => `$${n.toLocaleString()}`;

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

  // Cross-section snapshot for the brief KPI cards — reuses the opportunities + MDF
  // rows the loader already pulled (no extra queries) via the existing pure helpers.
  const pipe = pipelineSummary(data.inputs.opportunities, today);
  const mdf = portfolioSummary(data.inputs.mdf, today);

  // Executive mode emphasizes the few critical/high items; workbench shows all.
  const decisions =
    mode === "executive"
      ? cc.decisions.filter((d) => d.severity !== "medium").slice(0, 6)
      : filterDecisions(cc.decisions, view);

  // Decision workload by owner — who's carrying the most open decisions.
  const ownerLoad = new Map<string, number>();
  for (const d of cc.decisions) {
    const k = d.ownerUserId ?? "__unassigned__";
    ownerLoad.set(k, (ownerLoad.get(k) ?? 0) + 1);
  }
  const ownerLoadRows = [...ownerLoad.entries()]
    .map(([k, n]) => ({ name: k === "__unassigned__" ? "Unassigned" : ownerName(k), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

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
      <CommandNav />

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
              <div style={{ flex: 1, minWidth: 180, display: "grid", gap: 6 }}>
                {cc.health.drivers.map((d) => (
                  <div key={d.label} style={{ display: "grid", gridTemplateColumns: "minmax(64px, 84px) 1fr auto", gap: 8, alignItems: "center", fontSize: 12 }}>
                    {DRIVER_LINK[d.label] ? (
                      <Link href={DRIVER_LINK[d.label]!} style={{ color: "var(--accent)", textDecoration: "none" }}>{d.label}</Link>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>{d.label}</span>
                    )}
                    <div style={{ height: 6, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, d.score))}%`, height: "100%", background: driverColor(d.score), borderRadius: 999 }} />
                    </div>
                    <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{d.score}</span>
                  </div>
                ))}
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

        <Panel
          title="Work"
          actions={
            <Link href="/command/tasks" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
              Open tasks →
            </Link>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
            <Stat label="Open" value={cc.work.open} />
            <Stat label="Overdue" value={cc.work.overdue} danger={cc.work.overdue > 0} />
            <Stat label="Blocked" value={cc.work.blocked} danger={cc.work.blocked > 0} />
            <Stat label="Critical" value={cc.work.critical} danger={cc.work.critical > 0} />
          </div>
        </Panel>

        <Panel title="Decision load by owner">
          {ownerLoadRows.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>No open decisions.</p>
          ) : (
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              {ownerLoadRows.map((r) => (
                <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>{r.n}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Cross-section snapshot — fills the brief row beside "Decision load by owner". */}
        <MetricCard
          label="Open pipeline"
          value={money(pipe.openValue)}
          sub={`${pipe.open} open ${pipe.open === 1 ? "deal" : "deals"}`}
          tone="accent"
          style={{ alignSelf: "start" }}
        />
        <MetricCard
          label="MDF pending"
          value={money(mdf.remaining)}
          sub="approved, unclaimed"
          tone={mdf.deadlineRisks > 0 ? "warn" : "accent"}
          tint={mdf.deadlineRisks > 0 ? "warn" : undefined}
          style={{ alignSelf: "start" }}
        />
        <MetricCard
          label="Active programs"
          value={`${cc.progress.programsActive}/${cc.progress.programsTotal}`}
          sub="competencies & tiers"
          tone="ok"
          style={{ alignSelf: "start" }}
        />
      </div>

      {/* Decision queue */}
      <Panel title="Decision queue">
        {mode === "executive" && (
          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {COHORT_SITUATIONS.map((s) => {
              const n = cc.decisions.filter((d) => d.situation === s).length;
              if (n === 0) return null;
              return (
                <Link key={s} href={`/command?mode=workbench&view=${s}`} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, textDecoration: "none", border: "1px solid var(--border)", color: "var(--muted)" }}>
                  {SITUATION_LABELS[s]} ({n})
                </Link>
              );
            })}
          </nav>
        )}
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
              <DecisionRow key={d.id} d={d} ownerName={ownerName} today={today} />
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
          <ActivityList
            items={data.receipts.map((r) => ({
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

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }): ReactNode {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: danger ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function DecisionRow({
  d,
  ownerName,
  today,
}: {
  d: Decision;
  ownerName: (id: string | null) => string;
  today: string;
}): ReactNode {
  const days = d.dueDate ? daysBetween(today, d.dueDate) : null;
  const urgency =
    days === null
      ? null
      : days < 0
        ? { text: `overdue ${Math.abs(days)}d`, color: "var(--danger)" }
        : days <= 7
          ? { text: `due in ${days}d`, color: "var(--warn)" }
          : { text: `due ${d.dueDate}`, color: "var(--muted)" };
  return (
    <Card compact interactive style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <span style={{ marginRight: 8 }}><Badge tone={statusTone(d.severity)}>{d.severity}</Badge></span>
        <Link href={d.link} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14 }}>{d.title}</Link>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>{d.detail}</p>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
        {ownerName(d.ownerUserId)}
        {urgency ? <><br /><span style={{ color: urgency.color, fontWeight: 600 }}>{urgency.text}</span></> : null}
      </div>
    </Card>
  );
}
