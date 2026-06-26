import type { ReactNode } from "react";

/**
 * GET search box for server-side list filtering. Submitting reloads the page
 * with `?q=…`; the current sort is preserved via hidden fields and the page
 * resets to 1 (no `page` field). Pairs with `parseListParams` on the server.
 */
export function SearchForm({
  q,
  placeholder = "Search…",
  hidden,
}: {
  q: string;
  placeholder?: string;
  hidden?: Readonly<Record<string, string>>;
}): ReactNode {
  return (
    <form method="get" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        aria-label="Search"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "6px 10px",
          color: "var(--text)",
          fontSize: 13,
          minWidth: 220,
        }}
      />
      <button
        type="submit"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 13,
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        Search
      </button>
      {q && (
        <a href="?" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
          Clear
        </a>
      )}
    </form>
  );
}
