import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseNarrative, type RecommendNarrative } from "@/domain/programs/recommend-parse";

/**
 * Server-only client for the optional AI competency-recommendation narrative. Given
 * the top deterministic recommendations + the partner's profile/readiness (numbers
 * and labels only — NO raw evidence text), asks Claude for a short "why this
 * competency next" paragraph. Optional + key-gated like the other AI helpers: the
 * deterministic recommender is the always-on core; this only adds a readable rationale.
 * Never imported by client code.
 */

export function isRecommendNarrativeEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS Partner competency advisor embedded in PartnerOS. A deterministic engine has already ranked the partner's best-fit AWS Competencies using their evidence coverage, business model, and readiness scores. Your job is to write a short, plain-English rationale (2-4 sentences) explaining which competency to pursue next and why, grounded ONLY in the numbers and labels provided. Do not invent program details or evidence. Be concrete and encouraging but honest about gaps.

Respond with ONLY a compact JSON object and nothing else: {"narrative": "<2-4 sentences>", "topPick": "<the program name you'd pursue next>"}.`;

export interface NarrateItem {
  readonly name: string;
  readonly programType: string;
  readonly recommendationScore: number;
  readonly coveragePercent: number;
  readonly effectiveLean: string;
}

export interface NarrateInput {
  readonly top: readonly NarrateItem[];
  readonly partnerType: string | null;
  readonly industry: string | null;
  readonly overallReadiness: number | null;
}

export async function narrateRecommendations(input: NarrateInput): Promise<RecommendNarrative> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Competency recommendation narrative is not configured");

  const client = new Anthropic({ apiKey });
  const userContent = [
    `Partner type: ${input.partnerType ?? "(not set)"}`,
    `Industry: ${input.industry ?? "(not set)"}`,
    `Overall readiness: ${input.overallReadiness === null ? "(not assessed)" : input.overallReadiness}`,
    "",
    "Top recommendations (best first):",
    ...input.top.map(
      (t, i) =>
        `${i + 1}. ${t.name} (${t.programType}) — fit ${t.recommendationScore}/100, evidence ${t.coveragePercent}%, model lean ${t.effectiveLean}`,
    ),
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
