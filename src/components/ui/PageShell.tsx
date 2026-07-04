import type { ReactNode } from "react";

/**
 * The single page container. Every route renders its content inside one
 * PageShell so max-width, horizontal centering, page padding, and the
 * vertical rhythm between sections are identical across the app (Rule 7) —
 * instead of each page hand-rolling its own `<main>` with a different
 * `maxWidth`/padding. `width` narrows the column for reading-oriented
 * detail/form pages; the default suits list and dashboard surfaces.
 */
export function PageShell({
  children,
  width = 1040,
}: {
  children: ReactNode;
  width?: number;
}): ReactNode {
  return (
    <main
      style={{
        // Container-relative cap (the column lives next to the fixed sidebar, so a
        // vw-based width would ignore the rail and overflow); horizontal padding is
        // fluid so narrow viewports don't waste edge space. box-sizing is border-box.
        maxWidth: width,
        margin: "0 auto",
        padding: "var(--space-8) clamp(16px, 4vw, var(--space-6))",
        display: "grid",
        gap: "var(--space-5)",
        alignContent: "start",
      }}
    >
      {children}
    </main>
  );
}
