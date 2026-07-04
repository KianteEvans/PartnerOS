import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseNarrative, type RecommendNarrative } from "@/domain/programs/recommend-parse";

/**
 * Server-only client for the optional AI roadmap narrative. Given a roadmap's
 * milestones (with status), its target tier and coverage %, and the top recommended
 * programs to add (numbers and labels only — no raw evidence text), asks Claude for
 * a short "what to prioritize next" rationale. Optional + key-gated like the other
 * AI helpers; the deterministic tier coverage + recommender are the always-on core.
 * Never imported by client code. Reuses the recommend narrative parser/type.
 */

export function isRoadmapNarrativeEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS Partner roadmap advisor embedded in PartnerOS. The partner has a roadmap of milestones working toward a target AWS partner tier. Given the roadmap's milestones (with status), its target tier and how completely the roadmap covers that tier's requirements, plus the top recommended AWS programs to add, write a short, plain-English rationale (2-4 sentences) on what to prioritize next and why — grounded ONLY in the numbers and labels provided. Do not invent program details or requirements. Be concrete and honest about gaps.

Respond with ONLY a compact JSON object and nothing else: {"narrative": "<2-4 sentences>", "topPick": "<the single thing to prioritize next>"}.`;

export interface RoadmapNarrateInput {
  readonly roadmapName: string;
  readonly targetTier: string | null;
  readonly coveragePercent: number | null;
  readonly milestones: readonly { title: string; status: string; targetDate: string }[];
  readonly recommendations: readonly { name: string; programType: string; score: number }[];
}

export async function narrateRoadmap(input: RoadmapNarrateInput): Promise<RecommendNarrative> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Roadmap narrative is not configured");

  const client = new Anthropic({ apiKey });
  const userContent = [
    `Roadmap: ${input.roadmapName}`,
    `Target tier: ${input.targetTier ?? "(none)"}`,
    `Tier coverage: ${input.coveragePercent === null ? "(no tier target)" : `${input.coveragePercent}%`}`,
    "",
    "Milestones:",
    ...input.milestones.map((m, i) => `${i + 1}. ${m.title} — ${m.status}, target ${m.targetDate}`),
    "",
    "Top recommended programs to add:",
    ...(input.recommendations.length === 0
      ? ["(none)"]
      : input.recommendations.map((r, i) => `${i + 1}. ${r.name} (${r.programType}) — fit ${r.score}/100`)),
  ].join("\n");

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseNarrative(text);
}
