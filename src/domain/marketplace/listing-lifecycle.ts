/**
 * Pure listing publish lifecycle: Draft -> Publishing (a Catalog change set is in flight) ->
 * Published. Mirrors the MDF `lifecycleSteps` shape so the UI stepper renders identically.
 * An archived listing has completed the path (the status Badge conveys the de-listing), so it
 * reads the same as Published. No DB, no clock — deterministic and unit-testable.
 */
import type { MarketplaceListingStatusId } from "@/domain/marketplace/catalog";

export type ListingStepState = "done" | "current" | "upcoming";

export interface ListingStep {
  readonly key: string;
  readonly label: string;
  readonly state: ListingStepState;
}

const STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "changing", label: "Publishing" },
  { key: "published", label: "Published" },
];

export function listingLifecycleSteps(status: MarketplaceListingStatusId): ListingStep[] {
  const currentIdx = status === "draft" ? 0 : status === "changing" ? 1 : 2; // published/archived => 2
  return STEPS.map((s, idx) => ({
    key: s.key,
    label: s.label,
    state: idx < currentIdx ? "done" : idx === currentIdx ? "current" : "upcoming",
  }));
}
