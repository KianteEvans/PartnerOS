/**
 * Pure, dependency-free parser for the Alliance Copilot reply. The model is asked to
 * return a compact JSON object {answer, reasoning, nextActions[]}; this extracts it
 * defensively (tolerating surrounding prose or a malformed body) and ALWAYS returns a
 * safe result — a parse failure degrades to a placeholder rather than throwing.
 * Unit-tested without the SDK. Mirrors src/domain/programs/recommend-parse.ts.
 */

export interface CopilotAnswer {
  readonly answer: string;
  readonly reasoning: string;
  readonly nextActions: string[];
}

export function parseCopilotAnswer(text: string): CopilotAnswer {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        answer?: unknown;
        reasoning?: unknown;
        nextActions?: unknown;
      };
      const answer =
        typeof obj.answer === "string" && obj.answer.trim().length > 0
          ? obj.answer.trim().slice(0, 2000)
          : "No answer was returned.";
      const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim().slice(0, 1000) : "";
      const nextActions = Array.isArray(obj.nextActions)
        ? obj.nextActions
            .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
            .map((a) => a.trim().slice(0, 200))
            .slice(0, 5)
        : [];
      return { answer, reasoning, nextActions };
    }
  } catch {
    // malformed JSON -> safe fallback below
  }
  return { answer: "Could not parse the copilot response.", reasoning: "", nextActions: [] };
}
