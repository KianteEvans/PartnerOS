import type { ReactNode } from "react";
import { TONE_VAR, type Tone } from "@/components/ui/Badge";
import { CollapsibleSection } from "@/components/ui/Collapsible";
import { resolveCollapse } from "@/domain/ui/collapse-server";
import { slugify } from "@/domain/ui/collapse";

/**
 * Shared surface primitive. Feature sections compose Panel/Table/Form/Drawer
 * rather than each owning bespoke layout (Rule 7).
 *
 * Optional `accent` (a semantic `Tone` or a raw colour like `var(--section-accent)`)
 * adds a top accent bar + colours the title — a restrained way to give a panel a
 * section or status identity. Default (no `accent`) is unchanged.
 *
 * Titled panels are collapsible by default: the header toggles the body, and the
 * collapsed/expanded state persists per user (section-scoped cookie), rendered
 * flash-free from the server. The body is hidden (not unmounted) so forms keep
 * their state. Pass `collapsible={false}` to opt a panel out; headerless panels
 * (no `title`) are never collapsible.
 */
export async function Panel({
  title,
  actions,
  accent,
  id,
  collapsible,
  collapseKey,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  accent?: Tone | string;
  /** Anchor target (e.g. deep links like /ace/<id>#case-studies). */
  id?: string;
  /** Default true when a title is present. */
  collapsible?: boolean;
  /** Override the auto-derived (section-scoped) collapse key. */
  collapseKey?: string;
  children: ReactNode;
}): Promise<ReactNode> {
  const accentColor = accent ? ((TONE_VAR as Record<string, string>)[accent] ?? accent) : undefined;
  const canCollapse = (collapsible ?? true) && Boolean(title);
  const state = canCollapse ? await resolveCollapse(slugify(title as string), collapseKey) : null;

  return (
    <section
      id={id}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: accentColor ? `3px solid ${accentColor}` : "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        boxShadow: "var(--shadow)",
      }}
    >
      {state ? (
        <CollapsibleSection
          collapseKey={state.key}
          initialCollapsed={state.collapsed}
          title={title as string}
          accentColor={accentColor}
          actions={actions}
        >
          {children}
        </CollapsibleSection>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}
