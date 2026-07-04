import { NextResponse } from "next/server";
import { authBenchmarkToken } from "@/domain/benchmarks/cron-auth";
import { aggregateBenchmarks } from "@/domain/benchmarks/aggregate";

/**
 * Scheduled cross-tenant benchmark aggregator (Bet B). An external scheduler
 * (cron / EventBridge) POSTs here with the bearer token; we roll every opted-in
 * tenant's latest metric_snapshot into anonymized, k-anonymized cohort
 * percentiles for today. Runs system-level (withSystem) because it must read
 * across all tenants — which is exactly what makes peer benchmarking impossible
 * for ACE (single-account by construction).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!authBenchmarkToken(req)) return new NextResponse("Unauthorized", { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  const result = await aggregateBenchmarks(today);
  return NextResponse.json({ ok: true, ...result });
}
