import type { ReactNode } from "react";
import {
  HeroSection,
  TrustStrip,
  WhyPartnerOSSection,
  FeaturesSection,
  HowItWorksSection,
  OutcomesSection,
  SecuritySection,
  FinalCtaSection,
} from "@/components/marketing/sections";

/**
 * Marketing home (`/` when signed out) — the overview page. Composes the shared
 * marketing sections; the deeper Features and Pricing pages live at their own
 * routes. Security stays here as a section (no standalone page).
 */
export function MarketingHome(): ReactNode {
  return (
    <main>
      <HeroSection />
      <TrustStrip />
      <WhyPartnerOSSection />
      <FeaturesSection />
      <HowItWorksSection />
      <OutcomesSection />
      <SecuritySection />
      <FinalCtaSection />
    </main>
  );
}
