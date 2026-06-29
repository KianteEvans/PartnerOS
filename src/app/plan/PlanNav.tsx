"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * Planning sub-nav: diagnose readiness (Assessments) then turn it into a milestone
 * plan (Roadmaps) — one workflow, already linked by the "Build roadmap" handoff.
 */
export function PlanNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="Planning"
      tabs={[
        { key: "assessments", label: "Assessments", caption: "Readiness", href: "/plan" },
        { key: "roadmaps", label: "Roadmaps", caption: "Milestone plan", href: "/plan/roadmaps" },
      ]}
    />
  );
}
