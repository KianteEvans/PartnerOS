import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { savedViews } from "@/db/schema";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { RemoveViewButton } from "@/components/ui/RemoveViewButton";
import { saveView } from "@/domain/views/actions";
import { normalizeViewQuery, savedViewHref } from "@/domain/views/saved";

const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
} as const;

/**
 * Per-user saved-view chips for a list page. Drop in next to the SearchForm with
 * the page's current params; it fetches the user's presets for `listKey`, renders
 * each as an apply-link chip (active when it matches the current params) with a
 * compact remove control, plus a "Save view" drawer that captures the current
 * filter/sort. Server component — only the remove ✕ and the save form are client.
 */
export async function SavedViewsBar({
  listKey,
  current,
}: {
  listKey: string;
  current: Record<string, string | undefined>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) return null;

  const views = await withTenant(identity, (tx) =>
    tx
      .select({ id: savedViews.id, name: savedViews.name, query: savedViews.query })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.tenantId, identity.tenantId),
          eq(savedViews.userId, identity.userId),
          eq(savedViews.listKey, listKey),
        ),
      )
      .orderBy(asc(savedViews.name)),
  );

  const currentQuery = normalizeViewQuery(current);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>Views</span>

      {views.map((v) => {
        const active = v.query === currentQuery;
        return (
          <span
            key={v.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 4px 2px 10px",
              background: active ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
            }}
          >
            <Link
              href={savedViewHref(listKey, v.query)}
              style={{
                fontSize: 13,
                textDecoration: "none",
                color: active ? "var(--accent)" : "var(--text)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {v.name}
            </Link>
            <RemoveViewButton id={v.id} listKey={listKey} />
          </span>
        );
      })}

      <FormDrawer
        triggerLabel="Save view"
        triggerVariant="secondary"
        title="Save current view"
        action={saveView}
        submitLabel="Save view"
        successMessage="View saved."
        submitVariant="secondary"
        hidden={{ listKey, query: currentQuery }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>View name</span>
          <input name="name" required maxLength={80} placeholder="e.g. My overdue" style={controlStyle} />
        </label>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
          Saves the current filter, search, and sort. Private to you — re-using a
          name overwrites it.
        </p>
      </FormDrawer>
    </div>
  );
}
