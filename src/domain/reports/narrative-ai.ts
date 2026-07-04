import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseNarrativeResponse } from "@/domain/reports/narrative-parse";
import type { ReportSnapshot } from "@/domain/reports/metrics";

/**
 * Optional AI polish for the report executive narrative. The deterministic
 * `narrativeOutline` is the grounding AND the fallback: this pass only rewrites it
 * into executive prose, constrained to the outline + the frozen snapshot. Configured
 * the same way as the other AI helpers — present ANTHROPIC_API_KEY or the caller
 * saves the outline verbatim.
 */

export function isReportNarrativeAiEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an executive narrative writer for an AWS partner's leadership reports inside PartnerOS. You are given a deterministic outline of the partnership's story (health posture, where value is flowing, risks, trajectory) plus the report's frozen metric snapshot. Rewrite the outline into 3-5 short paragraphs of polished executive prose an alliance director could read aloud in a business review. Ground EVERY claim in the outline or the snapshot; never invent numbers, programs, dates, or names. Keep the paragraph order: posture, value flow (if present), risks, trajectory. Respond with ONLY a compact JSON object and nothing else: {"narrative": "<the prose, paragraphs separated by \\n\\n>"}.`;

export async function generateNarrativeProse(input: {
  readonly outline: string;
  readonly snapshot: ReportSnapshot;
}): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Report narrative AI is not configured");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: `OUTLINE\n${input.outline}\n\nSNAPSHOT\n${JSON.stringify(input.snapshot)}` },
    ],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseNarrativeResponse(text);
}
