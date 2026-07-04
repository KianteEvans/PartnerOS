/**
 * Pure AWS-Marketplace mapping. Converts the shapes returned by the Catalog / Entitlement /
 * Agreement / Metering APIs into the local mirror-row shapes, and normalizes AWS vocabularies
 * (product type, visibility, metering + change-set status) to our enums. No SDK imports and
 * no DB -- the input interfaces are minimal structural subsets of the SDK types, so the
 * connector can pass raw SDK objects straight in and this stays fully unit-testable. This is
 * the only connector logic exercised without live AWS credentials.
 */

export type MarketplaceProductTypeId =
  | "saas"
  | "ami"
  | "container"
  | "machine_learning"
  | "professional_services";
export type MarketplaceVisibilityId = "limited" | "public" | "restricted";
export type MarketplaceChangeStatusId =
  | "preparing"
  | "applying"
  | "succeeded"
  | "failed"
  | "cancelled";
export type MarketplaceMeteringStatusId = "pending" | "accepted" | "rejected";

// ---- minimal structural subsets of the SDK shapes (no SDK import) ----

// `| undefined` on every optional field so the raw SDK shapes (which use
// `field?: T | undefined`) are assignable under exactOptionalPropertyTypes.
export interface ListingEntityLike {
  readonly Name?: string | undefined;
  readonly EntityType?: string | undefined;
  readonly EntityId?: string | undefined;
  readonly Visibility?: string | undefined;
}

export interface EntitlementValueLike {
  readonly IntegerValue?: number | undefined;
  readonly DoubleValue?: number | undefined;
  readonly BooleanValue?: boolean | undefined;
  readonly StringValue?: string | undefined;
}
export interface EntitlementLike {
  readonly ProductCode?: string | undefined;
  readonly Dimension?: string | undefined;
  readonly CustomerIdentifier?: string | undefined;
  readonly Value?: EntitlementValueLike | undefined;
  readonly ExpirationDate?: Date | undefined;
}

export interface AgreementSummaryLike {
  readonly agreementId?: string | undefined;
  readonly acceptanceTime?: Date | undefined;
  readonly startTime?: Date | undefined;
  readonly endTime?: Date | undefined;
  readonly agreementType?: string | undefined;
  readonly status?: string | undefined;
  readonly acceptor?: { readonly accountId?: string | undefined } | undefined;
}

export interface UsageResultLike {
  readonly MeteringRecordId?: string | undefined;
  readonly Status?: string | undefined;
  readonly UsageRecord?:
    | {
        readonly Dimension?: string | undefined;
        readonly CustomerIdentifier?: string | undefined;
        readonly Quantity?: number | undefined;
      }
    | undefined;
}

// ---- output row shapes ----

export interface ListingRow {
  readonly entityId: string;
  readonly title: string;
  readonly productType: MarketplaceProductTypeId;
  readonly visibility: MarketplaceVisibilityId;
}
export interface EntitlementRow {
  readonly entitlementRef: string;
  readonly productCode: string;
  readonly customerIdentifier: string;
  readonly dimension: string;
  readonly value: number;
  readonly expirationDate: string | null;
}
export interface AgreementRow {
  readonly agreementId: string;
  readonly customerIdentifier: string;
  readonly offerType: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly acceptanceTime: Date | null;
}
export interface MeteringResultRow {
  readonly meteringRecordId: string;
  readonly status: Exclude<MarketplaceMeteringStatusId, "pending">;
  readonly dimension: string;
  readonly customerIdentifier: string;
  readonly quantity: number;
}

// ---- normalizers ----

const ENTITY_TYPE_TO_PRODUCT: Record<string, MarketplaceProductTypeId> = {
  SaaSProduct: "saas",
  AmiProduct: "ami",
  ContainerProduct: "container",
  MachineLearningProduct: "machine_learning",
  ProfessionalServicesProduct: "professional_services",
};

export function productTypeFromEntityType(entityType: string | undefined): MarketplaceProductTypeId {
  return ENTITY_TYPE_TO_PRODUCT[entityType ?? ""] ?? "saas";
}

export function visibilityFromAws(visibility: string | undefined): MarketplaceVisibilityId {
  switch ((visibility ?? "").toLowerCase()) {
    case "public":
      return "public";
    case "restricted":
      return "restricted";
    default:
      return "limited";
  }
}

export function changeStatusFromAws(status: string | undefined): MarketplaceChangeStatusId {
  switch ((status ?? "").toUpperCase()) {
    case "PREPARING":
      return "preparing";
    case "APPLYING":
      return "applying";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "applying";
  }
}

/** AWS BatchMeterUsage statuses: "Success" => accepted; anything else => rejected. */
export function meteringStatusFromAws(status: string | undefined): "accepted" | "rejected" {
  return (status ?? "").toLowerCase() === "success" ? "accepted" : "rejected";
}

export function entitlementValueToInt(value: EntitlementValueLike | undefined): number {
  if (!value) return 0;
  if (typeof value.IntegerValue === "number") return value.IntegerValue;
  if (typeof value.DoubleValue === "number") return Math.round(value.DoubleValue);
  if (typeof value.BooleanValue === "boolean") return value.BooleanValue ? 1 : 0;
  if (typeof value.StringValue === "string") {
    const n = parseInt(value.StringValue, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** ISO calendar date (YYYY-MM-DD) for a Date, or null. */
export function toIsoDate(d: Date | undefined | null): string | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString().slice(0, 10) : null;
}

/** Stable idempotency key for an entitlement (the Entitlement API has no id). */
export function synthEntitlementRef(productCode: string, customer: string, dimension: string): string {
  return `${productCode}:${customer}:${dimension}`;
}

/** Stable idempotency key for an attributed-revenue row. */
export function synthAttributionRef(
  listingEntityId: string,
  service: string,
  period: string,
  method: string,
): string {
  return `${listingEntityId}:${service}:${period}:${method}`;
}

// ---- mappers ----

export function mapEntityToListing(entity: ListingEntityLike): ListingRow | null {
  const entityId = entity.EntityId ?? "";
  if (!entityId) return null;
  return {
    entityId,
    title: entity.Name ?? entityId,
    productType: productTypeFromEntityType(entity.EntityType),
    visibility: visibilityFromAws(entity.Visibility),
  };
}

export function mapEntitlement(e: EntitlementLike): EntitlementRow | null {
  const productCode = e.ProductCode ?? "";
  const customerIdentifier = e.CustomerIdentifier ?? "";
  const dimension = e.Dimension ?? "";
  if (!productCode || !customerIdentifier || !dimension) return null;
  return {
    entitlementRef: synthEntitlementRef(productCode, customerIdentifier, dimension),
    productCode,
    customerIdentifier,
    dimension,
    value: entitlementValueToInt(e.Value),
    expirationDate: toIsoDate(e.ExpirationDate),
  };
}

export function mapAgreement(s: AgreementSummaryLike): AgreementRow | null {
  const agreementId = s.agreementId ?? "";
  if (!agreementId) return null;
  return {
    agreementId,
    customerIdentifier: s.acceptor?.accountId ?? "",
    offerType: s.agreementType ?? "",
    status: s.status ?? "",
    startDate: toIsoDate(s.startTime),
    endDate: toIsoDate(s.endTime),
    acceptanceTime: s.acceptanceTime ?? null,
  };
}

export function mapUsageResult(r: UsageResultLike): MeteringResultRow {
  return {
    meteringRecordId: r.MeteringRecordId ?? "",
    status: meteringStatusFromAws(r.Status),
    dimension: r.UsageRecord?.Dimension ?? "",
    customerIdentifier: r.UsageRecord?.CustomerIdentifier ?? "",
    quantity: r.UsageRecord?.Quantity ?? 0,
  };
}
