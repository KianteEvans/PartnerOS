import type { ProgramType } from "@/domain/applications/detect";

/**
 * Pure prompt composition for the AI control-response drafter. The submission-style
 * rules + per-program emphasis are distilled from the AWS Specialization Programs
 * Guide so drafts match what AWS reviewers expect. Kept pure (no SDK) so the
 * composed prompt is unit-testable.
 */

export interface GenEvidence {
  readonly title: string;
  readonly notes: string;
  readonly type: string;
  readonly status: string;
}

export interface GenerateInput {
  readonly programType: ProgramType;
  readonly competencyName: string;
  readonly sectionName: string;
  readonly controlId: string;
  readonly requirement: string;
  readonly exampleResponse?: string;
  readonly evidence: readonly GenEvidence[];
}

/** AWS submission-style rules (Appendix B do/don'ts + reviewer expectations). */
export const RESPONSE_GUIDANCE = `Write the response the way AWS reviewers expect for a Specialization self-assessment:
- Be specific and concrete: name the use cases, industries, customer segments, and the AWS services involved.
- Describe the partner's actual process, mechanism, or capability that satisfies the requirement — not aspirations.
- Quantify with the evidence (counts, scale, outcomes) and cite the supporting evidence by exact title.
- Do NOT use unprovable superlatives ("best", "#1", "leading") or marketing fluff — AWS validates every claim against evidence.
- Do NOT repeat the requirement text back; answer it directly in professional third person.
- A reviewer should be able to verify each claim from the cited evidence.`;

const PROGRAM_HINTS: Record<ProgramType, string> = {
  Competency:
    "Program emphasis (AWS Competency): demonstrated expertise, repeatable delivery practices, and certified staff in the competency area.",
  "Service Delivery":
    "Program emphasis (AWS Service Delivery): hands-on expertise delivering the specific AWS service across real customer engagements.",
  "Service Ready":
    "Program emphasis (AWS Service Ready): the product's technical integration with the AWS service, packaging, and supportability.",
  MSP: "Program emphasis (AWS MSP): managed-service operations, automation, business processes, and customer lifecycle management.",
  FTR: "Program emphasis (FTR): adherence to AWS best practices and the Well-Architected Framework for the solution.",
  Unknown: "",
};

export function programGuidance(programType: ProgramType): string {
  return PROGRAM_HINTS[programType] ?? "";
}

export const SYSTEM_PROMPT = `You are an AWS Partner Network submission specialist embedded in PartnerOS. You draft the "Partner Response" for ONE control in an AWS Specialization Self-Assessment, in AWS's expected submission style: specific, evidence-backed, third-person, describing what the partner has actually done.

You are given the program, the section, the control's requirement, an optional AWS-provided example answer (a STYLE reference only — never copy its facts), and the partner's evidence (title, type, status, notes). Draft the response grounded ONLY in the supplied evidence. Cite the specific evidence you used by its exact title. Do NOT invent customers, metrics, dates, certifications, or artifacts that are not present in the evidence. If the evidence is insufficient to satisfy the requirement, say plainly what is missing, set "met" to "no", and keep the response honest rather than fabricated.

${RESPONSE_GUIDANCE}

Respond with ONLY a compact JSON object and nothing else: {"response":"<the Partner Response prose>","met":"yes|no|partial","confidence":<integer 0-100>,"reasoning":"<one or two sentences on the basis>","cited":["<exact evidence title>", ...]}.`;

/** Build the per-control user message (program-aware, evidence-grounded). */
export function buildUserContent(input: GenerateInput): string {
  const evidenceLines =
    input.evidence.length > 0
      ? input.evidence
          .map((e) => `- [${e.type}, ${e.status}] ${e.title}${e.notes ? ` -- ${e.notes}` : ""}`)
          .join("\n")
      : "(no evidence on file)";
  const hint = programGuidance(input.programType);
  const programLabel = input.programType === "Unknown" ? "(unspecified)" : input.programType;

  return [
    `Program: ${programLabel}${input.competencyName ? ` - ${input.competencyName}` : ""}`,
    ...(hint ? [hint] : []),
    `Section: ${input.sectionName || "(none)"}`,
    `Control: ${input.controlId}`,
    `Requirement: ${input.requirement}`,
    ...(input.exampleResponse
      ? [`AWS example answer (STYLE reference only, do not copy its facts): ${input.exampleResponse}`]
      : []),
    "Partner evidence:",
    evidenceLines,
  ].join("\n");
}
