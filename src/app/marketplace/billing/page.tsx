import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { Table, type Column } from "@/components/ui/Table";
import { MutationForm } from "@/components/ui/MutationForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchForm } from "@/components/ui/SearchForm";
import { Pagination } from "@/components/ui/Pagination";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { loadBilling, loadMarketplaceTrends, type AgreementItem } from "@/domain/marketplace/load";
import { billingSummary, revenueByPeriod, isActiveAgreement, LISTING_FEE_RATE } from "@/domain/marketplace/billing";
import { syncBilling } from "@/domain/marketplace/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/marketplace/table-view";
import { moneyFromCents as money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;
  const today = new Date().toISOString().slice(0, 10);
  const params = parseListParams(await searchParams, {
    sortable: ["value", "customer", "offer", "status", "start", "end"],
    defaultSort: "value",
  });

  const [data, trends] = await Promise.all([loadBilling(identity), loadMarketplaceTrends(identity, today)]);
  const canSync = can(identity.role, "marketplace:sync");
  const summary = billingSummary(data.charges, data.agreements, today);
  const feeCents = summary.totalRevenueCents - summary.payoutCents;
  const periods = revenueByPeriod(data.charges);

  const syncForm = canSync ? (
    <MutationForm action={syncBilling} submitLabel="Sync from AWS" successMessage="Billing synced." variant="secondary" />
  ) : null;

  const view = tableView(data.agreements, params, {
    search: (a) => `${a.customerIdentifier} ${a.offerType} ${a.status}`,
    comparators: {
      value: (a, b) => a.totalValue - b.totalValue,
      customer: (a, b) => a.customerIdentifier.localeCompare(b.customerIdentifier),
      offer: (a, b) => (a.offerType || "").localeCompare(b.offerType || ""),
      status: (a, b) => (a.status || "").localeCompare(b.status || ""),
      start: (a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""),
      end: (a, b) => (a.endDate ?? "9999-12-31").localeCompare(b.endDate ?? "9999-12-31"),
    },
  });
  const totalPages = pageCount(view.total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/marketplace/billing", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "asc" ? "desc" : "asc",
      }),
  };

  const agreementColumns: ReadonlyArray<Column<AgreementItem>> = [
    {
      key: "customer",
      header: "Customer",
      sortKey: "customer",
      render: (a) => (
        <Link href={`/marketplace/billing/${a.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
          {a.customerIdentifier || "Agreement"}
        </Link>
      ),
    },
    { key: "offer", header: "Offer", sortKey: "offer", render: (a) => a.offerType || "—" },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (a) => (
        <Badge tone={isActiveAgreement(a, today) ? "ok" : "neutral"}>{a.status || "Active"}</Badge>
      ),
    },
    { key: "start", header: "Start", sortKey: "start", render: (a) => a.startDate ?? "—" },
    { key: "end", header: "End", sortKey: "end", render: (a) => a.endDate ?? "—" },
    { key: "value", header: "TCV", align: "right", sortKey: "value", render: (a) => money(a.totalValue) },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Billing"
        subtitle="Agreements and charges from AWS Marketplace, with estimated payout after the listing fee."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href="/marketplace/billing/export"
              prefetch={false}
              style={{ fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)" }}
            >
              Export CSV
            </Link>
            {syncForm}
          </div>
        }
      />
      <MarketplaceNav />

      <MarketplaceHero
        ring={{
          value: data.agreements.length ? Math.round((summary.activeAgreements / data.agreements.length) * 100) : 0,
          caption: "active",
        }}
        cards={[
          { label: "Total revenue", value: money(summary.totalRevenueCents), tint: "accent", trend: trends.revenue },
          { label: "MRR", value: money(summary.mrrCents), trend: trends.mrr },
          { label: "ARR", value: money(summary.arrCents) },
          { label: `Est. payout (−${Math.round(LISTING_FEE_RATE * 100)}%)`, value: money(summary.payoutCents), tone: "ok" },
          { label: "Active agreements", value: String(summary.activeAgreements) },
        ]}
      />

      <Panel title="Revenue waterfall" accent="var(--section-accent)">
        <BarChart
          data={[
            { label: "Gross revenue", value: summary.totalRevenueCents, display: money(summary.totalRevenueCents) },
            { label: `AWS listing fee (${Math.round(LISTING_FEE_RATE * 100)}%)`, value: feeCents, display: `−${money(feeCents)}` },
            { label: "Net payout", value: summary.payoutCents, display: money(summary.payoutCents) },
          ]}
          formatValue={money}
        />
      </Panel>

      {periods.length > 0 && (
        <Panel title="Revenue by billing period" accent="var(--section-accent)">
          <BarChart
            data={periods.map((p) => ({ label: p.period, value: p.amountCents, display: money(p.amountCents) }))}
            formatValue={money}
          />
        </Panel>
      )}

      <SavedViewsBar listKey="marketplace-billing" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Agreements (${view.total})`}
        accent="var(--section-accent)"
        actions={<SearchForm q={params.q} placeholder="Search agreements…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <Table
          columns={agreementColumns}
          rows={view.rows}
          rowKey={(a) => a.id}
          sort={sortState}
          rowStyle={(a) =>
            isActiveAgreement(a, today) ? undefined : { background: "color-mix(in srgb, var(--text) 4%, transparent)" }
          }
          empty={
            data.agreements.length === 0 ? (
              <EmptyState
                title="No agreements"
                hint="Agreements appear here once customers purchase on AWS Marketplace. Sync to pull them."
                action={syncForm}
              />
            ) : params.q ? (
              `No agreements match “${params.q}”.`
            ) : (
              "No agreements."
            )
          }
        />
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={view.total}
          prevHref={listHref("/marketplace/billing", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/marketplace/billing", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
