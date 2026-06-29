"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * MDF section sub-nav: the funding overview (requests + budget + trends) and the
 * forward-looking event planner (assemble events against available MDF). The
 * planner's longer `/mdf/plan` prefix keeps the request detail `/mdf/[id]` on
 * Overview.
 */
export function MdfNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="MDF"
      tabs={[
        { key: "overview", label: "Overview", caption: "Requests & budget", href: "/mdf" },
        { key: "planner", label: "Planner", caption: "Plan events vs MDF", href: "/mdf/plan" },
      ]}
    />
  );
}
