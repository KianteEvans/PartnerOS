/**
 * Shared display formatting for money. Dashboards show whole dollars; the
 * Marketplace pillars store cents (AWS billing convention) and convert at the
 * edge. Deliberately NOT used by reports/narrative.ts: DB-stored narrative text
 * pins an explicit en-US locale so stored output is deterministic and
 * WIN1252-safe.
 */

/** Whole-dollar display: $12,345 (fractional input rounds). */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Nullable variant for optional amounts: em-dash when unknown. */
export function moneyOrDash(n: number | null): string {
  return n == null ? "—" : money(n);
}

/** Marketplace amounts are stored in cents; render as dollars. */
export function moneyFromCents(cents: number, maximumFractionDigits: 0 | 2 = 2): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits })}`;
}
