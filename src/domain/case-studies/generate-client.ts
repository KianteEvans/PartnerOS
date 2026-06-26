import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseCaseStudyDraft, type CaseStudyDraft } from "@/domain/case-studies/generate-parse";

/**
 * Server-only client that drafts an AWS case study's five narrative aspects from
 * the partner's evidence, in AWS's working-backwards structure. Optional + key-gated
 * like the other AI features. Never imported by client code.
 */

export function isCaseStudyGenEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS Partner Network case-study writer embedded in PartnerOS. You draft an AWS Specialization customer case study from the partner's evidence, in AWS's expected working-backwards structure.

You are given the case study title + customer and the supporting evidence (title + notes). Draft each of the five narrative aspects, grounded ONLY in the supplied material: be specific (industry, scale, the AWS services involved) and quantify outcomes where the evidence supports it. Do NOT invent customers, metrics, or facts beyond what is given; if a section can't be supported, keep it brief and honest. Write in professional third person, no marketing superlatives.

Respond with ONLY a compact JSON object and nothing else: {"aboutCustomer":"...","challenge":"...","goals":"...","solution":"...","outcomes":"..."}.`;

export interface CaseStudyGenInput {
  readonly title: string;
  readonly customerName: string;
  readonly evidenceTitle: string;
  readonly evidenceNotes: string;
}

export async function generateCaseStudy(input: CaseStudyGenInput): Promise<CaseStudyDraft> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Case study generation is not configured");

  const client = new Anthropic({ apiKey });
  const userContent = [
    `Case study title: ${input.title}`,
    `Customer: ${input.customerName || "(unspecified)"}`,
    `Supporting evidence: ${input.evidenceTitle || "(none linked)"}`,
    `Evidence notes: ${input.evidenceNotes.trim() || "(none provided)"}`,
  ].join("\n");

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseCaseStudyDraft(text);
}
