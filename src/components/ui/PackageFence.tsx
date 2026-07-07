import type { ReactNode } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Callout } from "@/components/ui/Callout";
import {
  FEATURE_LABELS,
  PACKAGE_META,
  requiredTier,
  type FeatureKey,
  type PackageTier,
} from "@/domain/packaging/catalog";
import { clearPackagePreview } from "@/domain/packaging/preview-actions";

/**
 * Full-page upgrade screen rendered when a package preview fences a section.
 * Packaging doctrine: fences resolve to upgrade screens, never 404s or errors
 * (docs/service-packages.md, standing rules). Pages return this instead of
 * their content when `packageFenceFor(feature)` reports the preview tier.
 */
export function PackageFence({
  feature,
  previewTier,
}: {
  feature: FeatureKey;
  previewTier: PackageTier;
}): ReactNode {
  const required = PACKAGE_META[requiredTier(feature)];
  const previewing = PACKAGE_META[previewTier];
  return (
    <PageShell>
      <PageHeader
        title={FEATURE_LABELS[feature]}
        subtitle={`Included in the ${required.label} package.`}
      />
      <Panel>
        <div style={{ display: "grid", gap: 12 }}>
          <Callout tone="info" title={`Part of ${required.label} (${required.stage} stage)`}>
            You&rsquo;re previewing the <strong>{previewing.label}</strong> package, which doesn&rsquo;t
            include {FEATURE_LABELS[feature]}. A real {previewing.label} workspace would see this
            screen as its upgrade path.
          </Callout>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link
              href="/settings?section=general"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Change preview →
            </Link>
            <form action={clearPackagePreview} style={{ margin: 0 }}>
              <button
                type="submit"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--accent-2)",
                  background: "transparent",
                  border: "1px solid color-mix(in srgb, var(--accent-2) 42%, transparent)",
                  borderRadius: 999,
                  padding: "4px 14px",
                  cursor: "pointer",
                }}
              >
                Exit preview →
              </button>
            </form>
          </div>
        </div>
      </Panel>
    </PageShell>
  );
}
