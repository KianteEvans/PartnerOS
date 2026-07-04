import { addDays, addMonths, daysBetween } from "@/domain/dates";
import { coFunding, isBlocked } from "@/domain/mdf/compliance";

/**
 * Pure decision-intelligence + calendar geometry for the MDF event planner. No DB,
 * no clock (the caller passes `today`). ROI = projected pipeline per AWS-ask dollar;
 * `recommendedFit` greedily picks the highest-ROI events that fit available MDF.
 */

export interface RoiItem {
  readonly expectedPipeline: number;
  readonly totalCost: number;
  readonly coFundPct: number;
}

/** Projected pipeline per AWS-ask dollar for one event (null when there's no ask). */
export function itemRoi(item: RoiItem): number | null {
  const ask = coFunding(item.totalCost, item.coFundPct).amountToClaim;
  if (ask <= 0) return null;
  return Math.round((item.expectedPipeline / ask) * 100) / 100;
}

/** Structurally assignable to both PlanItemLike (for `isBlocked`) and RoiItem (for `itemRoi`). */
export interface FitItem {
  readonly id: string;
  readonly catalogKey: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly totalCost: number;
  readonly coFundPct: number;
  readonly expectedPipeline: number;
}

export interface PlanFit {
  readonly fitIds: ReadonlySet<string>;
  readonly deferIds: ReadonlySet<string>;
}

/**
 * Greedily select the eligible (non-blocked) events that fit `availableMdf`, taking
 * the highest ROI first (tie-break: smaller ask first). Events that don't fit are
 * deferred. With no budget signal (availableMdf <= 0) we can't advise cuts, so all
 * eligible events are "fit".
 */
export function recommendedFit(
  items: readonly FitItem[],
  availableMdf: number,
  today: string,
): PlanFit {
  const eligible = items.filter((it) => !isBlocked(it, today));
  if (availableMdf <= 0) {
    return { fitIds: new Set(eligible.map((i) => i.id)), deferIds: new Set() };
  }
  const ranked = [...eligible].sort((a, b) => {
    const rb = itemRoi(b) ?? -1;
    const ra = itemRoi(a) ?? -1;
    if (rb !== ra) return rb - ra;
    return coFunding(a.totalCost, a.coFundPct).amountToClaim - coFunding(b.totalCost, b.coFundPct).amountToClaim;
  });
  const fitIds = new Set<string>();
  const deferIds = new Set<string>();
  let spent = 0;
  for (const it of ranked) {
    const ask = coFunding(it.totalCost, it.coFundPct).amountToClaim;
    if (spent + ask <= availableMdf) {
      fitIds.add(it.id);
      spent += ask;
    } else {
      deferIds.add(it.id);
    }
  }
  return { fitIds, deferIds };
}

// --- Calendar / timeline geometry -------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function endOfMonth(iso: string): string {
  return addDays(addMonths(`${iso.slice(0, 7)}-01`, 1), -1);
}

export interface TimelineEvent {
  readonly id: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface TimelineBar {
  readonly id: string;
  readonly leftPct: number;
  readonly widthPct: number;
}

export interface TimelineMark {
  readonly label: string;
  readonly leftPct: number;
}

export interface TimelineLayout {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly bars: TimelineBar[];
  /** Position of "today" in the window, or null if outside it. */
  readonly todayPct: number | null;
  readonly ticks: TimelineMark[];
  /** Dec 1 fund-request cutoff markers per year in the window. */
  readonly markers: TimelineMark[];
}

/**
 * Lay events out on a month-gridded horizontal track (percent coordinates, 0–100),
 * snapping the window to whole months and always including `today`. Returns null
 * when no event has both dates.
 */
export function planTimelineLayout(
  events: readonly TimelineEvent[],
  today: string,
): TimelineLayout | null {
  const dated = events.filter(
    (e): e is TimelineEvent & { startDate: string; endDate: string } =>
      e.startDate !== null && e.endDate !== null,
  );
  if (dated.length === 0) return null;

  let windowStart = dated.map((e) => e.startDate).reduce((a, b) => (a < b ? a : b));
  let windowEnd = dated.map((e) => e.endDate).reduce((a, b) => (a > b ? a : b));
  if (today < windowStart) windowStart = today;
  if (today > windowEnd) windowEnd = today;
  windowStart = `${windowStart.slice(0, 7)}-01`;
  windowEnd = endOfMonth(windowEnd);

  const span = Math.max(1, daysBetween(windowStart, windowEnd));
  const pct = (d: string): number => Math.max(0, Math.min(100, (daysBetween(windowStart, d) / span) * 100));

  const bars: TimelineBar[] = dated.map((e) => {
    const left = pct(e.startDate);
    const right = pct(e.endDate);
    return { id: e.id, leftPct: left, widthPct: Math.max(1.5, right - left) };
  });

  const ticks: TimelineMark[] = [];
  for (let m = windowStart; m <= windowEnd; m = addMonths(m, 1)) {
    const mm = Number(m.slice(5, 7));
    ticks.push({ label: mm === 1 ? `${MONTHS[mm - 1]} '${m.slice(2, 4)}` : MONTHS[mm - 1]!, leftPct: pct(m) });
  }

  const markers: TimelineMark[] = [];
  for (let y = Number(windowStart.slice(0, 4)); y <= Number(windowEnd.slice(0, 4)); y++) {
    const cutoff = `${y}-12-01`;
    if (cutoff >= windowStart && cutoff <= windowEnd) markers.push({ label: "Dec 1 cutoff", leftPct: pct(cutoff) });
  }

  return {
    windowStart,
    windowEnd,
    bars,
    todayPct: today >= windowStart && today <= windowEnd ? pct(today) : null,
    ticks,
    markers,
  };
}
