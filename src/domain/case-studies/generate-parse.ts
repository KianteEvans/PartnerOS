/**
 * Pure parser for the AI case-study reply. The model returns a compact JSON object
 * with the five narrative aspects; this extracts them defensively (tolerating
 * surrounding prose / malformed bodies) and ALWAYS returns a safe result. No SDK.
 */

export interface CaseStudyDraft {
  readonly aboutCustomer: string;
  readonly challenge: string;
  readonly goals: string;
  readonly solution: string;
  readonly outcomes: string;
}

const clampStr = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 4000) : "");

export function parseCaseStudyDraft(text: string): CaseStudyDraft {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        aboutCustomer: clampStr(obj.aboutCustomer),
        challenge: clampStr(obj.challenge),
        goals: clampStr(obj.goals),
        solution: clampStr(obj.solution),
        outcomes: clampStr(obj.outcomes),
      };
    }
  } catch {
    // malformed JSON -> safe empty draft below
  }
  return { aboutCustomer: "", challenge: "", goals: "", solution: "", outcomes: "" };
}
