"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * The lifecycle of earning + keeping AWS designations, rendered as the top-level
 * sub-nav of Program Management. Pursue (the competency portfolio) → Prove (the
 * Evidence Locker) → Submit (the self-assessment Applications) → Maintain (Solutions
 * / renewal), plus Advance (partner-tier progression — a workspace-level axis folded
 * into the same section). One section, five stages; built on the shared SectionTabs.
 */
export function LifecycleNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="Program Management"
      tabs={[
        { key: "pursue", label: "Pursue", caption: "Competencies", href: "/programs" },
        { key: "prove", label: "Prove", caption: "Evidence", href: "/programs/evidence" },
        { key: "submit", label: "Submit", caption: "Applications", href: "/programs/applications" },
        {
          key: "maintain",
          label: "Maintain",
          caption: "Renewal",
          href: "/programs?view=solutions",
          activeWhen: (pathname, view) =>
            pathname.startsWith("/programs/solutions") || (pathname === "/programs" && view === "solutions"),
        },
        { key: "advance", label: "Advance", caption: "Partner tier", href: "/programs/tiers" },
      ]}
    />
  );
}
