import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseEvaluation, type EvidenceEvaluation } from "@/domain/evidence/evaluate-parse";

/**
 * Server-only client for the optional AI evidence evaluator. Given ONE evidence
 * artifact (title + notes) and ONE AWS program requirement, asks Claude how
 * confident it is that the artifact would satisfy that requirement, and returns a
 * 0-100 confidence + short reasoning. Optional + key-gated like "Ask AWS": the
 * deterministic fit engine is the always-on core; this only deepens a concrete
 * evidence<->requirement pairing. Never imported by client code.
 */

export function isEvidenceEvalEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS Partner Network evidence reviewer embedded in PartnerOS. You judge whether ONE piece of partner evidence plausibly satisfies ONE AWS program requirement.

You are given the requirement (its label and the type of artifact it expects) and the evidence (its title and notes). Decide how confident you are, from 0 to 100, that this evidence — if genuine and complete — would satisfy that requirement. Base the judgment ONLY on what you are given; do not invent details about the artifact's contents. Reward a clear artifact-type and topic match; penalize a vague title, a mismatched artifact type, or missing specifics.

Respond with ONLY a compact JSON object and nothing else: {"confidence": <integer 0-100>, "reasoning": "<one or two sentences>"}.`;

export interface EvaluateInput {
  readonly evidenceTitle: string;
  readonly evidenceNotes: string;
  readonly requirementLabel: string;
  readonly expectedEvidenceType: string;
}

export async function evaluateEvidenceFit(input: EvaluateInput): Promise<EvidenceEvaluation> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Evidence AI evaluation is not configured");

  const client = new Anthropic({ apiKey });
  const userContent = [
    `Requirement: ${input.requirementLabel}`,
    `Expected artifact type: ${input.expectedEvidenceType}`,
    `Evidence title: ${input.evidenceTitle}`,
    `Evidence notes: ${input.evidenceNotes.trim() || "(none provided)"}`,
  ].join("\n");

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseEvaluation(text);
}
