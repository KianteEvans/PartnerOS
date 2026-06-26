import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

/**
 * The PartnerOS brand mark: the icon (reads on the dark theme) + a light
 * "Partner" / accent "OS" wordmark echoing the logo. Links to the home root.
 * The full-lockup PNG uses dark navy text, so on the dark UI we pair the icon
 * with light text instead.
 */
export function Brand({
  size = 30,
  iconOnly = false,
}: {
  size?: number;
  iconOnly?: boolean;
}): ReactNode {
  const width = Math.round((190 / 228) * size); // icon is 190×228
  return (
    <Link
      href="/"
      aria-label="PartnerOS home"
      style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}
    >
      <Image src="/partneros-icon.png" alt="" width={width} height={size} priority style={{ display: "block" }} />
      {!iconOnly && (
        <span
          style={{
            fontSize: Math.round(size * 0.62),
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--text)",
          }}
        >
          Partner<span style={{ color: "var(--accent)" }}>OS</span>
        </span>
      )}
    </Link>
  );
}
