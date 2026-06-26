import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import type { SortDir } from "@/domain/list";

export interface Column<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  /** Right-align numeric/money columns; defaults to left. */
  readonly align?: "left" | "right";
  /** When set (and `sort` is provided), the header becomes a sort link. */
  readonly sortKey?: string;
}

/** Current sort + a builder for the header link of a given sort key. */
export interface SortState {
  readonly sort: string;
  readonly dir: SortDir;
  readonly href: (sortKey: string) => string;
}

/** Generic, typed table primitive shared across feature sections (Rule 7). */
export function Table<Row>({
  columns,
  rows,
  rowKey,
  empty = "No rows",
  sort,
  rowStyle,
}: {
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  /** A plain string is auto-wrapped in an EmptyState; pass a node for a richer one. */
  empty?: ReactNode;
  /** Enables clickable sort headers for columns that declare a `sortKey`. */
  sort?: SortState;
  /** Optional per-row style (e.g. tint at-risk rows). */
  rowStyle?: (row: Row) => CSSProperties | undefined;
}): ReactNode {
  if (rows.length === 0) {
    return typeof empty === "string" ? <EmptyState title={empty} /> : <>{empty}</>;
  }
  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table className="data-table" style={{ width: "100%", minWidth: "min-content", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {columns.map((c) => {
            const active = sort && c.sortKey && sort.sort === c.sortKey;
            const arrow = active ? (sort!.dir === "asc" ? " ↑" : " ↓") : "";
            return (
              <th
                key={c.key}
                style={{
                  textAlign: c.align ?? "left",
                  borderBottom: "1px solid var(--border)",
                  color: active ? "var(--text)" : "var(--muted)",
                  fontWeight: 600,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {sort && c.sortKey ? (
                  <Link
                    href={sort.href(c.sortKey)}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {c.header}
                    {arrow}
                  </Link>
                ) : (
                  c.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} style={rowStyle?.(row)}>
            {columns.map((c) => (
              <td
                key={c.key}
                style={{
                  textAlign: c.align ?? "left",
                  borderBottom: "1px solid var(--border)",
                  fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                }}
              >
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
}
