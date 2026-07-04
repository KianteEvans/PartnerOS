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
import { loadRoiLoop } from "@/domain/roi/load";
import { sortSpend } from "@/domain/roi/loop";
import { money } from "@/domain/format";

/**
 * Program ROI (Wave 2 — full ROI loops). Answers "did our MDF/funding pay off?" by
 * tracing approved spend -> influenced pipeline -> WON revenue -> tier credit, with
 * realized-vs-expected ROI and a view of where the loop leaks. Cross-domain (MDF,
 * Funding, ACE, Programs, Tiers) — an answer ACE can't give (it sees only the referral).
 */

const STATUS_TONE: Record<string, Tone> = { won: "ok", open: "info", lost: "danger" };

export default async function ProgramRoiPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  if (!can(identity.role, "report:read")) redirect("/");

  const { funnel: f, tierCredit } = await loadRoiLoop(identity);
  const rows = sortSpend(f.records);
  const realized = f.realizedRoi == null ? "—" : `${f.realizedRoi}x`;
  const expected = f.expectedRoi == null ? "—" : `${f.expectedRoi}x`;
  const roiTone: Tone =
    f.realizedRoi == null || f.expectedRoi == null
      ? "neutral"
      : f.realizedRoi >= f.expectedRoi
        ? "ok"
        : f.realizedRoi >= f.expectedRoi * 0.5
          ? "warn"
          : "danger";

  return (
    <PageShell>
      <PageHeader
        title="Program ROI"
        subtitle="Approved spend → influenced pipeline → won revenue → tier credit"
        breadcrumbs={[{ href: "/reports", label: "Reports" }, { label: "Program ROI" }]}
      />

      {f.records.length === 0 ? (
        <EmptyState
          title="No approved spend yet"
          hint="Approve an MDF request or AWS funding submission to start tracking realized ROI."
        />
      ) : (
        <>
          {/* Funnel hero */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            <MetricCard label="Approved spend" value={money(f.approvedSpend)} sub="MDF + funding" />
            <MetricCard label="Influenced pipeline" value={money(f.influencedOpen)} sub="open deals" tone="info" />
            <MetricCard label="Won revenue" value={money(f.influencedWon)} sub="realized" tint="ok" tone="ok" />
            <MetricCard label="Realized ROI" value={realized} sub={`expected ${expected}`} tone={roiTone} tint={roiTone === "neutral" ? undefined : roiTone} />
            {tierCredit ? (
              <MetricCard
                label="Tier credit"
                value={`${tierCredit.launched}/${tierCredit.threshold}`}
                sub={`launched → ${tierCredit.targetTier}`}
                tone="accent"
              />
            ) : null}
          </section>

          <Panel title="The loop" accent="accent">
            <BarChart
              formatValue={(n) => money(n)}
              data={[
                { label: "Approved spend", value: f.approvedSpend, color: "var(--warn)" },
                { label: "Influenced pipeline", value: f.influencedOpen, color: "var(--info)" },
                { label: "Won revenue", value: f.influencedWon, color: "var(--ok)" },
              ]}
            />
          </Panel>

          {f.unlinkedSpend > 0 || f.inFlightCount > 0 ? (
            <Callout tone="warn" title="Where the loop leaks">
              {f.unlinkedSpend > 0 ? (
                <>
                  <strong>{money(f.unlinkedSpend)}</strong> of approved spend isn&apos;t linked to a deal
                  {f.inFlightCount > 0 ? " · " : "."}
                </>
              ) : null}
              {f.inFlightCount > 0 ? (
                <>
                  <strong>{f.inFlightCount}</strong> influenced deal{f.inFlightCount === 1 ? "" : "s"} still in flight
                  (pipeline not yet realized).
                </>
              ) : null}
            </Callout>
          ) : null}

          <Panel title="Spend → outcome">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                    <th style={{ padding: "6px 10px" }}>Source</th>
                    <th style={{ padding: "6px 10px" }}>Spend</th>
                    <th style={{ padding: "6px 10px" }}>Approved</th>
                    <th style={{ padding: "6px 10px" }}>Linked deal</th>
                    <th style={{ padding: "6px 10px" }}>Won</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Realized ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "9px 10px" }}>
                        <Badge tone={r.kind === "mdf" ? "warn" : "accent"}>{r.kind === "mdf" ? "MDF" : "Funding"}</Badge>
                      </td>
                      <td style={{ padding: "9px 10px" }}>{r.title}</td>
                      <td style={{ padding: "9px 10px", fontVariantNumeric: "tabular-nums" }}>{money(r.approved)}</td>
                      <td style={{ padding: "9px 10px" }}>
                        {r.opp ? (
                          <>
                            {r.opp.name}{" "}
                            <Badge tone={STATUS_TONE[r.opp.status] ?? "neutral"}>{r.opp.status}</Badge>
                          </>
                        ) : (
                          <span style={{ color: "var(--danger)" }}>unlinked</span>
                        )}
                      </td>
                      <td style={{ padding: "9px 10px", fontVariantNumeric: "tabular-nums", color: r.influencedWon > 0 ? "var(--ok)" : "var(--muted)" }}>
                        {r.influencedWon > 0 ? money(r.influencedWon) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {r.realizedRoi == null ? "—" : `${r.realizedRoi}x`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
            Realized ROI = won revenue ÷ approved spend. Tier credit counts launched opportunities
            toward the AWS launched-opportunities requirement (real criteria; won revenue itself does
            not credit tier).
          </p>
        </>
      )}
    </PageShell>
  );
}
