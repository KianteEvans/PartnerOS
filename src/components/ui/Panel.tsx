import type { ReactNode } from "react";

/**
 * Shared surface primitive. Feature sections compose Panel/Table/Form/Drawer
 * rather than each owning bespoke layout (Rule 7).
 */
export function Panel({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        boxShadow: "var(--shadow)",
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          {title ? <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
