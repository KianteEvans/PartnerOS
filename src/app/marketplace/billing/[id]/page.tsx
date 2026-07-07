import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Table, type Column } from "@/components/ui/Table";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { loadAgreementDetail, type AgreementChargeDetail } from "@/domain/marketplace/load";
import { isActiveAgreement } from "@/domain/marketplace/billing";
import { PRIVATE_OFFER_STATUS_LABELS } from "@/domain/marketplace/private-offers";
import { moneyFromCents as money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

// Same status->tone mapping the Offers page uses.
const offerTone = (s: string): "ok" | "info" | "danger" =>
  s === "accepted" ? "ok" : s === "draft" || s === "sent" ? "info" : "danger";

/**
 * One agreement's drill-down: the AWS agreement facts, its full charge history
 * (joined on the AWS agreement identifier), and the private offer it settled.
 */
export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

  const a = await loadAgreementDetail(identity, id).catch(() => null);
  if (!a) notFound();

  const chargeColumns: ReadonlyArray<Column<AgreementChargeDetail>> = [
    { key: "period", header: "Billing period", render: (c) => (c.periodStart ? `${c.periodStart} – ${c.periodEnd ?? "…"}` : "—") },
    { key: "dimension", header: "Dimension", render: (c) => (c.dimension ? <code style={{ fontSize: 12 }}>{c.dimension}</code> : "—") },
    { key: "qty", header: "Qty", align: "right", render: (c) => String(c.quantity) },
    { key: "amount", header: "Amount", align: "right", render: (c) => money(c.amount) },
    { key: "line", header: "Invoice line", render: (c) => c.invoiceLineItem || "—" },
  ];

  return (
    <PageShell>
      <PageHeader
        title={a.customerIdentifier || "Agreement"}
        subtitle={a.agreementId ? `AWS agreement ${a.agreementId}` : "Locally tracked agreement (no AWS identifier yet)."}
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/marketplace/billing", label: "Billing" },
          { label: a.customerIdentifier || "Agreement" },
        ]}
        actions={<Badge tone={isActiveAgreement(a, today) ? "ok" : "neutral"}>{a.status || "Active"}</Badge>}
      />
      <MarketplaceNav />

      <MetricStrip>
        <MetricCard label="Total contract value" value={money(a.totalValue)} tint="accent" />
        <MetricCard label="Charged to date" value={money(a.chargedTotal)} tone={a.chargedTotal > 0 ? "ok" : "neutral"} />
        <MetricCard label="Charges" value={String(a.charges.length)} sub="billing rows" />
      </MetricStrip>

      <Panel title="Agreement">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            margin: 0,
            fontSize: 13,
          }}
        >
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Offer type</dt>
            <dd style={{ margin: "2px 0 0" }}>{a.offerType || "—"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Term</dt>
            <dd style={{ margin: "2px 0 0" }}>
              {a.startDate ?? "—"} → {a.endDate ?? "open-ended"}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Auto-renew</dt>
            <dd style={{ margin: "2px 0 0" }}>{a.autoRenew ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Accepted</dt>
            <dd style={{ margin: "2px 0 0" }}>{a.acceptanceTime ? a.acceptanceTime.toISOString().slice(0, 10) : "—"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Listing</dt>
            <dd style={{ margin: "2px 0 0" }}>
              {a.listingId && a.listingTitle ? (
                <Link href={`/marketplace/listings/${a.listingId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                  {a.listingTitle}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)", fontSize: 12 }}>Private offer</dt>
            <dd style={{ margin: "2px 0 0" }}>
              {a.offer ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Link href="/marketplace/offers" style={{ color: "var(--accent)", textDecoration: "none" }}>
                    {a.offer.title}
                  </Link>
                  <Badge tone={offerTone(a.offer.status)}>
                    {PRIVATE_OFFER_STATUS_LABELS[a.offer.status as keyof typeof PRIVATE_OFFER_STATUS_LABELS] ?? a.offer.status}
                  </Badge>
                </span>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title={`Charges (${a.charges.length})`} accent="var(--section-accent)">
        {a.charges.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No charges recorded for this agreement.</p>
        ) : (
          <Table columns={chargeColumns} rows={a.charges} rowKey={(c) => c.id} empty="No charges." />
        )}
      </Panel>
    </PageShell>
  );
}
