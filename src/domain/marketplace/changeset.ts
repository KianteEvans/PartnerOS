import type { MarketplaceChangeStatusId } from "@/domain/marketplace/mapping";
import {
  CHANGE_INTENT_LABELS,
  type MarketplaceChangeIntentId,
  type MarketplaceListingStatusId,
} from "@/domain/marketplace/catalog";

/**
 * Pure AWS Marketplace Catalog ChangeSet logic: whether a listing is publishable, the
 * status lifecycle of an in-flight change set, and building the ChangeSet "Details"
 * documents the connector hands to StartChangeSet. No DB, no clock, no SDK -- deterministic
 * and unit-testable. AWS owns the catalog; these helpers decide what we ask AWS to change.
 */

export interface ListingLike {
  readonly title: string;
  readonly description: string;
  readonly status: MarketplaceListingStatusId;
}

export interface DimensionLike {
  readonly apiName: string;
  readonly name: string;
  readonly price: number; // integer cents
}

export interface PublishCheck {
  readonly ready: boolean;
  readonly issues: readonly string[];
}

/**
 * AWS will not publish a product without a title, a description, and at least one priced
 * dimension. We gate StartChangeSet(Publish) on the same rules so the user gets the failure
 * up front instead of an async change-set rejection.
 */
export function publishReadiness(
  listing: ListingLike,
  dimensions: readonly DimensionLike[],
): PublishCheck {
  const issues: string[] = [];
  if (!listing.title.trim()) issues.push("A product title is required.");
  if (!listing.description.trim()) issues.push("A product description is required.");
  if (dimensions.length === 0) issues.push("At least one pricing dimension is required.");
  if (dimensions.some((d) => d.price < 0)) issues.push("Pricing dimensions cannot be negative.");
  if (listing.status === "published") issues.push("This listing is already published.");
  if (listing.status === "changing") issues.push("A change set is already in progress.");
  return { ready: issues.length === 0, issues };
}

export function isTerminalChangeStatus(status: MarketplaceChangeStatusId): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function isInFlightChangeStatus(status: MarketplaceChangeStatusId): boolean {
  return status === "preparing" || status === "applying";
}

/** A listing can be edited only when no change set is being applied to it. */
export function canEditListing(status: MarketplaceListingStatusId): boolean {
  return status !== "changing";
}

/** The AWS ChangeType string for a given local intent. */
export function awsChangeType(intent: MarketplaceChangeIntentId): string {
  switch (intent) {
    case "create":
      return "CreateProduct";
    case "update_details":
      return "UpdateInformation";
    case "add_dimension":
    case "update_dimension":
      return "UpdateDeliveryOptions";
    case "update_visibility":
      return "UpdateVisibility";
    case "publish":
      return "ReleaseProduct";
  }
}

/** Human-readable one-line summary of a change set for the history list. */
export function changeSummary(intent: MarketplaceChangeIntentId, payload: Record<string, unknown>): string {
  const label = CHANGE_INTENT_LABELS[intent];
  if (intent === "update_visibility" && typeof payload.visibility === "string") {
    return `${label} -> ${payload.visibility}`;
  }
  if ((intent === "add_dimension" || intent === "update_dimension") && typeof payload.name === "string") {
    return `${label}: ${payload.name}`;
  }
  if (intent === "update_details" && typeof payload.title === "string") {
    return `${label}: ${payload.title}`;
  }
  return label;
}

/**
 * Build the JSON "Details" document for a change. AWS validates these server-side; here we
 * produce a faithful, well-formed document the connector passes straight to StartChangeSet.
 */
export function buildChangeDetails(
  intent: MarketplaceChangeIntentId,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify(payload);
}
