"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * Playbooks sub-nav: author rules, watch what they fired (and approve pending
 * runs), and configure delivery channels.
 */
export function PlaybooksNav({ showChannels = true }: { showChannels?: boolean }): ReactNode {
  const tabs = [
    { key: "rules", label: "Rules", caption: "Automations", href: "/playbooks" },
    { key: "activity", label: "Activity", caption: "Runs & approvals", href: "/playbooks/activity" },
    // Delivery channels (webhooks) are an Enterprise-package feature.
    ...(showChannels ? [{ key: "channels", label: "Channels", caption: "Delivery", href: "/playbooks/channels" }] : []),
  ];
  return <SectionTabs ariaLabel="Playbooks" tabs={tabs} />;
}
