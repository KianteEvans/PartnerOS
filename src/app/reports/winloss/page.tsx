import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { BarChart } from "@/components/ui/BarChart";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { can } from "@/authz/permissions";
import { loadWinLoss } from "@/domain/ace/winloss-load";
import { cycleDays, LOSS_REASON_LABELS, STRONG_STRENGTH, type LossReason } from "@/domain/ace/winloss";
import { SOURCE_LABELS, STAGE_LABELS } from "@/domain/ace/opportunities";
import { isWinLossAiEnabled } from "@/domain/ace/winloss-ai";
import { WinLossNarrative } from "./WinLossNarrative";
import { money } from "@/domain/format";
import { Pagination } from "@/components/ui/Pagination";
import { pageCount } from "@/domain/list";

/**
 * Win/loss mining (Wave 2 finale). Learns from CLOSED deals: win rate by cohort,
 * why deals are lost, which cross-domain factors correlate with winning (MDF,
 * funding, private offers, AWS team, competency, solution — correlation, not
 * causation), and which AWS relationships actually drive wins. Retrospective
 * learning ACE structurally can't do (it sees only individual referrals).
 */

const pct = (n: number | null): string => (n == null ? "—" : `${n}%`);
const winTone = (n: number | null): Tone => (n == null ? "neutral" : n >= 60 ? "ok" : n >= 40 ? "warn" : "danger");

const DEALS_PAGE_SIZE = 15;

export default async function WinLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  if (!can(identity.role, "report:read")) redirect("/");

  const sp = await searchParams;
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const { report: r, deals, reps, strength } = await loadWinLoss(identity);
  const o = r.overall;
  const trusted = r.factors.filter((f) => !f.suppressed && f.lift !== null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
  // Mining always uses every closed deal; only the table display pages.
  const dealPages = pageCount(deals.length, DEALS_PAGE_SIZE);
  const dealPage = Math.min(Math.max(1, Number.isFinite(pageRaw) ? Math.trunc(pageRaw) : 1), dealPages);
  const pagedDeals = deals.slice((dealPage - 1) * DEALS_PAGE_SIZE, dealPage * DEALS_PAGE_SIZE);

  return (
    <PageShell>
      <PageHeader
        title="Win/loss mining"
        subtitle="Why you win, why you lose, and which AWS relationships drive it — learned from your closed deals"
        breadcrumbs={[{ href: "/reports", label: "Reports" }, { label: "Win/loss" }]}
      />

      {o.closed === 0 ? (
        <EmptyState
          title="No closed deals yet"
          hint="Mark opportunities won or lost (with a loss reason) in ACE — the mining starts learning from the first closed deal."
        />
      ) : (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <MetricCard label="Closed deals" value={String(o.closed)} sub={`${o.won} won · ${o.lost} lost`} />
            <MetricCard label="Win rate" value={pct(o.winRate)} sub="of closed" tone={winTone(o.winRate)} tint={winTone(o.winRate) === "neutral" ? undefined : winTone(o.winRate)} />
            <MetricCard label="Won revenue" value={money(o.wonTCV)} sub="realized" tone="ok" />
            <MetricCard label="Lost revenue" value={money(o.lostTCV)} sub="walked away" tone={o.lostTCV > 0 ? "danger" : "neutral"} />
            <MetricCard label="Avg cycle" value={o.avgCycleDays == null ? "—" : `${o.avgCycleDays}d`} sub="created → won" />
          </section>

          <Panel title="Explain" actions={null}>
            <WinLossNarrative enabled={isWinLossAiEnabled()} />
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <Panel title="Win rate by source" accent="accent">
              <BarChart
                max={100}
                formatValue={(n) => `${n}%`}
                data={r.bySource.map((c) => ({
                  label: `${c.label} (${c.closed})`,
                  value: c.winRate ?? 0,
                  color: "var(--accent-2)",
                }))}
              />
            </Panel>
            <Panel title="Why deals are lost">
              {r.lossReasons.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  No loss reasons recorded yet — capture one when marking a deal lost.
                </p>
              ) : (
                <BarChart
                  formatValue={(n) => String(n)}
                  data={r.lossReasons.map((x) => ({
                    label: `${x.label} (${money(x.lostTCV)})`,
                    value: x.count,
                    color: "var(--danger)",
                  }))}
                />
              )}
            </Panel>
          </div>

          <Panel title="What correlates with winning" accent="accent">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                    <th style={{ padding: "6px 10px" }}>Factor</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>With</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Without</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Lift</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {r.factors.map((f) => (
                    <tr key={f.key} style={{ borderTop: "1px solid var(--border)", opacity: f.suppressed ? 0.6 : 1 }}>
                      <td style={{ padding: "9px 10px", fontWeight: 600 }}>{f.label}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(f.withWinRate)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(f.withoutWinRate)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: f.lift != null && f.lift > 1 ? "var(--ok)" : "var(--text)" }}>
                        {f.lift == null ? "—" : `${f.lift}x`}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 12 }}>
                        {f.suppressed ? <Badge tone="neutral">low sample</Badge> : `${f.nWith} vs ${f.nWithout}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trusted[0] ? (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                Strongest signal: <strong style={{ color: "var(--text)" }}>{trusted[0].label}</strong> deals win{" "}
                {trusted[0].lift}x more often ({pct(trusted[0].withWinRate)} vs {pct(trusted[0].withoutWinRate)}). Correlation, not causation.
              </p>
            ) : (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                Factors unlock as more deals close (needs 3+ closed deals on each side). Correlation, not causation.
              </p>
            )}
          </Panel>

          <Panel title="AWS relationships that win">
            {reps.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                No closed deals are attributed to an AWS relationship yet — link an AWS contact on your deals.
              </p>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                        <th style={{ padding: "6px 10px" }}>Relationship</th>
                        <th style={{ padding: "6px 10px" }}>Role</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Strength</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Closed</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Win rate</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Won TCV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reps.map((rep) => (
                        <tr key={rep.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 10px", fontWeight: 600 }}>{rep.name}</td>
                          <td style={{ padding: "9px 10px", color: "var(--muted)" }}>{rep.role.replace(/_/g, " ")}</td>
                          <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{rep.strength}</td>
                          <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{rep.closed}</td>
                          <td style={{ padding: "9px 10px", textAlign: "right" }}>
                            <Badge tone={winTone(rep.winRate)}>{pct(rep.winRate)}</Badge>
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ok)" }}>
                            {rep.wonTCV > 0 ? money(rep.wonTCV) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {strength.strongClosed > 0 && strength.weakClosed > 0 ? (
                  <Callout tone={((strength.strongWinRate ?? 0) >= (strength.weakWinRate ?? 0) ? "ok" : "warn") as "ok" | "warn"} title="Relationship strength pays">
                    Deals attributed to strong relationships (strength ≥ {STRONG_STRENGTH}) win{" "}
                    <strong>{pct(strength.strongWinRate)}</strong> of the time vs <strong>{pct(strength.weakWinRate)}</strong> for weaker
                    ones ({strength.strongClosed} vs {strength.weakClosed} closed deals).
                  </Callout>
                ) : null}
              </>
            )}
          </Panel>

          <Panel title={`Closed deals (${deals.length})`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                    <th style={{ padding: "6px 10px" }}>Deal</th>
                    <th style={{ padding: "6px 10px" }}>Outcome</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "6px 10px" }}>Source</th>
                    <th style={{ padding: "6px 10px" }}>Stage at close</th>
                    <th style={{ padding: "6px 10px" }}>Loss reason</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Cycle</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDeals.map((d) => {
                    const cyc = cycleDays(d);
                    return (
                      <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "9px 10px", fontWeight: 600 }}>{d.name}</td>
                        <td style={{ padding: "9px 10px" }}>
                          <Badge tone={d.status === "won" ? "ok" : "danger"}>{d.status}</Badge>
                        </td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(d.amount)}</td>
                        <td style={{ padding: "9px 10px", color: "var(--muted)" }}>{SOURCE_LABELS[d.source]}</td>
                        <td style={{ padding: "9px 10px", color: "var(--muted)" }}>{STAGE_LABELS[d.stage]}</td>
                        <td style={{ padding: "9px 10px", color: "var(--muted)" }}>
                          {d.status === "lost" ? (d.lossReason ? LOSS_REASON_LABELS[d.lossReason as LossReason] ?? d.lossReason : "not recorded") : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {cyc == null ? "—" : `${cyc}d`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={dealPage}
              totalPages={dealPages}
              total={deals.length}
              prevHref={`/reports/winloss?page=${dealPage - 1}`}
              nextHref={`/reports/winloss?page=${dealPage + 1}`}
            />
          </Panel>

          <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
            Factor lifts compare win rates of closed deals with vs without each factor — correlation, not
            causation; factors with fewer than 3 closed deals on either side are marked low sample. Cycle time
            uses the actual close stamp (deals closed before capture was added use an approximate stamp).
          </p>
        </>
      )}
    </PageShell>
  );
}
