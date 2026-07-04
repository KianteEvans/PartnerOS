/**
 * Shared inline styles for drawer/panel form fields, so every section's create
 * and edit forms read identically. Two control sizes: the regular drawer field
 * and a compact variant for dense inline forms (ACE cards, goals panel).
 */

/** Field wrapper `<label>`: stacked caption + control, muted caption text. */
export const formLabel = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" } as const;

/** Muted caption `<span>` for pages that color the span rather than the label. */
export const formLabelSpan = { color: "var(--muted)" } as const;

/** Regular text/select/textarea control. */
export const formControl = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
} as const;

/** Compact control for dense inline forms. */
export const formControlSm = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;
