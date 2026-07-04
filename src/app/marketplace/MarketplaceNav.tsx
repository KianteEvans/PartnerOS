"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * AWS Marketplace section sub-nav across the five pillars. Listings is the root
 * (`/marketplace`), so a listing detail (`/marketplace/[id]`) keeps Listings lit;
 * the longer prefixes for the other tabs win when active.
 */
export function MarketplaceNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="Marketplace"
      tabs={[
        { key: "listings", label: "Listings", caption: "Products & editing", href: "/marketplace" },
        { key: "metering", label: "Metering", caption: "Usage submitted", href: "/marketplace/metering" },
        { key: "entitlements", label: "Entitlements", caption: "Customer rights", href: "/marketplace/entitlements" },
        { key: "billing", label: "Billing", caption: "Agreements & charges", href: "/marketplace/billing" },
        { key: "offers", label: "Offers", caption: "Co-sell private offers", href: "/marketplace/offers" },
        { key: "revenue", label: "Revenue", caption: "Attributed (PRM)", href: "/marketplace/revenue" },
        { key: "customers", label: "Customers", caption: "Accounts & usage", href: "/marketplace/customers" },
      ]}
    />
  );
}
