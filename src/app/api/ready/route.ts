import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { env } from "@/env";

/**
 * Readiness probe -- deeper than /api/health (liveness). Verifies every hard
 * runtime dependency this instance needs to serve traffic correctly: Postgres,
 * and (when configured, which production requires at boot) the Upstash Redis
 * rate-limit backend. Unauthenticated by design; exposes only coarse statuses,
 * never errors or tenant data. Use /api/health for container liveness and this
 * for load-balancer target health / pre-cutover checks.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkRedis(): Promise<"ok" | "skipped" | "failed"> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return "skipped";
  try {
    const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/ping`, {
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function GET(): Promise<NextResponse> {
  const [db, redis] = await Promise.all([
    withSystem((tx) => tx.execute(sql`select 1`))
      .then(() => "ok" as const)
      .catch(() => "failed" as const),
    checkRedis(),
  ]);
  const ready = db === "ok" && redis !== "failed";
  return NextResponse.json(
    { status: ready ? "ready" : "degraded", db, redis },
    { status: ready ? 200 : 503 },
  );
}
