import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Shared button primitive — one place for the variant styling that was hand-rolled
 * inline across pages (CTAs, pills, MutationForm). `Button` renders a <button>
 * (forms / client onClick); `ButtonLink` renders a Next <Link> (or a plain <a> for
 * external/auth routes) with the same look, so server components can deep-link.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

function buttonStyle(variant: ButtonVariant, size: ButtonSize, fullWidth?: boolean): CSSProperties {
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)", boxShadow: "var(--shadow-sm)" },
    secondary: { background: "var(--panel)", color: "var(--text)", borderColor: "var(--border)" },
    ghost: { background: "transparent", color: "var(--muted)", borderColor: "transparent" },
    danger: {
      background: "color-mix(in srgb, var(--danger) 12%, transparent)",
      color: "var(--danger)",
      borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)",
    },
  };
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontWeight: 600,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
    fontSize: size === "sm" ? 12 : 13,
    padding: size === "sm" ? "5px 11px" : "8px 16px",
    width: fullWidth ? "100%" : undefined,
    ...variants[variant],
  };
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  fullWidth = false,
  onClick,
  children,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...buttonStyle(variant, size, fullWidth), opacity: disabled ? 0.6 : 1 }}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  fullWidth = false,
  external = false,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  external?: boolean;
  children: ReactNode;
}): ReactNode {
  const style = buttonStyle(variant, size, fullWidth);
  return external ? (
    <a href={href} style={style}>
      {children}
    </a>
  ) : (
    <Link href={href} style={style}>
      {children}
    </Link>
  );
}
