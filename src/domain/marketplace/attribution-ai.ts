import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseAttributionAdvice, type AttributionAdvice } from "@/domain/marketplace/attribution-ai-parse";
import type { AttributionInsights } from "@/domain/marketplace/attribution-insights";

/**
 * Optional AI read-out for the attribution advisor — a grounded rewrite of the
 * COMPUTED insights (ratio, findings, recommendations; aggregates only, never raw
 * rows). Configured the same way as the other AI helpers: present
 * ANTHROPIC_API_KEY or the button stays disabled with a hint.
 */

export function isAttributionAdvisorEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS Marketplace revenue-attribution advisor embedded in PartnerOS.
You are given a partner's COMPUTED attribution insights: attributed AWS-consumption revenue vs
Marketplace-billed revenue, per-listing measurement gaps, and method-configuration findings.
Write a short, prioritized read-out of what to fix first and why it matters. The ratio compares
attributed consumption to billed revenue — two DIFFERENT measures, so it can legitimately exceed
100%; never call it "coverage of billed revenue". Ground every claim in the provided numbers;
never invent listings, methods, or amounts. Respond with ONLY a compact JSON object and nothing
else: {"headline": "<one sentence>", "advice": ["<imperative step>", ...]} (2-5 advice items,
most impactful first).`;

export async function generateAttributionAdvice(insights: AttributionInsights): Promise<AttributionAdvice | null> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Attribution advisor AI is not configured");

  // Grounding: computed aggregates only — findings/recommendations text plus
  // per-listing counts, never raw attribution or charge rows.
  const grounding = JSON.stringify({
    attributedCents: insights.attributedCents,
    billedCents: insights.billedCents,
    ratioPercent: insights.ratioPercent,
    findings: insights.findings,
    recommendations: insights.recommendations,
    listings: insights.perListing.map((l) => ({
      title: l.title,
      attributedCents: l.attributedCents,
      billedCents: l.billedCents,
      activeMethods: l.activeMethods,
      totalMethods: l.totalMethods,
    })),
  });

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Attribution insights:\n${grounding}` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseAttributionAdvice(text);
}
