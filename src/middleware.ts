import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request security headers. The centerpiece is a nonce-based
 * Content-Security-Policy: no 'unsafe-inline' for scripts. Next.js reads the CSP
 * from the request header and stamps the nonce onto its own framework scripts;
 * the one app-level inline script (theme init, in the root layout) reads the
 * nonce from the `x-nonce` request header and sets it explicitly.
 *
 * Inline *style attributes* still require 'unsafe-inline' in style-src — the app
 * styles via inline `style={}` objects and CSP nonces don't apply to attributes.
 * `upgrade-insecure-requests` is intentionally omitted so local http dev works;
 * HSTS covers production over https.
 */
export function middleware(request: NextRequest): NextResponse {
  const isProd = process.env.NODE_ENV === "production";
  const nonce = btoa(crypto.randomUUID());
  // Production: strict nonce-based CSP (no 'unsafe-inline'/'unsafe-eval').
  // Development: Next's HMR/fast-refresh injects eval() + inline scripts, and the
  // per-request nonce can't be kept in sync across the dev RSC payload — the
  // mismatch aborts client hydration (drawers/buttons go dead). So in dev we
  // relax script-src to 'unsafe-inline' 'unsafe-eval' and skip the nonce; the
  // inline theme script then carries no nonce attribute (no SSR/client mismatch).
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`;
  const csp = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  // Expose the path to server components (App Router gives no server-side pathname
  // API) so shared primitives can scope their per-user collapse keys by section.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // Only expose the nonce in production; in dev the relaxed CSP needs none and a
  // present nonce would re-introduce the hydration mismatch.
  if (isProd) requestHeaders.set("x-nonce", nonce);
  // Next reads this to nonce its framework scripts.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  response.headers.set(
    "strict-transport-security",
    "max-age=63072000; includeSubDomains; preload",
  );
  return response;
}

export const config = {
  // Run on documents/APIs; skip static assets and image files (no inline content).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)",
  ],
};
