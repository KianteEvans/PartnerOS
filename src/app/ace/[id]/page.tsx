import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApplyDrawer } from "@/app/funding/ApplyDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { can } from "@/authz/permissions";
import { loadDealDesk } from "@/domain/ace/deal-desk-load";
import { attachOppCaseStudy, detachOppCaseStudy } from "@/domain/ace/actions";
import { STAGE_LABELS, SOURCE_LABELS, priorityScore, isAtRisk, type OppLike } from "@/domain/ace/opportunities";
import { HEALTH_BAND_LABELS, type HealthBand } from "@/domain/ace/rep-intelligence";
import { OfferDrawer } from "./OfferDrawer";
import { CaseStudyPitch } from "./CaseStudyPitch";
import { isCaseStudyPitchEnabled } from "@/domain/ace/case-study-pitch-ai";
import { lifecycleSteps, PRIVATE_OFFER_STATUS_LABELS, type PrivateOfferStatus } from "@/domain/marketplace/private-offers";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


const OFFER_TONE = (s: PrivateOfferStatus): "ok" | "info" | "danger" =>
  s === "accepted" ? "ok" : s === "draft" || s === "sent" ? "info" : "danger";

const MOVE_TONE = { deal: "danger", rep: "warn", funding: "accent", mdf: "info", marketplace: "info", proof: "info" } as const;
const BAND_TONE: Record<HealthBand, "ok" | "info" | "warn" | "danger"> = {
  strong: "ok",
  healthy: "ok",
  fair: "info",
  weak: "warn",
  dormant: "danger",
};

export default async function DealDeskPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("deal_desk");
  if (fenced) return <PackageFence feature="deal_desk" previewTier={fenced} />;
  const { id } = await params;
  const model = await loadDealDesk(identity, id);
  if (!model) notFound();
  const o = model.opp;
  const today = new Date().toISOString().slice(0, 10);
  const eligibleCount = model.fundingMatches.filter((m) => m.eligible).length;
  const mdfApproved = model.mdf.reduce((s, m) => s + (m.approvedAmount ?? 0), 0);
  const teamAtStake = model.awsTeam.filter((r) => r.atStake).length;
  const pitchEnabled = isCaseStudyPitchEnabled();

  return (
    <PageShell>
      <PageHeader
        title={o.name}
        breadcrumbs={[
          { href: "/ace", label: "ACE Pipeline" },
          { label: o.name },
        ]}
        subtitle="One deal, every lever — funding, MDF, marketplace, and your AWS team fused into a single command surface. ACE sees only the referral."
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone="neutral">{o.accountName || "—"}</Badge>
        <Badge tone="neutral">{STAGE_LABELS[o.stage]}</Badge>
        <Badge tone="neutral">{money(o.amount)}</Badge>
        <Badge tone="neutral">{SOURCE_LABELS[o.source]}</Badge>
        <Badge tone={o.status === "won" ? "ok" : o.status === "lost" ? "danger" : "info"}>{o.status}</Badge>
        <Badge tone="neutral">Priority {priorityScore(o as OppLike, today)}</Badge>
        {isAtRisk(o as OppLike, today) ? <Badge tone="danger">At risk</Badge> : null}
      </div>

      <Panel title="Your moves" accent="var(--section-accent)">
        {model.moves.length === 0 ? (
          <EmptyState title="On track" hint="No priority moves right now." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {model.moves.map((m, i) => (
              <Card key={m.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Badge tone={MOVE_TONE[m.kind]}>{i + 1}</Badge>
                    <strong style={{ fontSize: 14.5 }}>{m.title}</strong>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{m.detail}</div>
                </div>
                {m.link ? (
                  <Link href={m.link} style={{ fontSize: 13, fontWeight: 600, color: "var(--section-accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
                    Act →
                  </Link>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <MetricStrip>
        <MetricCard label="Funding fit" value={String(eligibleCount)} sub="eligible programs" tone={eligibleCount > 0 ? "ok" : "neutral"} />
        <MetricCard label="MDF backing" value={String(model.mdf.length)} sub={mdfApproved > 0 ? `${money(mdfApproved)} approved` : "requests"} />
        <MetricCard label="Marketplace" value={String(model.marketplace.agreements.length)} sub={`${model.marketplace.listings.length} listing(s)`} />
        <MetricCard label="AWS team" value={String(model.awsTeam.length)} sub={teamAtStake > 0 ? `${teamAtStake} at stake` : "contacts"} tone={teamAtStake > 0 ? "warn" : "neutral"} />
      </MetricStrip>

      <Panel title="Funding fit" accent="var(--section-accent)">
        {model.fundingMatches.length === 0 ? (
          <EmptyState title="No funding programs matched" hint="This deal doesn't currently qualify for a catalog program — revisit as the deal progresses." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {model.fundingMatches.map((m) => {
              const applied = model.appliedProgramKeys.includes(m.program.key);
              return (
                <Card key={m.program.key} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ fontSize: 14 }}>{m.program.name}</strong>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{m.rationale}</div>
                    </div>
                    <Badge tone={m.eligible ? "ok" : "warn"}>{m.eligible ? "Eligible" : `${m.score}% fit`}</Badge>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {m.met.map((c, i) => <Badge key={`m${i}`} tone="ok">✓ {c.label}</Badge>)}
                    {m.unmet.map((c, i) => <Badge key={`u${i}`} tone="danger">✗ {c.label}</Badge>)}
                  </div>
                  <div>
                    {applied ? (
                      <Badge tone="info">Already applied</Badge>
                    ) : m.program.managedInternally === "mdf" ? (
                      <Link href="/mdf" style={{ color: "var(--section-accent)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Managed in MDF →</Link>
                    ) : (
                      <ApplyDrawer program={m.program} oppId={o.id} triggerLabel="Apply for this deal" triggerVariant={m.eligible ? "primary" : "secondary"} />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="MDF support" accent="var(--section-accent)">
        {model.mdf.length === 0 ? (
          <EmptyState
            title="No MDF backing this deal"
            hint="Request AWS co-funding for a marketing activity to accelerate it."
            action={<Link href="/mdf" style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>Request MDF →</Link>}
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {model.mdf.map((m) => (
              <Card key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5 }}>{m.title}</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Badge tone="neutral">{money(m.requestedAmount)} requested</Badge>
                  {m.approvedAmount ? <Badge tone="ok">{money(m.approvedAmount)} approved</Badge> : null}
                  <Badge tone="info">{m.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Marketplace" accent="var(--section-accent)">
        {model.marketplace.listings.length === 0 ? (
          <EmptyState title="No linked marketplace listing" hint="Link this deal's Solution to a Marketplace listing (in the opportunity editor) to track private offers here." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {model.marketplace.listings.map((l) => (
              <Card key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5 }}>{l.title}</span>
                <Badge tone={l.status === "published" ? "ok" : "neutral"}>{l.status}</Badge>
              </Card>
            ))}
            {model.marketplace.agreements.length > 0 ? (
              model.marketplace.agreements.map((a) => (
                <Card key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>{a.offerType || "Agreement"} · {a.agreementId}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Badge tone="neutral">{money(a.totalValue)}</Badge>
                    <Badge tone="info">{a.status || "—"}</Badge>
                  </div>
                </Card>
              ))
            ) : (
              <Callout tone="info" title="No agreement yet">
                The listing is live but has no private offer / agreement — a private offer could close this on Marketplace.
              </Callout>
            )}
            {model.marketplace.entitlementCount > 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>{model.marketplace.entitlementCount} active entitlement(s).</p>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Private offer" accent="var(--section-accent)">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
            Draft the private offer that closes this deal on Marketplace — it reconciles to the AWS agreement on the next billing sync.
          </p>
          <OfferDrawer
            oppId={o.id}
            customerName={o.accountName}
            listings={model.marketplace.listings}
            triggerVariant={model.offers.length > 0 ? "secondary" : "primary"}
          />
        </div>
        {model.offers.length === 0 ? (
          <EmptyState title="No private offer for this deal yet" hint="Draft one to close this co-sell deal on AWS Marketplace." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {model.offers.map((f) => {
              const status = f.status as PrivateOfferStatus;
              return (
                <Card key={f.id} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13.5 }}>{f.title}</strong>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Badge tone="neutral">{money(f.offerValue)}</Badge>
                      <Badge tone={OFFER_TONE(status)}>{PRIVATE_OFFER_STATUS_LABELS[status]}</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {lifecycleSteps(status).map((s) => (
                      <Badge key={s.key} tone={s.state === "done" ? "ok" : s.state === "current" ? "info" : s.state === "terminal" ? "danger" : "neutral"}>
                        {s.label}
                      </Badge>
                    ))}
                  </div>
                  {f.agreementId ? (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Reconciled to the AWS Marketplace agreement.</div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel id="case-studies" title="Relevant case studies" accent="var(--section-accent)">
        {model.caseStudyLibraryCount === 0 ? (
          <EmptyState
            title="No case studies yet"
            hint="Build reusable customer proof points once and attach them to every deal they fit."
            action={
              <Link href="/programs/evidence/case-studies" style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>
                Create a case study →
              </Link>
            }
          />
        ) : model.caseStudies.length === 0 ? (
          <EmptyState
            title="No relevant case studies for this deal"
            hint="Add customer names and richer narratives to your case studies to improve matching."
            action={
              <Link href="/programs/evidence/case-studies" style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>
                Case study library →
              </Link>
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
              Proof points matched on this deal's customer, keywords, and linked solution — pin the ones the team should sell with.
            </p>
            <CaseStudyPitch enabled={pitchEnabled} oppId={o.id} />
            {model.caseStudies.map((cs) => {
              const canPin = can(identity.role, "ace:update");
              return (
                <Card key={cs.id} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <Link
                        href={`/programs/evidence/case-studies/${cs.id}`}
                        style={{ color: "var(--section-accent)", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                      >
                        {cs.title}
                      </Link>
                      {cs.customerName ? (
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{cs.customerName}</div>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {cs.attached ? <Badge tone="ok">Pinned</Badge> : <Badge tone="info">Match {cs.score}</Badge>}
                      {canPin ? (
                        cs.attached ? (
                          <MutationForm
                            action={detachOppCaseStudy}
                            submitLabel="Unpin"
                            variant="secondary"
                            hidden={{ opportunityId: o.id, caseStudyId: cs.id }}
                          />
                        ) : (
                          <MutationForm
                            action={attachOppCaseStudy}
                            submitLabel="Pin to deal"
                            variant="secondary"
                            hidden={{ opportunityId: o.id, caseStudyId: cs.id }}
                          />
                        )
                      ) : null}
                    </div>
                  </div>
                  {cs.reasons.length > 0 ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {cs.reasons.map((r, i) => (
                        <Badge key={i} tone="neutral">{r}</Badge>
                      ))}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="AWS team" accent="var(--section-accent)">
        {model.awsTeam.length === 0 ? (
          <EmptyState title="No AWS team mapped" hint="Sync the AWS sales org (ACE → Sales Org) or link an AWS contact to see relationship health here." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            {model.awsTeam.map((r) => (
              <Card key={r.id} style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                  <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                  <Badge tone={BAND_TONE[r.band]}>{HEALTH_BAND_LABELS[r.band]}</Badge>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.role} · score {r.score}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {r.daysSinceContact === null ? "Never contacted" : `${r.daysSinceContact}d since contact`}
                  {r.atStake ? " · pipeline at stake" : ""}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
