import type { Decision } from "@/domain/command/brief";
import type { CommandMarketplaceListing } from "@/domain/command/types";

/**
 * Pure marketplace decision signals for the Command Center + notification bell. Takes
 * per-listing rollups (the loader does the date math for entitlement expiry, so this is
 * clock-free) and emits the cross-section "needs attention" items: expiring/expired
 * customer entitlements, failed AWS Catalog change sets, and revenue gaps on published
 * listings (no accepted metering, or $0 attributed revenue). Deterministic + unit-testable.
 */
export function marketplaceDecisions(listings: readonly CommandMarketplaceListing[]): Decision[] {
  const out: Decision[] = [];
  for (const l of listings) {
    const plural = (n: number): string => (n === 1 ? "" : "s");

    // Customer entitlements lapsing — expired outranks expiring (one signal per listing).
    if (l.expiredEntitlements > 0) {
      out.push({
        id: `mp-ent-expired-${l.id}`,
        severity: "high",
        situation: "marketplace_entitlement",
        title: `Entitlement expired: ${l.title}`,
        detail: `${l.expiredEntitlements} customer entitlement${plural(l.expiredEntitlements)} expired — follow up to renew.`,
        ownerUserId: null,
        dueDate: null,
        link: "/marketplace/entitlements",
      });
    } else if (l.expiringEntitlements > 0) {
      out.push({
        id: `mp-ent-expiring-${l.id}`,
        severity: "medium",
        situation: "marketplace_entitlement",
        title: `Entitlement expiring: ${l.title}`,
        detail: `${l.expiringEntitlements} customer entitlement${plural(l.expiringEntitlements)} expiring within 30 days.`,
        ownerUserId: null,
        dueDate: null,
        link: "/marketplace/entitlements",
      });
    }

    // A Catalog change set failed on AWS — the edit didn't land; review and resubmit.
    if (l.failedChangeSets > 0) {
      out.push({
        id: `mp-cs-${l.id}`,
        severity: "high",
        situation: "marketplace_changeset",
        title: `Change set failed: ${l.title}`,
        detail: `${l.failedChangeSets} AWS Catalog change set${plural(l.failedChangeSets)} failed — review and resubmit.`,
        ownerUserId: null,
        dueDate: null,
        link: `/marketplace/${l.id}`,
      });
    }

    // Published-but-quiet: no metered usage and no attributed revenue mean the product
    // is live on AWS yet measuring nothing — surface both so they get wired up.
    if (l.published && l.acceptedUsageCount === 0) {
      out.push({
        id: `mp-meter-${l.id}`,
        severity: "medium",
        situation: "marketplace_revenue_gap",
        title: `No metered usage: ${l.title}`,
        detail: "Published listing has no accepted metering records — confirm usage is being submitted.",
        ownerUserId: null,
        dueDate: null,
        link: "/marketplace/metering",
      });
    }
    if (l.published && l.attributedRevenueCents === 0) {
      out.push({
        id: `mp-attr-${l.id}`,
        severity: "medium",
        situation: "marketplace_revenue_gap",
        title: `No attributed revenue: ${l.title}`,
        detail: "Published listing has $0 attributed revenue — enable an attribution method.",
        ownerUserId: null,
        dueDate: null,
        link: "/marketplace/revenue",
      });
    }
  }
  return out;
}
