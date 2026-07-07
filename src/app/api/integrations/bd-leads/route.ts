import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { asc, gt } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { demoRequests } from "@/db/schema";
import { env } from "@/env";

/**
 * Read-only inbound-lead feed for the standalone BDAgent app (OBP's internal BD
 * tool, extracted from here). BDAgent pulls new "Book a demo" leads — cursor-based
 * via ?since=<iso>, ordered oldest-first — and imports them into its own pipeline.
 *
 * Bearer-token auth (BD_SYNC_TOKEN, constant-time compare). demo_requests is the
 * tenant-free marketing table, read via withSystem. NO writes: the feed never
 * mutates PartnerOS state, so BDAgent advancing its own cursor makes a re-pull a
 * safe, idempotent no-op. Disabled (401) when BD_SYNC_TOKEN is unset.
 */
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const configured = env.BD_SYNC_TOKEN ?? "";
  if (!configured) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1]!.trim()).digest();
  const b = createHash("sha256").update(configured).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const rows = await withSystem((tx) =>
    tx
      .select({
        id: demoRequests.id,
        name: demoRequests.name,
        email: demoRequests.email,
        company: demoRequests.company,
        teamSize: demoRequests.teamSize,
        message: demoRequests.message,
        createdAt: demoRequests.createdAt,
      })
      .from(demoRequests)
      .where(validSince ? gt(demoRequests.createdAt, validSince) : undefined)
      .orderBy(asc(demoRequests.createdAt))
      .limit(200),
  );

  return NextResponse.json({
    leads: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      teamSize: r.teamSize,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
