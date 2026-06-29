import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import {
  PageHero,
  PricingSection,
  FaqSection,
  FinalCtaSection,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Pricing — PartnerOS",
  description:
    "Plans that scale with your AWS partnership — Team, Growth, and Enterprise. Pricing is tailored to your team; book a demo for a quote.",
};

export default async function PricingPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (identity) redirect("/");
  return (
    <main>
      <PageHero
        eyebrow="Pricing"
        title="Pricing that scales with your partnership."
        subtitle="Three plans — Team, Growth, and Enterprise — built around the capabilities your partnership needs. Tailored to your team; book a demo for a quote."
      />
      <PricingSection />
      <FaqSection />
      <FinalCtaSection />
    </main>
  );
}
