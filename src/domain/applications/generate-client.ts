import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseControlDraft, type ControlDraft } from "@/domain/applications/generate-parse";
import {
  SYSTEM_PROMPT,
  buildUserContent,
  type GenerateInput,
  type GenEvidence,
} from "@/domain/applications/guidance";

/**
 * Server-only client that drafts a single AWS Specialization Self-Assessment
 * "Partner Response" for one control, grounded ONLY in the supplied evidence and
 * the AWS submission rules from `guidance.ts`. Optional + key-gated like "Ask AWS"
 * / the evidence evaluator. Never imported by client code.
 */

export type { GenerateInput, GenEvidence };

export function isCompetencyGenEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

export async function generateControlResponse(input: GenerateInput): Promise<ControlDraft> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Competency response generation is not configured");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 900,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent(input) }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseControlDraft(text);
}
