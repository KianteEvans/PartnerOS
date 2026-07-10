/**
 * Next.js instrumentation hooks (server boot + global server-error capture).
 *
 * register() runs once per server process: it logs the effective security
 * posture as one structured line (so an operator can see, in the logs, exactly
 * which hardening is engaged) and fails fast if a deployed runtime would serve
 * relaxed dev semantics. env.ts enforces the same invariants at import time;
 * this is the belt-and-braces runtime assertion the readiness audit called for.
 *
 * onRequestError() is Next's global hook for server-side errors (RSC render,
 * server actions, route handlers). It emits a structured JSON line carrying the
 * same digest the user sees on the error boundary ("Reference: ..."), so an
 * operator can correlate a user report with the full server error.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/env");
  const { log } = await import("@/observability/logger");

  const secureCookies = !env.IS_LOCAL_DEV;
  const strictCsp = process.env.NODE_ENV === "production";
  log.info("boot.config", {
    deployed: env.IS_DEPLOYED,
    localDev: env.IS_LOCAL_DEV,
    nodeEnv: process.env.NODE_ENV,
    secureCookies,
    strictCsp,
    redis: Boolean(env.UPSTASH_REDIS_REST_URL),
    errorReporting: Boolean(env.ERROR_REPORT_URL),
  });

  if (env.IS_DEPLOYED && (!secureCookies || !strictCsp)) {
    throw new Error(
      "FATAL: deployed runtime without secure cookies and strict CSP. " +
        "Ensure NODE_ENV=production and PARTNEROS_LOCAL_DEV is unset.",
    );
  }
}

export async function onRequestError(
  err: unknown,
  request: { readonly path: string; readonly method: string },
  context: { readonly routePath: string; readonly routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("@/observability/logger");
  const e = err as { message?: string; digest?: string } | null;
  log.error("request.error", {
    digest: e?.digest ?? null,
    message: e?.message ?? String(err),
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
  });
}
