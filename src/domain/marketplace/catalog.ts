import type {
  MarketplaceProductTypeId,
  MarketplaceVisibilityId,
  MarketplaceChangeStatusId,
  MarketplaceMeteringStatusId,
} from "@/domain/marketplace/mapping";

// Re-export the shared id types so other modules have a single import site.
export type {
  MarketplaceProductTypeId,
  MarketplaceVisibilityId,
  MarketplaceChangeStatusId,
  MarketplaceMeteringStatusId,
} from "@/domain/marketplace/mapping";

/**
 * Static AWS Marketplace vocabulary: labels for each enum, the dimension-unit options
 * offered in the pricing editor, and semantic tones for the status pills. Code (not tenant
 * data) and pure -- no DB, no React. Tones are plain string ids the UI maps to Badge tones.
 */

export type MarketplaceListingStatusId = "draft" | "published" | "changing" | "archived";
export type MarketplaceDimensionTypeId = "contract" | "usage";
export type MarketplaceChangeIntentId =
  | "create"
  | "update_details"
  | "add_dimension"
  | "update_dimension"
  | "update_visibility"
  | "publish";
export type MarketplaceAttributionMethodId =
  | "marketplace_metering"
  | "resource_tagging"
  | "user_agent";
export type MarketplaceAttributionStatusId = "configured" | "active" | "inactive";

export type ToneId = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

export const PRODUCT_TYPE_LABELS: Record<MarketplaceProductTypeId, string> = {
  saas: "SaaS",
  ami: "AMI",
  container: "Container",
  machine_learning: "Machine learning",
  professional_services: "Professional services",
};

export const VISIBILITY_LABELS: Record<MarketplaceVisibilityId, string> = {
  limited: "Limited",
  public: "Public",
  restricted: "Restricted",
};

export const LISTING_STATUS_LABELS: Record<MarketplaceListingStatusId, string> = {
  draft: "Draft",
  published: "Published",
  changing: "Change in progress",
  archived: "Archived",
};

export const DIMENSION_TYPE_LABELS: Record<MarketplaceDimensionTypeId, string> = {
  contract: "Contract",
  usage: "Usage",
};

export const CHANGE_INTENT_LABELS: Record<MarketplaceChangeIntentId, string> = {
  create: "Create product",
  update_details: "Update details",
  add_dimension: "Add pricing dimension",
  update_dimension: "Update pricing dimension",
  update_visibility: "Update visibility",
  publish: "Publish",
};

export const CHANGE_STATUS_LABELS: Record<MarketplaceChangeStatusId, string> = {
  preparing: "Preparing",
  applying: "Applying",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const METERING_STATUS_LABELS: Record<MarketplaceMeteringStatusId, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const ATTRIBUTION_METHOD_LABELS: Record<MarketplaceAttributionMethodId, string> = {
  marketplace_metering: "AWS Marketplace Metering",
  resource_tagging: "Resource Tagging",
  user_agent: "User Agent String",
};

export const ATTRIBUTION_STATUS_LABELS: Record<MarketplaceAttributionStatusId, string> = {
  configured: "Configured",
  active: "Active",
  inactive: "Inactive",
};

/** Common AWS Marketplace usage-dimension units offered in the pricing editor. */
export const DIMENSION_UNITS: readonly string[] = [
  "Users",
  "Hosts",
  "Requests",
  "GB",
  "GB-month",
  "Hours",
  "Units",
  "API calls",
];

export const PRODUCT_TYPE_OPTIONS: ReadonlyArray<{ value: MarketplaceProductTypeId; label: string }> =
  (Object.keys(PRODUCT_TYPE_LABELS) as MarketplaceProductTypeId[]).map((v) => ({
    value: v,
    label: PRODUCT_TYPE_LABELS[v],
  }));

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: MarketplaceVisibilityId; label: string }> = (
  Object.keys(VISIBILITY_LABELS) as MarketplaceVisibilityId[]
).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }));

export function listingStatusTone(status: MarketplaceListingStatusId): ToneId {
  switch (status) {
    case "published":
      return "ok";
    case "changing":
      return "info";
    case "archived":
      return "neutral";
    default:
      return "warn"; // draft
  }
}

export function changeStatusTone(status: MarketplaceChangeStatusId): ToneId {
  switch (status) {
    case "succeeded":
      return "ok";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "info"; // preparing / applying
  }
}

export function meteringStatusTone(status: MarketplaceMeteringStatusId): ToneId {
  switch (status) {
    case "accepted":
      return "ok";
    case "rejected":
      return "danger";
    default:
      return "warn"; // pending
  }
}
