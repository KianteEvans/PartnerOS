import { Fragment, type ReactNode } from "react";

/**
 * Definition-list detail block — a two-column `<dl>` grid (muted label -> value).
 * Promoted from the repeated inline `<dl>` on detail pages (solutions "Details",
 * marketplace, settings). Presentational + sync; the enclosing Panel owns collapse.
 * Callers omit falsy rows at the spread site so absent fields simply don't render.
 */
export function KeyValueRows({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: ReactNode }>;
}): ReactNode {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0, fontSize: 13 }}>
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt style={{ color: "var(--muted)" }}>{r.label}</dt>
          <dd style={{ margin: 0 }}>{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
