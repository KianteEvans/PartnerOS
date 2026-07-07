import type { ReactNode } from "react";
import Link from "next/link";
import { isPathIncluded, type PackageTier } from "@/domain/packaging/catalog";

/**
 * Global footer. Sits at the bottom of the content column (which is a flex
 * column), so on short pages it anchors to the viewport bottom instead of
 * leaving the page feeling unfinished. Quick links point at real in-app routes,
 * and drop out of a package preview when their section is fenced.
 */
export function Footer({ year, previewTier = null }: { year: number; previewTier?: PackageTier | null }): ReactNode {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "16px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        color: "var(--muted)",
        fontSize: 12.5,
      }}
    >
      <span>
        © {year} PartnerOS · AWS Partner Operations
      </span>
      <nav style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/command" className="foot-link" style={footLink}>
          Command Center
        </Link>
        {isPathIncluded(previewTier, "/reports") && (
          <Link href="/reports" className="foot-link" style={footLink}>
            Reports
          </Link>
        )}
        <Link href="/settings" className="foot-link" style={footLink}>
          Settings
        </Link>
        <span style={{ opacity: 0.7 }}>v0.1.0</span>
      </nav>
    </footer>
  );
}

const footLink = {
  color: "var(--muted)",
  textDecoration: "none",
} as const;
