import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { MetricCard } from "@/components/ui/MetricCard";
import { ActivityList } from "@/components/ui/ActivityList";
import { EmptyState } from "@/components/ui/EmptyState";
import { AttentionItem, AttentionList } from "@/components/ui/AttentionItem";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CommandNav } from "@/app/command/CommandNav";
import { AllianceCopilot } from "@/app/command/AllianceCopilot";
import { env } from "@/env";
import { isIncluded } from "@/domain/packaging/catalog";
import { effectivePackageTier } from "@/domain/packaging/preview";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { loadHubTrends } from "@/domain/command/trends-load";
import { mkTrend } from "@/domain/trend";
import { IconPortfolio, IconMdf, IconPrograms, IconWarning, IconClock } from "@/components/ui/icons";
import { loadBenchmarks, pickPosition } from "@/domain/benchmarks/load";
import { BenchmarkBand } from "@/components/ui/BenchmarkBand";
import { TIER_LABELS, type TierId } from "@/domain/tiers/catalog";
import { pipelineSummary } from "@/domain/ace/opportunities";
import { portfolioSummary } from "@/domain/mdf/analytics";
import {
  filterDecisions,
  DECISION_VIEWS,
  DECISION_VIEW_LABELS,
  SITUATION_LABELS,
  type DecisionView,
  type Severity,
  type Situation,
} from "@/domain/command/brief";
import { nextBestActions, EFFORT_LABELS } from "@/domain/command/next-best-action";
import { composeScenario } from "@/domain/command/scenario";
import { whatBreaksNext } from "@/domain/command/horizon";
import { money } from "@/domain/format";

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


export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; view?: string; scenario?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canReceipts = can(identity.role, "audit:read");

  // Package preview: the Command Center core (health, decision queue, Your Move)
  // is open in every tier; Copilot, the scenario/horizon planner, the graph, and
  // the QBR export are Enterprise/Growth features.
  const preview = await effectivePackageTier();
  const showCopilot = isIncluded(preview, "copilot");
  const showScenario = isIncluded(preview, "scenario_planning");
  const showGraph = isIncluded(preview, "command_graph");
  const showQbr = isIncluded(preview, "reports");

  const { mode: modeParam, view: viewParam, scenario: scenarioParam } = await searchParams;
  const mode = modeParam === "workbench" ? "workbench" : "executive";
  const view: DecisionView = isView(viewParam) ? viewParam : "all";
  const scenarioKeys = (scenarioParam ?? "").split(",").filter(Boolean).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const data = await loadCommandData(identity);
  const cc = buildCommandCenter(data.inputs, today, data.dismissedIds);
  const trends = await loadHubTrends(identity);

  // Wave 3: multi-move scenario planner + what-breaks-next (workbench only). The
  // pick list reuses the NBA ranker; the scenario composes the SELECTED candidates'
  // what-if transforms; the outlook re-runs the decision queue at future dates.
  const scenarioMode = mode === "workbench" && showScenario;
  const pickList = scenarioMode ? nextBestActions(data.inputs, today, 10) : [];
  const scenario =
    scenarioMode && scenarioKeys.length > 0 ? composeScenario(data.inputs, scenarioKeys, today) : null;
  const outlook = scenarioMode ? whatBreaksNext(data.inputs, today) : null;
  const selectedSet = new Set(scenario?.appliedKeys ?? scenarioKeys);
  const scenarioHref = (keys: readonly string[]): string => {
    const params = new URLSearchParams({ mode });
    if (view !== "all") params.set("view", view);
    if (keys.length > 0) params.set("scenario", keys.join(","));
    return `/command?${params.toString()}`;
  };
  const toggleHref = (key: string): string =>
    scenarioHref(selectedSet.has(key) ? [...selectedSet].filter((k) => k !== key) : [...selectedSet, key]);
  // Benchmarks (Bet B) — where health sits vs the anonymized peer cohort. Best-effort,
  // gated on reciprocal opt-in; null when off / cohort too small (band simply hides).
  const benchmarks = await loadBenchmarks(identity).catch(() => ({ participating: false as const }));
  const healthBand = pickPosition(benchmarks, "health");
  // Alliance Copilot: key-gated (disabled state when unset) + the target tier for its
  // suggested strategic prompt ("…to reach Advanced?").
  const copilotEnabled = Boolean(env.ANTHROPIC_API_KEY);
  const targetTierId = data.inputs.tier?.targetTier ?? null;
  const targetTierLabel = targetTierId ? TIER_LABELS[targetTierId as TierId] ?? targetTierId : "the next tier";
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
            {showQbr && <a href="/command/export" style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, textDecoration: "none", border: "1px solid var(--border)", color: "var(--accent)" }}>Export packet</a>}
          </>
        }
      />
      <CommandNav showGraph={showGraph} />

      {/* Workbench mode clusters its many panels under labeled groups
          (Brief → Act → Simulate → Ask) so the page reads as four moments, not a
          16-panel scroll. Executive mode keeps the lean ungrouped layout. */}
      {mode === "workbench" && <GroupHeading label="Brief" caption="where the partnership stands right now" />}

      {/* Today's Command Brief */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Panel title="Partnership health" accent="var(--section-accent)">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <RingGauge
                value={cc.health.score}
                color={BAND_COLOR[cc.health.band]}
                caption={cc.health.band.replace("_", " ")}
                size={112}
              />
              {healthBand?.position ? <BenchmarkBand position={healthBand.position} /> : null}
            </div>
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

        <Panel title="Highest-priority risk" accent="var(--section-accent)" icon={<IconWarning size={16} />}>
          {cc.topRisk ? (
            <AttentionItem
              variant="hero"
              severity={cc.topRisk.severity}
              title={cc.topRisk.title}
              detail={cc.topRisk.detail}
              href={cc.topRisk.link}
              owner={ownerName(cc.topRisk.ownerUserId)}
              dueDate={cc.topRisk.dueDate}
              today={today}
              cta="Review →"
            />
          ) : (
            <EmptyState title="No open risks" hint="Nothing critical needs attention right now." />
          )}
        </Panel>

        <Panel title="Required decision" accent="var(--section-accent)" icon={<IconClock size={16} />}>
          {cc.requiredDecision ? (
            <AttentionItem
              variant="hero"
              severity={cc.requiredDecision.severity}
              title={cc.requiredDecision.title}
              detail={cc.requiredDecision.detail}
              href={cc.requiredDecision.link}
              owner={ownerName(cc.requiredDecision.ownerUserId)}
              dueDate={cc.requiredDecision.dueDate}
              today={today}
              cta="Decide →"
            />
          ) : (
            <EmptyState title="Nothing requires a decision" hint="You're all caught up here." />
          )}
        </Panel>

        <Panel
          title="Work"
          accent="var(--section-accent)"
          actions={
            <Link href="/command/tasks" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
              Open tasks →
            </Link>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
            <MetricCard label="Open" value={String(cc.work.open)} href="/command/tasks" trend={mkTrend(trends.openWork)} />
            <MetricCard label="Overdue" value={String(cc.work.overdue)} tone={cc.work.overdue > 0 ? "danger" : "neutral"} href="/command/tasks?view=overdue" trend={mkTrend(trends.overdue, { invert: true })} />
            <MetricCard label="Blocked" value={String(cc.work.blocked)} tone={cc.work.blocked > 0 ? "danger" : "neutral"} href="/command/tasks" />
            <MetricCard label="Critical" value={String(cc.work.critical)} tone={cc.work.critical > 0 ? "danger" : "neutral"} href="/command/tasks" />
          </div>
        </Panel>

        <Panel title="Decision load by owner" accent="var(--section-accent)">
          {ownerLoadRows.length === 0 ? (
            <EmptyState title="No open decisions" hint="Nothing is waiting on an owner right now." />
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
          href="/ace"
          icon={<IconPortfolio size={15} />}
          value={money(pipe.openValue)}
          sub={`${pipe.open} open ${pipe.open === 1 ? "deal" : "deals"}`}
          tone="accent"
          style={{ alignSelf: "start" }}
        />
        <MetricCard
          label="MDF pending"
          href="/mdf?view=to_claim"
          icon={<IconMdf size={15} />}
          value={money(mdf.remaining)}
          sub="approved, unclaimed"
          tone={mdf.deadlineRisks > 0 ? "warn" : "accent"}
          tint={mdf.deadlineRisks > 0 ? "warn" : undefined}
          style={{ alignSelf: "start" }}
        />
        <MetricCard
          label="Active programs"
          href="/programs?view=active"
          icon={<IconPrograms size={15} />}
          value={`${cc.progress.programsActive}/${cc.progress.programsTotal}`}
          sub="competencies & tiers"
          tone="ok"
          trend={mkTrend(trends.activePrograms)}
          style={{ alignSelf: "start" }}
        />
      </div>

      {mode === "workbench" && <GroupHeading label="Act" caption="the highest-leverage moves, ranked by projected impact" />}

      {/* Your move — prescriptive, impact-ranked next-best-actions (the cross-domain
          "what should I do next + projected impact" ACE structurally cannot offer). */}
      <Panel title="Your move" accent="var(--accent)">
        {cc.nextBestActions.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            You&apos;re on track — no high-leverage moves right now. Work the queue below as items surface.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
              The highest-leverage moves right now, ranked by projected impact on partnership health, tier progress, and open alerts.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {cc.nextBestActions.map((a, i) => (
                <Card key={a.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                        <strong style={{ fontSize: 14 }}>{a.title}</strong>
                        {a.quickWin ? <Badge tone="ok">Quick win</Badge> : null}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>{a.detail}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {a.impact.healthDelta > 0 ? <Badge tone="ok">▲ {a.impact.healthDelta} health</Badge> : null}
                        {a.impact.tierPctDelta > 0 ? <Badge tone="accent">▲ {a.impact.tierPctDelta}% tier</Badge> : null}
                        {a.impact.queueDelta > 0 ? <Badge tone="info">−{a.impact.queueDelta} alert{a.impact.queueDelta === 1 ? "" : "s"}</Badge> : null}
                      </div>
                    </div>
                    <Link href={a.link} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                      Act →
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* Wave 3: scenario planner — compose SEVERAL moves and see the stacked effect.
          URL-driven (?scenario=key1,key2): every toggle is a plain link, zero client JS.
          Collapsible as a pair with "What breaks next" — the Simulate moment. */}
      {mode === "workbench" && (pickList.length > 0 || outlook !== null) && (
        <details open style={{ display: "grid", gap: 16 }}>
          <GroupSummary label="Simulate" caption="what-if bundles and the 30/60/90-day outlook" />
          {pickList.length > 0 && (
        <Panel title="Scenario planner" accent="var(--accent-2)">
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
            Stack moves and see where they land you — a what-if bundle over live data. Toggle moves below; share the URL to share the scenario.
          </p>

          {scenario && scenario.steps.length > 0 && (
            <div style={{ marginBottom: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>
                  Health{" "}
                  <span style={{ color: BAND_COLOR[scenario.baseline.band] }}>{scenario.baseline.health}</span>
                  {" → "}
                  <span style={{ color: BAND_COLOR[scenario.result.band] }}>{scenario.result.health}</span>
                </strong>
                {scenario.delta.healthDelta !== 0 ? (
                  <Badge tone={scenario.delta.healthDelta > 0 ? "ok" : "danger"}>
                    {scenario.delta.healthDelta > 0 ? "▲" : "▼"} {Math.abs(scenario.delta.healthDelta)} health
                  </Badge>
                ) : null}
                {scenario.delta.tierPctDelta > 0 ? <Badge tone="accent">▲ {scenario.delta.tierPctDelta}% tier</Badge> : null}
                {scenario.delta.queueDelta > 0 ? (
                  <Badge tone="info">−{scenario.delta.queueDelta} alert{scenario.delta.queueDelta === 1 ? "" : "s"}</Badge>
                ) : null}
                <Link href={scenarioHref([])} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
                  Clear scenario
                </Link>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                    <th style={{ padding: "3px 8px" }}>Move</th>
                    <th style={{ padding: "3px 8px", textAlign: "right" }}>Health so far</th>
                    <th style={{ padding: "3px 8px", textAlign: "right" }}>Tier so far</th>
                    <th style={{ padding: "3px 8px", textAlign: "right" }}>Alerts so far</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.steps.map((s, i) => (
                    <tr key={s.key} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>{" "}
                        <strong>{s.title}</strong>
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {s.cumulative.healthDelta > 0 ? `+${s.cumulative.healthDelta}` : s.cumulative.healthDelta}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {s.cumulative.tierPctDelta > 0 ? `+${s.cumulative.tierPctDelta}%` : `${s.cumulative.tierPctDelta}%`}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {s.cumulative.queueDelta > 0 ? `−${s.cumulative.queueDelta}` : s.cumulative.queueDelta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {scenario.droppedKeys.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                  {scenario.droppedKeys.length} selected move{scenario.droppedKeys.length === 1 ? " is" : "s are"} no longer
                  applicable (already acted on) and {scenario.droppedKeys.length === 1 ? "was" : "were"} dropped.
                </p>
              )}
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            {pickList.map((a) => {
              const selected = selectedSet.has(a.key);
              return (
                <div key={a.key} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <Link
                    href={toggleHref(a.key)}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      color: selected ? "var(--ok)" : "var(--accent)",
                    }}
                  >
                    {selected ? "✓ In scenario" : "+ Add"}
                  </Link>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{a.title}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone="neutral">{EFFORT_LABELS[a.effort]}</Badge>
                    <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      leverage {a.leverage}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Wave 3: what breaks next — the SAME decision queue + health score re-run at
          future dates. Pure decay projection: do nothing, and this is what fires. */}
      {outlook && (
        <Panel title="What breaks next" accent="var(--warn)">
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
            If nothing changes: the risks that newly fire at each horizon, and where health lands.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {outlook.horizons.map((h) => (
              <div key={h.days} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>In {h.days} days</strong>
                  <Badge tone={h.healthDelta < 0 ? "danger" : "neutral"}>
                    health {h.health}
                    {h.healthDelta !== 0 ? ` (${h.healthDelta > 0 ? "+" : ""}${h.healthDelta})` : ""}
                  </Badge>
                </div>
                {h.emerging.length === 0 ? (
                  <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--muted)" }}>Nothing new breaks.</p>
                ) : (
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {h.emerging.map((d) => (
                      <div key={d.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span style={{ color: SEVERITY_COLOR[d.severity], fontWeight: 700 }}>●</span>
                        <span style={{ minWidth: 0 }}>
                          {d.title}
                          <span style={{ color: "var(--muted)" }}> · {SITUATION_LABELS[d.situation]}{d.dueDate ? ` · ${d.dueDate}` : ""}</span>
                        </span>
                      </div>
                    ))}
                    {h.emergingTotal > h.emerging.length && (
                      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>+{h.emergingTotal - h.emerging.length} more</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
        </details>
      )}

      {/* Alliance Copilot — strategic Q&A grounded in the LIVE workspace brief (health,
          decision queue, next-best-actions, tier ETA). A cross-domain assistant ACE
          structurally can't offer, since it has neither the data nor the assistant. */}
      {showCopilot && (mode === "workbench" ? (
        <details open style={{ display: "grid", gap: 16 }}>
          <GroupSummary label="Ask" caption="a conversational advisor grounded in the live brief" />
          <Panel title="Alliance Copilot" accent="var(--accent-2)">
            <AllianceCopilot enabled={copilotEnabled} targetTierLabel={targetTierLabel} />
          </Panel>
        </details>
      ) : (
        <Panel title="Alliance Copilot" accent="var(--accent-2)">
          <AllianceCopilot enabled={copilotEnabled} targetTierLabel={targetTierLabel} />
        </Panel>
      ))}

      {mode === "workbench" && <GroupHeading label="Queue & receipts" caption="every open decision, and what automation already did" />}

      {/* Decision queue */}
      <Panel title="Decision queue" accent="var(--section-accent)">
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
        <AttentionList
          items={decisions.map((d) => ({
            key: d.id,
            severity: d.severity,
            title: d.title,
            detail: d.detail,
            href: d.link,
            owner: ownerName(d.ownerUserId),
            dueDate: d.dueDate,
            today,
          }))}
          empty={{ title: "No decisions in this view", hint: "Nothing needs attention here right now." }}
        />
      </Panel>

      {/* Progress */}
      <Panel title="Progress" accent="var(--section-accent)">
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
        <Panel title="Recent workflow receipts" accent="var(--section-accent)">
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

/** Workbench group label — clusters the panel stack into named moments. */
function GroupHeading({ label, caption }: { label: string; caption: string }): ReactNode {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "10px 0 -6px" }}>
      <h2 style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--section-accent)" }}>
        {label}
      </h2>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{caption}</span>
    </div>
  );
}

/** Same label rendered as a collapsible <details> summary (Simulate / Ask groups). */
function GroupSummary({ label, caption }: { label: string; caption: string }): ReactNode {
  return (
    <summary style={{ cursor: "pointer", listStylePosition: "inside", margin: "10px 0 10px", fontSize: 12 }}>
      <span style={{ textTransform: "uppercase", letterSpacing: 0.6, color: "var(--section-accent)", fontWeight: 700 }}>
        {label}
      </span>
      <span style={{ color: "var(--muted)", marginLeft: 10 }}>{caption}</span>
    </summary>
  );
}
