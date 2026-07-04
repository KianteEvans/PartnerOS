import {
  MarketplaceCatalogClient,
  ListEntitiesCommand,
  DescribeEntityCommand,
  StartChangeSetCommand,
  DescribeChangeSetCommand,
  type EntitySummary,
} from "@aws-sdk/client-marketplace-catalog";
import {
  MarketplaceMeteringClient,
  BatchMeterUsageCommand,
  ResolveCustomerCommand,
  type UsageRecord,
  type UsageRecordResult,
} from "@aws-sdk/client-marketplace-metering";
import {
  MarketplaceEntitlementServiceClient,
  GetEntitlementsCommand,
  type Entitlement,
} from "@aws-sdk/client-marketplace-entitlement-service";
import {
  MarketplaceAgreementClient,
  SearchAgreementsCommand,
  ListAgreementChargesCommand,
  type AgreementViewSummary,
} from "@aws-sdk/client-marketplace-agreement";
import {
  MarketplaceReportingClient,
  GetBuyerDashboardCommand,
} from "@aws-sdk/client-marketplace-reporting";
import { assumeTenantRole } from "@/aws/assume-role";

/**
 * Server-only AWS Marketplace clients. AWS is the source of truth for Marketplace data;
 * these functions read the canonical state (Catalog entities, Entitlements, Agreements +
 * charges, the buyer dashboard) and write listing edits through to AWS via Catalog
 * ChangeSets / submit metering. Each assumes the tenant's cross-account role (shared
 * STS helper) for short-lived credentials, then calls the requested API with bounded
 * pagination. Never imported by client code; only the role ARN + external id are stored.
 *
 * No live AWS credentials exist in dev, so (like the Partner Central connector) these
 * paths are wired but exercised end-to-end only against real AWS; the pure row mappers
 * in src/domain/marketplace/mapping.ts carry the unit-tested logic.
 */

export interface MarketplaceConfig {
  readonly tenantId: string;
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
  readonly catalog: string; // "AWSMarketplace"
  readonly sellerId: string;
}

const MAX_PAGES = 10;

/** Catalog entity types we manage as listings. */
export const MARKETPLACE_ENTITY_TYPES = [
  "SaaSProduct",
  "AmiProduct",
  "ContainerProduct",
  "MachineLearningProduct",
  "ProfessionalServicesProduct",
] as const;

function catalogClient(cfg: MarketplaceConfig, credentials: Awaited<ReturnType<typeof assumeTenantRole>>) {
  return new MarketplaceCatalogClient({ region: cfg.region, credentials });
}

/** List the seller's Catalog entities across every product type (paginated, bounded). */
export async function listMarketplaceEntities(cfg: MarketplaceConfig): Promise<EntitySummary[]> {
  const credentials = await assumeTenantRole(cfg);
  const client = catalogClient(cfg, credentials);
  const out: EntitySummary[] = [];
  for (const entityType of MARKETPLACE_ENTITY_TYPES) {
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.send(
        new ListEntitiesCommand({
          Catalog: cfg.catalog,
          EntityType: entityType,
          MaxResults: 50,
          NextToken: nextToken,
        }),
      );
      out.push(...(res.EntitySummaryList ?? []));
      nextToken = res.NextToken;
      if (!nextToken) break;
    }
  }
  return out;
}

/** Full entity detail (DescribeEntity) -- the JSON details document for one listing. */
export async function describeMarketplaceEntity(
  cfg: MarketplaceConfig,
  entityId: string,
): Promise<{ details: string; entityType: string }> {
  const credentials = await assumeTenantRole(cfg);
  const client = catalogClient(cfg, credentials);
  const res = await client.send(new DescribeEntityCommand({ Catalog: cfg.catalog, EntityId: entityId }));
  return { details: res.Details ?? "", entityType: res.EntityType ?? "" };
}

export interface ChangeSetChange {
  readonly changeType: string;
  readonly entityType: string;
  readonly entityIdentifier?: string;
  readonly details: string; // JSON document
}

/** Start a Catalog ChangeSet (the write-through path for create/edit/publish). */
export async function startMarketplaceChangeSet(
  cfg: MarketplaceConfig,
  name: string,
  changes: readonly ChangeSetChange[],
): Promise<{ changeSetId: string; changeSetArn: string }> {
  const credentials = await assumeTenantRole(cfg);
  const client = catalogClient(cfg, credentials);
  const res = await client.send(
    new StartChangeSetCommand({
      Catalog: cfg.catalog,
      ChangeSetName: name.slice(0, 100),
      ChangeSet: changes.map((c) => ({
        ChangeType: c.changeType,
        Entity: { Type: c.entityType, Identifier: c.entityIdentifier },
        Details: c.details,
      })),
    }),
  );
  return { changeSetId: res.ChangeSetId ?? "", changeSetArn: res.ChangeSetArn ?? "" };
}

/** Poll a ChangeSet's status (PREPARING / APPLYING / SUCCEEDED / FAILED / CANCELLED). */
export async function describeMarketplaceChangeSet(
  cfg: MarketplaceConfig,
  changeSetId: string,
): Promise<{ status: string; failureCode: string; failureDescription: string }> {
  const credentials = await assumeTenantRole(cfg);
  const client = catalogClient(cfg, credentials);
  const res = await client.send(
    new DescribeChangeSetCommand({ Catalog: cfg.catalog, ChangeSetId: changeSetId }),
  );
  const firstError = (res.ChangeSet ?? [])
    .flatMap((c) => c.ErrorDetailList ?? [])
    .find((e) => e.ErrorMessage);
  return {
    status: res.Status ?? "",
    failureCode: res.FailureCode ?? "",
    failureDescription: firstError?.ErrorMessage ?? res.FailureDescription ?? "",
  };
}

/** Submit usage to AWS (BatchMeterUsage). Returns the per-record accepted/rejected results. */
export async function batchMeterMarketplaceUsage(
  cfg: MarketplaceConfig,
  productCode: string,
  records: readonly UsageRecord[],
): Promise<{ results: UsageRecordResult[]; unprocessed: UsageRecord[] }> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceMeteringClient({ region: cfg.region, credentials });
  const res = await client.send(
    new BatchMeterUsageCommand({ ProductCode: productCode, UsageRecords: records as UsageRecord[] }),
  );
  return { results: res.Results ?? [], unprocessed: res.UnprocessedRecords ?? [] };
}

/** Map a registration token to a customer identifier + product code (ResolveCustomer). */
export async function resolveMarketplaceCustomer(
  cfg: MarketplaceConfig,
  registrationToken: string,
): Promise<{ customerIdentifier: string; customerAwsAccountId: string; productCode: string }> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceMeteringClient({ region: cfg.region, credentials });
  const res = await client.send(new ResolveCustomerCommand({ RegistrationToken: registrationToken }));
  return {
    customerIdentifier: res.CustomerIdentifier ?? "",
    customerAwsAccountId: res.CustomerAWSAccountId ?? "",
    productCode: res.ProductCode ?? "",
  };
}

/** Read active entitlements for a product (GetEntitlements, paginated, bounded). */
export async function getMarketplaceEntitlements(
  cfg: MarketplaceConfig,
  productCode: string,
): Promise<Entitlement[]> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceEntitlementServiceClient({ region: cfg.region, credentials });
  const out: Entitlement[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.send(
      new GetEntitlementsCommand({ ProductCode: productCode, MaxResults: 25, NextToken: nextToken }),
    );
    out.push(...(res.Entitlements ?? []));
    nextToken = res.NextToken;
    if (!nextToken) break;
  }
  return out;
}

/** Search the seller's agreements (SearchAgreements, paginated, bounded). */
export async function searchMarketplaceAgreements(
  cfg: MarketplaceConfig,
): Promise<AgreementViewSummary[]> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceAgreementClient({ region: cfg.region, credentials });
  const out: AgreementViewSummary[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.send(
      new SearchAgreementsCommand({
        catalog: cfg.catalog,
        maxResults: 25,
        nextToken,
      }),
    );
    out.push(...(res.agreementViewSummaries ?? []));
    nextToken = res.nextToken;
    if (!nextToken) break;
  }
  return out;
}

export interface AgreementChargeRow {
  readonly chargeId: string;
  readonly agreementId: string;
  readonly currencyCode: string;
  readonly amountCents: number;
  readonly time: string; // ISO date (YYYY-MM-DD) or ""
}

/** List the charges for one agreement (ListAgreementCharges). Amount to integer cents. */
export async function listMarketplaceAgreementCharges(
  cfg: MarketplaceConfig,
  agreementId: string,
): Promise<AgreementChargeRow[]> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceAgreementClient({ region: cfg.region, credentials });
  const out: AgreementChargeRow[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.send(
      new ListAgreementChargesCommand({ agreementId, maxResults: 25, nextToken }),
    );
    for (const c of res.items ?? []) {
      const dollars = Number(c.amount ?? "0");
      out.push({
        chargeId: c.id ?? "",
        agreementId: c.agreementId ?? agreementId,
        currencyCode: c.currencyCode ?? "USD",
        amountCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
        time: c.time ? c.time.toISOString().slice(0, 10) : "",
      });
    }
    nextToken = res.nextToken;
    if (!nextToken) break;
  }
  return out;
}

/**
 * Fetch the attributed-revenue buyer dashboard (Reporting API). Best-effort: returns an
 * embed URL when available. The detailed attribution rows (by service x period) come from
 * the partner's Attributed Revenue export; this confirms the connector + dashboard access.
 */
export async function getMarketplaceBuyerDashboard(
  cfg: MarketplaceConfig,
  dashboardIdentifier: string,
): Promise<{ embedUrl: string }> {
  const credentials = await assumeTenantRole(cfg);
  const client = new MarketplaceReportingClient({ region: cfg.region, credentials });
  const res = await client.send(
    new GetBuyerDashboardCommand({ dashboardIdentifier, embeddingDomains: [] }),
  );
  return { embedUrl: res.embedUrl ?? "" };
}
