"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Reflects the active section as `data-section` on <html> so globals.css can tint
 * that section's nav / tabs / hero with `--section-accent` (each area gets a colour
 * identity while orange stays reserved for actions). The pre-paint script in the
 * root layout sets it on first load to avoid a flash; this keeps it in sync across
 * client-side navigation. Un-themed routes (home/settings) clear it -> orange.
 */
const SECTIONS = new Set(["command", "ace", "mdf", "funding", "programs", "plan", "reports", "marketplace", "playbooks"]);

export function SectionTheme(): null {
  const pathname = usePathname();
  useEffect(() => {
    const seg = pathname.split("/")[1] ?? "";
    const root = document.documentElement;
    if (SECTIONS.has(seg)) root.setAttribute("data-section", seg);
    else root.removeAttribute("data-section");
  }, [pathname]);
  return null;
}
