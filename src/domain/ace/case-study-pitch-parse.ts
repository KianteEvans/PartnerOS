/**
 * Defensive parser for the AI case-study pitch. The model is asked for compact JSON
 * {"pitches": [{"title": "...", "why": "..."}, ...]}; anything malformed degrades to
 * null instead of throwing. Titles are matched back to case-study ids by the action
 * (the model never sees ids). Pure and unit-testable.
 */

export interface CaseStudyPitchLine {
  readonly title: string;
  readonly why: string;
}

const MAX_TITLE = 200;
const MAX_WHY = 200;
const MAX_PITCHES = 6;

export function parseCaseStudyPitch(text: string): readonly CaseStudyPitchLine[] | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(text.slice(start, end + 1)) as { pitches?: unknown };
    if (!Array.isArray(obj.pitches)) return null;
    const pitches = obj.pitches
      .filter(
        (p): p is { title: string; why: string } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { title?: unknown }).title === "string" &&
          (p as { title: string }).title.trim().length > 0 &&
          typeof (p as { why?: unknown }).why === "string" &&
          (p as { why: string }).why.trim().length > 0,
      )
      .map((p) => ({
        title: p.title.trim().slice(0, MAX_TITLE),
        why: p.why.trim().slice(0, MAX_WHY),
      }))
      .slice(0, MAX_PITCHES);
    return pitches.length > 0 ? pitches : null;
  } catch {
    return null;
  }
}
