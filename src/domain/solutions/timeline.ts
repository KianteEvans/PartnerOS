import { addDays, daysBetween } from "@/domain/dates";
import type { RenewalBand } from "@/domain/solutions/renewal";

/**
 * Pure layout for the Solutions renewal timeline: lay the dated solutions out on a
 * single date axis (so the renewal calendar is scannable at a glance), splitting
 * out the ones with no renewal date. No DB, no clock — the caller passes `today`,
 * which is always kept inside the axis so its marker renders.
 */

export interface RenewalTimelineInput {
  readonly id: string;
  readonly title: string;
  readonly band: RenewalBand;
  readonly renewalDate: string | null;
}

export interface RenewalAxisPoint {
  readonly id: string;
  readonly title: string;
  readonly band: RenewalBand;
  readonly date: string;
  /** Position 0–100 along the axis. */
  readonly pct: number;
}

export interface RenewalAxis {
  readonly start: string;
  readonly end: string;
  /** Position 0–100 of `today` on the axis. */
  readonly todayPct: number;
  readonly points: readonly RenewalAxisPoint[];
  readonly undated: readonly { id: string; title: string; band: RenewalBand }[];
}

const PAD_DAYS = 14;
const minIso = (a: string, b: string): string => (a < b ? a : b);
const maxIso = (a: string, b: string): string => (a > b ? a : b);

export function renewalAxis(
  items: readonly RenewalTimelineInput[],
  today: string,
): RenewalAxis {
  const dated = items.filter(
    (i): i is RenewalTimelineInput & { renewalDate: string } => i.renewalDate !== null,
  );
  const undated = items
    .filter((i) => i.renewalDate === null)
    .map((i) => ({ id: i.id, title: i.title, band: i.band }));

  if (dated.length === 0) {
    return { start: today, end: today, todayPct: 50, points: [], undated };
  }

  const dates = dated.map((i) => i.renewalDate).sort();
  const start = addDays(minIso(dates[0]!, today), -PAD_DAYS);
  const end = addDays(maxIso(dates[dates.length - 1]!, today), PAD_DAYS);
  const span = Math.max(1, daysBetween(start, end));
  const pctOf = (d: string): number =>
    Math.max(0, Math.min(100, Math.round((daysBetween(start, d) / span) * 100)));

  const points = dated
    .slice()
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
    .map((i) => ({ id: i.id, title: i.title, band: i.band, date: i.renewalDate, pct: pctOf(i.renewalDate) }));

  return { start, end, todayPct: pctOf(today), points, undated };
}
