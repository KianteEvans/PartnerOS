import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import {
  PageHero,
  FeaturesSection,
  HowItWorksSection,
  OutcomesSection,
  FinalCtaSection,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Features — PartnerOS",
  description:
    "Readiness, co-sell pipeline, evidence, competencies, tiers, MDF, and reporting — everything an AWS partnership runs on, in one workspace.",
};

export default async function FeaturesPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (identity) redirect("/");
  return (
    <main>
      <PageHero
        eyebrow="Product"
        title="The operating system for AWS partnerships."
        subtitle="From readiness to co-sell to competency submissions — every workflow your team runs, connected in one place."
      />
      <FeaturesSection />
      <HowItWorksSection />
      <OutcomesSection />
      <FinalCtaSection />
    </main>
  );
}
