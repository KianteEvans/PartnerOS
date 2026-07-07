import type { ReactNode } from "react";
import { PACKAGE_META, type PackageTier } from "@/domain/packaging/catalog";
import { clearPackagePreview } from "@/domain/packaging/preview-actions";

/**
 * Persistent strip shown while the signed-in user is previewing the platform
 * as a service package (Settings -> Package preview). Cookie-scoped to this
 * user only. A plain server-action form so the exit works without client JS.
 */
export function PackagePreviewBanner({ tier }: { tier: PackageTier }): ReactNode {
  const meta = PACKAGE_META[tier];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        background: "color-mix(in srgb, var(--accent-2) 13%, var(--panel))",
        borderBottom: "1px solid color-mix(in srgb, var(--accent-2) 32%, var(--border))",
        padding: "8px 16px",
        fontSize: 13,
      }}
    >
      <span>
        Previewing as <strong>{meta.label}</strong>{" "}
        <span style={{ color: "var(--muted)" }}>
          · {meta.stage} stage · features outside this package are hidden — only you see this
        </span>
      </span>
      <form action={clearPackagePreview} style={{ margin: 0 }}>
        <button
          type="submit"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--accent-2)",
            background: "transparent",
            border: "1px solid color-mix(in srgb, var(--accent-2) 42%, transparent)",
            borderRadius: 999,
            padding: "3px 12px",
            cursor: "pointer",
          }}
        >
          Exit preview →
        </button>
      </form>
    </div>
  );
}
