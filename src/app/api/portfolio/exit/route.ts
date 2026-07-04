import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { tryGetServerIdentity, signSession, setSessionCookie } from "@/auth/session";
import { withSystem } from "@/db/client";
import { users } from "@/db/schema";

/**
 * Exit an "act as" session back to the agency portfolio (Bet C). Rebuilds the
 * operator's ordinary session from the `agency.uid` carried in the acting-as claim,
 * then redirects to /portfolio. Safe to call when not acting-as (no-op redirect).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const identity = await tryGetServerIdentity();
  if (!identity) return NextResponse.redirect(new URL("/", req.url), 303);
  if (!identity.actingAs) return NextResponse.redirect(new URL("/", req.url), 303);

  const operatorId = identity.actingAs.agencyUserId;
  const op = await withSystem(async (tx) => {
    const [u] = await tx
      .select({
        id: users.id,
        tenantId: users.tenantId,
        oidcSubject: users.oidcSubject,
        email: users.email,
        role: users.role,
        epoch: users.sessionEpoch,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, operatorId))
      .limit(1);
    return u ?? null;
  });
  // Operator vanished or was disabled while acting-as: force a clean re-login.
  if (!op || op.status !== "active") {
    return NextResponse.redirect(new URL("/api/auth/logout", req.url), 303);
  }

  const token = await signSession({
    tid: op.tenantId,
    uid: op.id,
    sub: op.oidcSubject,
    email: op.email,
    role: op.role,
    epoch: op.epoch,
  });
  await setSessionCookie(token);
  return NextResponse.redirect(new URL("/portfolio", req.url), 303);
}
