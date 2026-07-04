import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { BarChart } from "@/components/ui/BarChart";
import { Table, type Column } from "@/components/ui/Table";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchForm } from "@/components/ui/SearchForm";
import { Pagination } from "@/components/ui/Pagination";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { loadMetering, loadMarketplaceTrends, type MeteringRecordItem } from "@/domain/marketplace/load";
import { meteringSummary, usageByDimension } from "@/domain/marketplace/metering";
import { submitMetering, resubmitMetering } from "@/domain/marketplace/actions";
import { METERING_STATUS_LABELS, meteringStatusTone } from "@/domain/marketplace/catalog";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/marketplace/table-view";
import { moneyFromCents as money } from "@/domain/format";
import { formLabel as labelStyle, formControl as control } from "@/components/ui/form-styles";


const METERING_SORT_KEYS = ["when", "listing", "dimension", "customer", "quantity", "status"] as const;
const meteringComparators: Record<string, (a: MeteringRecordItem, b: MeteringRecordItem) => number> = {
  when: (a, b) => a.usageTimestamp.getTime() - b.usageTimestamp.getTime(),
  listing: (a, b) => a.listingTitle.localeCompare(b.listingTitle),
  dimension: (a, b) => a.dimension.localeCompare(b.dimension),
  customer: (a, b) => a.customerIdentifier.localeCompare(b.customerIdentifier),
  quantity: (a, b) => a.quantity - b.quantity,
  status: (a, b) => a.status.localeCompare(b.status),
};

export default async function MeteringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const today = new Date().toISOString().slice(0, 10);
  const params = parseListParams(await searchParams, { sortable: [...METERING_SORT_KEYS], defaultSort: "when" });
  const [data, trends] = await Promise.all([loadMetering(identity), loadMarketplaceTrends(identity, today)]);
  const canSubmit = can(identity.role, "marketplace:update") && data.listings.length > 0;
  const summary = meteringSummary(data.records, data.prices);
  const byDim = usageByDimension(data.records, data.prices);

  const view = tableView(data.records, params, {
    search: (r) => `${r.listingTitle} ${r.customerIdentifier} ${r.dimension}`,
    comparators: meteringComparators,
  });
  const totalPages = pageCount(view.total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/marketplace/metering", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "asc" ? "desc" : "asc",
      }),
  };

  const submitDrawer = canSubmit ? (
    <FormDrawer triggerLabel="Submit usage" title="Submit a usage record" action={submitMetering} submitLabel="Submit to AWS">
      <label style={labelStyle}>
        Listing
        <select name="listingId" required style={control}>
          {data.listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Dimension (API name)
        <input name="dimension" required maxLength={120} style={control} placeholder="users" />
      </label>
      <label style={labelStyle}>
        Customer identifier
        <input name="customerIdentifier" maxLength={120} style={control} placeholder="cust-abc123" />
      </label>
      <label style={labelStyle}>
        Quantity
        <input name="quantity" type="number" min="0" step="1" required style={control} placeholder="10" />
      </label>
    </FormDrawer>
  ) : null;

  // Rejected records that have not already been retried can be bulk-resubmitted.
  const eligible = (r: MeteringRecordItem): boolean => r.status === "rejected" && r.result !== "Resubmitted";
  const eligibleIds = data.records.filter(eligible).map((r) => r.id);
  const showBulk = canSubmit && eligibleIds.length > 0;

  const columns: ReadonlyArray<Column<MeteringRecordItem>> = [
    ...(showBulk
      ? [
          {
            key: "select",
            header: "",
            render: (r: MeteringRecordItem) => (eligible(r) ? <BulkCheckbox id={r.id} /> : null),
          } satisfies Column<MeteringRecordItem>,
        ]
      : []),
    { key: "listing", header: "Listing", sortKey: "listing", render: (r) => r.listingTitle },
    {
      key: "dimension",
      header: "Dimension",
      sortKey: "dimension",
      render: (r) => <code style={{ fontSize: 12 }}>{r.dimension}</code>,
    },
    { key: "customer", header: "Customer", sortKey: "customer", render: (r) => r.customerIdentifier || "—" },
    { key: "quantity", header: "Qty", align: "right", sortKey: "quantity", render: (r) => String(r.quantity) },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Badge tone={meteringStatusTone(r.status)}>{METERING_STATUS_LABELS[r.status]}</Badge>
          {r.result === "Resubmitted" && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>retried</span>
          )}
        </span>
      ),
    },
    {
      key: "when",
      header: "Submitted",
      align: "right",
      sortKey: "when",
      render: (r) => r.usageTimestamp.toISOString().slice(0, 10),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Metering"
        subtitle="Usage submitted to AWS Marketplace (BatchMeterUsage) and its accepted / rejected result."
        actions={submitDrawer}
      />
      <MarketplaceNav />

      <MarketplaceHero
        ring={{ value: summary.total ? Math.round((summary.accepted / summary.total) * 100) : 0, caption: "accepted" }}
        cards={[
          { label: "Records", value: String(summary.total) },
          { label: "Accepted", value: String(summary.accepted), tone: "ok" },
          { label: "Rejected", value: String(summary.rejected), tone: summary.rejected > 0 ? "danger" : "neutral" },
          { label: "Projected charge", value: money(summary.projectedChargeCents), tint: "accent", trend: trends.meteredUsage },
        ]}
      />

      {byDim.length > 0 && (
        <Panel title="Usage by dimension" accent="var(--section-accent)">
          <BarChart
            data={byDim.map((d) => ({ label: d.dimension, value: d.quantity, display: `${d.quantity} (${money(d.chargeCents)})` }))}
          />
        </Panel>
      )}

      <SavedViewsBar listKey="marketplace-metering" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Metering records (${view.total})`}
        accent="var(--section-accent)"
        actions={<SearchForm q={params.q} placeholder="Search records…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <BulkProvider allIds={eligibleIds}>
          <Table
            columns={columns}
            rows={view.rows}
            rowKey={(r) => r.id}
            sort={sortState}
            rowStyle={(r) =>
              r.status === "rejected" ? { background: "color-mix(in srgb, var(--danger) 8%, transparent)" } : undefined
            }
            empty={
              data.records.length === 0 ? (
                <EmptyState
                  title="No usage submitted"
                  hint="Submit a usage record to meter a customer's consumption against a listing dimension."
                  action={submitDrawer}
                />
              ) : params.q ? (
                `No records match “${params.q}”.`
              ) : (
                "No records."
              )
            }
          />
          {showBulk && (
            <BulkBar>
              <BulkActionForm
                action={resubmitMetering}
                submitLabel="Resubmit to AWS"
                successMessage="Rejected records resubmitted."
              />
            </BulkBar>
          )}
        </BulkProvider>
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={view.total}
          prevHref={listHref("/marketplace/metering", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/marketplace/metering", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
