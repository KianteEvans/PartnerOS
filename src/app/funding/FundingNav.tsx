"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * AWS Funding sub-nav: browse the program catalog, match programs to a deal, and
 * track submissions through the application lifecycle.
 */
export function FundingNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="AWS Funding"
      tabs={[
        { key: "catalog", label: "Catalog", caption: "Programs", href: "/funding" },
        { key: "matcher", label: "Matcher", caption: "Fit to a deal", href: "/funding/eligibility" },
        { key: "submissions", label: "Submissions", caption: "Apply & track", href: "/funding/submissions" },
      ]}
    />
  );
}
