import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Loading fallback for a listing detail. Narrower (920) to match the page; shows a
 * breadcrumb + title, the status hero band, and two panel placeholders.
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
    <PageShell width={920}>
      <div style={{ display: "grid", gap: 10 }}>
        <Skeleton width={150} height={12} />
        <Skeleton width={300} height={26} />
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

      {[0, 1].map((i) => (
        <div key={i} style={{ ...panel, display: "grid", gap: 12 }}>
          <Skeleton width={150} height={16} />
          <Skeleton height={12} />
          <Skeleton height={12} width="70%" />
        </div>
      ))}
    </PageShell>
  );
}
