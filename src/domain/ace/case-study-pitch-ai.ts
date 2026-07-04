import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseCaseStudyPitch, type CaseStudyPitchLine } from "@/domain/ace/case-study-pitch-parse";
import type { MatchOpp, ScoredCaseStudy } from "@/domain/ace/case-study-match";

/**
 * Optional AI pitch for the Deal Desk's matched case studies — one grounded line per
 * study explaining why it fits THIS deal. Grounds exclusively on server-derived data
 * (the matcher's own input + scored output); the model sees titles, never ids, and
 * the action maps titles back. Configured like every other AI helper: present
 * ANTHROPIC_API_KEY or the feature stays hidden.
 */

export function isCaseStudyPitchEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS partner-alliance seller's assistant embedded in PartnerOS.
You are given ONE co-sell opportunity and the customer case studies a deterministic matcher
selected for it (with match reasons). For each case study worth citing, write ONE short line
(under 25 words) a seller could say to this customer about why that proof point is relevant.
Use only the facts provided; do not invent outcomes or customers. Skip studies that add nothing.
Respond with ONLY a compact JSON object and nothing else:
{"pitches": [{"title": "<exact case study title>", "why": "<one line>"}, ...]}.`;

export async function generateCaseStudyPitch(input: {
  readonly opp: MatchOpp & { readonly stage: string; readonly amount: number };
  readonly matches: readonly ScoredCaseStudy[];
}): Promise<readonly CaseStudyPitchLine[] | null> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Case-study pitch AI is not configured");

  const grounding = JSON.stringify({
    opportunity: {
      name: input.opp.name,
      customer: input.opp.accountName,
      stage: input.opp.stage,
      amount: input.opp.amount,
      nextStep: input.opp.nextStep,
      awsNextBestActions: input.opp.awsNextBestActions,
      solution: input.opp.solutionText,
      program: input.opp.programText,
    },
    caseStudies: input.matches.map((m) => ({
      title: m.title,
      customer: m.customerName,
      matchReasons: m.reasons,
      pinned: m.attached,
    })),
  });

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Opportunity and matched case studies:\n${grounding}` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseCaseStudyPitch(text);
}
