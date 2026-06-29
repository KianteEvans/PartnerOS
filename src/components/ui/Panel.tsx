import type { ReactNode } from "react";
import { TONE_VAR, type Tone } from "@/components/ui/Badge";

/**
 * Shared surface primitive. Feature sections compose Panel/Table/Form/Drawer
 * rather than each owning bespoke layout (Rule 7).
 *
 * Optional `accent` (a semantic `Tone` or a raw colour like `var(--section-accent)`)
 * adds a top accent bar + colours the title — a restrained way to give a panel a
 * section or status identity. Default (no `accent`) is unchanged.
 */
export function Panel({
  title,
  actions,
  accent,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  accent?: Tone | string;
  children: ReactNode;
}): ReactNode {
  const accentColor = accent ? ((TONE_VAR as Record<string, string>)[accent] ?? accent) : undefined;
  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: accentColor ? `3px solid ${accentColor}` : "1px solid var(--border)",
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
          {title ? <h2 style={{ margin: 0, fontSize: 16, color: accentColor }}>{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
