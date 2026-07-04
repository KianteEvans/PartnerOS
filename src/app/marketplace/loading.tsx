import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Loading fallback for the whole AWS Marketplace subtree. Mirrors the section
 * layout — header + tab row + hero band (ring + KPI cards) + a table panel — so a
 * tab switch shows structured placeholders instead of a blank content column.
 */
const panel = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
  boxShadow: "var(--shadow)",
} as const;

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <div style={{ display: "grid", gap: 10 }}>
        <Skeleton width={240} height={26} />
        <Skeleton width={360} height={14} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} width={120} height={44} radius={10} />
        ))}
      </div>

      <div style={{ ...panel, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <Skeleton width={120} height={120} radius={999} />
        <div
          style={{
            flex: 1,
            minWidth: 244,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
            gap: 12,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "grid", gap: 8 }}>
              <Skeleton width="60%" height={11} />
              <Skeleton width="80%" height={22} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...panel, display: "grid", gap: 12 }}>
        <Skeleton width={160} height={16} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={12} width={`${92 - i * 7}%`} />
        ))}
      </div>
    </PageShell>
  );
}
