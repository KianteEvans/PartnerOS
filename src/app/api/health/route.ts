import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

/**
 * Liveness + readiness probe for the load balancer / orchestrator (ALB target
 * group, ECS/Fargate container health check). Unauthenticated by design — it
 * exposes only a coarse status, never tenant data.
 *
 * A cheap `SELECT 1` confirms the app can reach Postgres, the one hard runtime
 * dependency. If that fails we answer 503 so the orchestrator pulls this task
 * out of rotation (and stops routing user traffic to it) instead of letting it
 * serve 500s. Kept dynamic + uncached so every probe reflects live state.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    await withSystem((tx) => tx.execute(sql`select 1`));
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    // Deliberately opaque: never leak the DB error to an unauthenticated caller.
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
