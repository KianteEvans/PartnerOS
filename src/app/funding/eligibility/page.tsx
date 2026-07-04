import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { FundingNav } from "@/app/funding/FundingNav";
import { ApplyDrawer } from "@/app/funding/ApplyDrawer";
import { loadFundingMatcher } from "@/domain/funding/load";
import { matchPrograms } from "@/domain/funding/eligibility";
import { money } from "@/domain/format";


export default async function FundingMatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const { opp } = await searchParams;

  const { deals, context, applied } = await loadFundingMatcher(identity, opp);
  const selected = opp ? deals.find((d) => d.id === opp) ?? null : null;

  return (
    <PageShell>
      <PageHeader
        title="Funding matcher"
        subtitle="Score any deal against every AWS funding program to see which mechanisms it qualifies for — and apply."
      />
      <FundingNav />

      {selected === null ? (
        <>
          <Callout tone="info" title="Pick a deal">
            Choose an opportunity to see the AWS funding programs it&rsquo;s eligible for. Tier {context.tier} · {context.competencyKeys.length} competencies adopted.
          </Callout>
          {deals.length === 0 ? (
            <EmptyState title="No opportunities yet" hint="Add deals in ACE Pipeline, then return here to match them to funding." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {deals.map((d) => (
                <Link key={d.id} href={`/funding/eligibility?opp=${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <Card interactive style={{ display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 14 }}>{d.name}</strong>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{d.accountName || "—"}</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      <Badge tone="neutral">{money(d.profile.amount)}</Badge>
                      <Badge tone="neutral">{d.profile.stage.replace(/_/g, " ")}</Badge>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        (() => {
          const matches = matchPrograms(selected.profile, context);
          const eligibleCount = matches.filter((m) => m.eligible).length;
          return (
            <>
              <Panel title={`Funding fit — ${selected.name}`} accent="var(--section-accent)">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge tone="neutral">{selected.accountName || "—"}</Badge>
                  <Badge tone="neutral">{money(selected.profile.amount)}</Badge>
                  <Badge tone="neutral">{selected.profile.stage.replace(/_/g, " ")}</Badge>
                  <Badge tone={eligibleCount > 0 ? "ok" : "warn"}>{eligibleCount} eligible programs</Badge>
                  <Link href="/funding/eligibility" style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)", textDecoration: "none" }}>
                    ← Pick another deal
                  </Link>
                </div>
              </Panel>

              <div style={{ display: "grid", gap: 12 }}>
                {matches.map((m) => (
                  <Card key={m.program.key} style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <strong style={{ fontSize: 14.5 }}>{m.program.name}</strong>
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{m.rationale}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {applied[m.program.key] && (
                          <Badge tone="info">Applied ({applied[m.program.key]})</Badge>
                        )}
                        <Badge tone={m.eligible ? "ok" : "warn"}>{m.eligible ? "Eligible" : `${m.score}% fit`}</Badge>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {m.met.map((c, i) => (
                        <Badge key={`m${i}`} tone="ok">
                          ✓ {c.label}
                        </Badge>
                      ))}
                      {m.unmet.map((c, i) => (
                        <Badge key={`u${i}`} tone="danger">
                          ✗ {c.label}
                        </Badge>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {m.program.managedInternally === "mdf" ? (
                        <Link href="/mdf" style={{ color: "var(--section-accent)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                          Managed in MDF →
                        </Link>
                      ) : applied[m.program.key] ? (
                        <Link href="/funding/submissions" style={{ color: "var(--section-accent)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                          View submission →
                        </Link>
                      ) : (
                        <ApplyDrawer program={m.program} oppId={selected.id} triggerLabel="Apply for this deal" triggerVariant={m.eligible ? "primary" : "secondary"} />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </>
          );
        })()
      )}
    </PageShell>
  );
}
