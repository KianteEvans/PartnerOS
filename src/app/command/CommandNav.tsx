"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * Command Center sub-nav: the triage/health cockpit (Decisions) and the execution
 * backlog (Tasks) are two faces of one operating surface — Command Center already
 * derives its Work stat and overdue/blocked decisions from the same tasks.
 */
export function CommandNav(): ReactNode {
  return (
    <SectionTabs
      ariaLabel="Command Center"
      tabs={[
        { key: "decisions", label: "Decisions", caption: "Triage & health", href: "/command" },
        { key: "tasks", label: "Tasks", caption: "Execution backlog", href: "/command/tasks" },
      ]}
    />
  );
}
