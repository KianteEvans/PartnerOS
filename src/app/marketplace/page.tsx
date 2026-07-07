import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { Table, type Column } from "@/components/ui/Table";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout } from "@/components/ui/Callout";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { SearchForm } from "@/components/ui/SearchForm";
import { Pagination } from "@/components/ui/Pagination";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { SyncStatusStrip } from "@/components/ui/SyncStatusStrip";
import { connectorHealth, type ConnectorStatus } from "@/domain/settings/connectors";
import {
  loadListings,
  loadMarketplaceConnState,
  loadMarketplaceTrends,
  type ListingListItem,
} from "@/domain/marketplace/load";
import { createListing, syncListings } from "@/domain/marketplace/actions";
import {
  PRODUCT_TYPE_LABELS,
  VISIBILITY_LABELS,
  LISTING_STATUS_LABELS,
  PRODUCT_TYPE_OPTIONS,
  listingStatusTone,
} from "@/domain/marketplace/catalog";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { listingView, LISTING_SORT_KEYS } from "@/domain/marketplace/listing-view";
import { formLabel as labelStyle, formControl as control } from "@/components/ui/form-styles";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;

  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  const params = parseListParams(await searchParams, {
    sortable: [...LISTING_SORT_KEYS],
    defaultSort: "title",
    defaultDir: "asc",
  });
  const [listings, conn, trends] = await Promise.all([
    loadListings(identity),
    loadMarketplaceConnState(identity),
    loadMarketplaceTrends(identity, today),
  ]);
  const canManage = can(identity.role, "marketplace:create");

  const published = listings.filter((l) => l.status === "published").length;
  const drafts = listings.filter((l) => l.status === "draft").length;
  const dimensions = listings.reduce((s, l) => s + l.dimensionCount, 0);

  const view = listingView(listings, params);
  const totalPages = pageCount(view.total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/marketplace", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "asc" ? "desc" : "asc",
      }),
  };

  const createDrawer = canManage ? (
    <FormDrawer triggerLabel="New listing" title="Create a draft listing" action={createListing} submitLabel="Create draft">
      <label style={labelStyle}>
        Product title
        <input name="title" required maxLength={200} style={control} placeholder="Acme Analytics" />
      </label>
      <label style={labelStyle}>
        Product type
        <select name="productType" defaultValue="saas" style={control}>
          {PRODUCT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Short description
        <textarea name="description" rows={3} maxLength={4000} style={control} />
      </label>
    </FormDrawer>
  ) : null;

  const syncForm = canManage ? (
    <MutationForm action={syncListings} submitLabel="Sync from AWS" successMessage="Synced from AWS Marketplace." variant="secondary" />
  ) : null;

  const columns: ReadonlyArray<Column<ListingListItem>> = [
    {
      key: "title",
      header: "Listing",
      sortKey: "title",
      render: (r) => (
        <Link href={`/marketplace/${r.id}`} style={{ color: "var(--text)", fontWeight: 600 }}>
          {r.title}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortKey: "type",
      render: (r) => <Badge tone="neutral">{PRODUCT_TYPE_LABELS[r.productType]}</Badge>,
    },
    { key: "visibility", header: "Visibility", sortKey: "visibility", render: (r) => VISIBILITY_LABELS[r.visibility] },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (r) => <Badge tone={listingStatusTone(r.status)}>{LISTING_STATUS_LABELS[r.status]}</Badge>,
    },
    { key: "dims", header: "Dimensions", align: "right", sortKey: "dims", render: (r) => String(r.dimensionCount) },
    {
      key: "synced",
      header: "Last synced",
      align: "right",
      sortKey: "synced",
      render: (r) => (r.lastSyncedAt ? r.lastSyncedAt.toISOString().slice(0, 10) : "—"),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="AWS Marketplace"
        subtitle="Your listings, metering, entitlements, billing, and attributed revenue. AWS is the source of truth."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            {syncForm}
            {createDrawer}
          </div>
        }
      />
      <MarketplaceNav />

      {!conn.enabled && (
        <Callout tone="info" title="Connect AWS Marketplace">
          Listings sync from the AWS Catalog API once you configure the connection in{" "}
          <Link href="/settings?section=integrations">Settings &rarr; Integrations</Link>. Until then you can draft
          listings locally; edits publish to AWS as change sets when connected.
        </Callout>
      )}
      {conn.status === "error" && conn.lastError && (
        <Callout tone="danger" title="Last sync failed">
          {conn.lastError}
        </Callout>
      )}

      {conn.enabled && (
        <SyncStatusStrip
          health={connectorHealth(
            {
              status: conn.status as ConnectorStatus,
              lastSyncDate: conn.lastSyncedAt ? conn.lastSyncedAt.toISOString().slice(0, 10) : null,
            },
            today,
          )}
          lastSyncedAtMs={conn.lastSyncedAt ? conn.lastSyncedAt.getTime() : null}
          nowMs={nowMs}
          rowCount={listings.length}
          rowNoun="listings"
          label="AWS Marketplace"
        />
      )}

      <MarketplaceHero
        ring={{
          value: listings.length ? Math.round((published / listings.length) * 100) : 0,
          caption: "published",
        }}
        cards={[
          { label: "Listings", value: String(listings.length), trend: trends.listings },
          { label: "Published", value: String(published), tone: "ok", trend: trends.published },
          { label: "Drafts", value: String(drafts), tone: drafts > 0 ? "warn" : "neutral" },
          { label: "Pricing dimensions", value: String(dimensions) },
        ]}
      />

      <SavedViewsBar listKey="marketplace-listings" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Listings (${view.total})`}
        accent="var(--section-accent)"
        actions={<SearchForm q={params.q} placeholder="Search listings…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <Table
          columns={columns}
          rows={view.rows}
          rowKey={(r) => r.id}
          sort={sortState}
          rowStyle={(r) =>
            r.status === "draft" ? { background: "color-mix(in srgb, var(--warn) 8%, transparent)" } : undefined
          }
          empty={
            listings.length === 0 ? (
              <EmptyState
                title="No listings yet"
                hint="Sync from AWS Marketplace to pull your catalog, or draft a new listing to get started."
                action={createDrawer}
              />
            ) : params.q ? (
              `No listings match “${params.q}”.`
            ) : (
              "No listings."
            )
          }
        />
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={view.total}
          prevHref={listHref("/marketplace", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/marketplace", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
