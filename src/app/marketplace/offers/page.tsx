import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { MutationForm } from "@/components/ui/MutationForm";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { NewOfferDrawer } from "@/app/marketplace/offers/NewOfferDrawer";
import { loadPrivateOffers, loadOfferFormOptions } from "@/domain/marketplace/offer-load";
import { setPrivateOfferStatus } from "@/domain/marketplace/offer-actions";
import { offerSummary, PRIVATE_OFFER_STATUS_LABELS, isOpen } from "@/domain/marketplace/private-offers";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


const TONE = (s: string): "ok" | "info" | "danger" =>
  s === "accepted" ? "ok" : s === "draft" || s === "sent" ? "info" : "danger";

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;
  const sp = await searchParams;
  // Deep-link preselect: Deal Desk's offer moves arrive with ?opp=<opportunity id>.
  const defaultOppId = typeof sp.opp === "string" ? sp.opp : "";

  const [offers, options] = await Promise.all([loadPrivateOffers(identity), loadOfferFormOptions(identity)]);
  const summary = offerSummary(offers);
  const reconciled = offers.filter((o) => o.agreementId !== null).length;

  return (
    <PageShell>
      <PageHeader
        title="Private offers"
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/marketplace", label: "Marketplace" }, { label: "Private offers" }]}
        subtitle="Co-sell private offers that close deals on AWS Marketplace — drafted from a deal, reconciled to the AWS agreement on sync. The bridge from co-sell to transaction."
        actions={<NewOfferDrawer opps={options.opps} listings={options.listings} defaultOppId={defaultOppId} />}
      />
      <MarketplaceNav />

      <MetricStrip>
        <MetricCard label="Offers" value={String(summary.total)} sub="drafted" />
        <MetricCard label="In flight" value={money(summary.inFlightValue)} sub={`${summary.byStatus.draft + summary.byStatus.sent} open`} tone={summary.byStatus.sent > 0 ? "warn" : "neutral"} />
        <MetricCard label="Accepted" value={money(summary.acceptedValue)} sub={`${summary.byStatus.accepted} closed`} tone={summary.byStatus.accepted > 0 ? "ok" : "neutral"} />
        <MetricCard label="Reconciled" value={String(reconciled)} sub="to AWS agreements" />
      </MetricStrip>

      <Panel title={`Offers (${offers.length})`} accent="var(--section-accent)">
        {offers.length === 0 ? (
          <EmptyState
            title="No private offers yet"
            hint="Draft a private offer here or from a deal's Deal Desk to close it on AWS Marketplace."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {offers.map((o) => (
              <Card key={o.id} style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{o.title}</strong>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                      {o.customerName || "—"}
                      {o.listingTitle ? ` · ${o.listingTitle}` : ""}
                      {o.discountPct > 0 ? ` · ${o.discountPct}% off` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone="neutral">{money(o.offerValue)}</Badge>
                    <Badge tone={TONE(o.status)}>{PRIVATE_OFFER_STATUS_LABELS[o.status]}</Badge>
                    {o.agreementId ? <Badge tone="ok">Reconciled</Badge> : null}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12.5 }}>
                    {o.opportunityId ? (
                      <Link href={`/ace/${o.opportunityId}`} style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>
                        {o.opportunityName ?? "Backing deal"} →
                      </Link>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>No linked deal</span>
                    )}
                  </div>
                  {isOpen(o.status) ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {o.status === "draft" ? (
                        <MutationForm action={setPrivateOfferStatus} hidden={{ offerId: o.id, status: "sent" }} submitLabel="Send" variant="secondary" successMessage="Offer sent." />
                      ) : null}
                      <MutationForm action={setPrivateOfferStatus} hidden={{ offerId: o.id, status: "withdrawn" }} submitLabel="Withdraw" variant="danger" successMessage="Offer withdrawn." />
                    </div>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
