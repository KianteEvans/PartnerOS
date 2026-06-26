import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env";

/**
 * Rate limiting. Production uses Upstash Redis (Rule 5: real adapter). Local dev
 * uses an in-memory adapter so the same code path runs without external infra —
 * but ONLY under PARTNEROS_LOCAL_DEV; production refuses to boot without real
 * Redis (enforced in env.ts).
 */

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number; // epoch ms
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

/** Fixed-window in-memory limiter for local dev / tests. Process-local only. */
class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async limit(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.hits.get(identifier);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.hits.set(identifier, { count: 1, resetAt });
      return { success: true, limit: this.max, remaining: this.max - 1, resetAt };
    }
    existing.count += 1;
    const remaining = Math.max(0, this.max - existing.count);
    return {
      success: existing.count <= this.max,
      limit: this.max,
      remaining,
      resetAt: existing.resetAt,
    };
  }
}

class UpstashRateLimiter implements RateLimiter {
  private readonly rl: Ratelimit;
  constructor(max: number, windowSeconds: number) {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL as string,
      token: env.UPSTASH_REDIS_REST_TOKEN as string,
    });
    this.rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: "partneros:rl",
      analytics: false,
    });
  }

  async limit(identifier: string): Promise<RateLimitResult> {
    const r = await this.rl.limit(identifier);
    return {
      success: r.success,
      limit: r.limit,
      remaining: r.remaining,
      resetAt: r.reset,
    };
  }
}

/**
 * Build a limiter. Picks the real adapter when Redis is configured, otherwise
 * the in-memory adapter (allowed only because env.ts forbids missing Redis in
 * production).
 */
export function createRateLimiter(opts: {
  max: number;
  windowSeconds: number;
}): RateLimiter {
  const hasRedis =
    !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN;
  if (hasRedis) return new UpstashRateLimiter(opts.max, opts.windowSeconds);
  return new InMemoryRateLimiter(opts.max, opts.windowSeconds * 1000);
}

// Default limiter for the mutation gate: 60 mutations / 60s per actor.
export const mutationRateLimiter = createRateLimiter({
  max: 60,
  windowSeconds: 60,
});

// Dedicated limiter for the in-app AI assistant ("Ask AWS"): 10 questions / 60s
// per actor. Tighter than the mutation pool because each call hits a paid API.
export const aiAssistantRateLimiter = createRateLimiter({
  max: 10,
  windowSeconds: 60,
});

// Dedicated limiter for the optional AI evidence evaluator: 10 evaluations / 60s
// per actor. Same paid-API rationale as the assistant; kept separate so one can't
// starve the other.
export const evidenceEvalRateLimiter = createRateLimiter({
  max: 10,
  windowSeconds: 60,
});

// Dedicated limiter for AI competency-application response drafting: 10 / 60s per
// actor. "Generate all" iterates a whole workbook (~40-60 controls) one control at
// a time client-side, backing off on a 429 from this limiter.
export const competencyGenRateLimiter = createRateLimiter({
  max: 10,
  windowSeconds: 60,
});

// Dedicated limiter for the optional AI competency-recommendation narrative: 10 / 60s
// per actor. One call summarizes the whole ranked list; same paid-API rationale.
export const recommendNarrativeRateLimiter = createRateLimiter({
  max: 10,
  windowSeconds: 60,
});
