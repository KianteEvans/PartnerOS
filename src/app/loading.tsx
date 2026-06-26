import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Default Suspense fallback for the whole app segment. Shown during route
 * navigations while a server component loads — the persistent sidebar stays
 * mounted and the content column shows a header + panel skeleton.
 */
export default function Loading(): ReactNode {
  return (
    <PageShell>
      <div style={{ display: "grid", gap: 10 }}>
        <Skeleton width={220} height={26} />
        <Skeleton width={340} height={14} />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 20,
            boxShadow: "var(--shadow)",
            display: "grid",
            gap: 12,
          }}
        >
          <Skeleton width={150} height={16} />
          <Skeleton height={12} />
          <Skeleton height={12} width="82%" />
          <Skeleton height={12} width="55%" />
        </div>
      ))}
    </PageShell>
  );
}
