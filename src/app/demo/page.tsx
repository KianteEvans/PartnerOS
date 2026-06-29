import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { DemoSection } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Book a demo — PartnerOS",
  description:
    "See PartnerOS on your own partnership — a 30-minute guided walkthrough of readiness, co-sell, evidence, and competency tracking. No commitment.",
};

export default async function DemoPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (identity) redirect("/");
  return (
    <main>
      <DemoSection />
    </main>
  );
}
