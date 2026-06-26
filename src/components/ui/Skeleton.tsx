import type { ReactNode } from "react";

/**
 * Shimmer placeholder block. Composed into route `loading.tsx` files so a
 * navigation shows structured loading feedback (sidebar stays put) instead of a
 * blank content column while the server component fetches.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = 6,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}): ReactNode {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}
