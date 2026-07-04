import { createHash, timingSafeEqual } from "crypto";
import { env } from "@/env";

/**
 * Bearer auth for the scheduled benchmark aggregator (/api/cron/aggregate-benchmarks).
 * Mirrors the playbook runner: compare a SHA-256 digest in constant time. The endpoint
 * is DISABLED unless BENCHMARK_AGGREGATOR_TOKEN is configured — no token, no access.
 */
export function authBenchmarkToken(req: Request): boolean {
  const configured = env.BENCHMARK_AGGREGATOR_TOKEN ?? "";
  if (!configured) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const a = createHash("sha256").update(m[1]!.trim()).digest();
  const b = createHash("sha256").update(configured).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
