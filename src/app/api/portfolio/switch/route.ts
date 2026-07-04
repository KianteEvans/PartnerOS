import { NextResponse } from "next/server";
import { tryGetServerIdentity, signSession, setSessionCookie } from "@/auth/session";
import { can } from "@/authz/permissions";
import { withSystem } from "@/db/client";
import { loadTenantMeta, ensureAgencyServiceUser } from "@/auth/agency";

/**
 * Portfolio "act as" switch (Bet C). An agency operator POSTs a managed workspace id;
 * we re-verify server-side that (a) their session tenant is an agency, (b) they hold
 * portfolio:manage, and (c) the target is actually managed by their agency, then mint
 * a fresh session bound to the CHILD workspace (with an `agency` return-context claim).
 * The entire existing app then operates on that workspace unchanged — acting-as is just
 * a different single-tenant session, so there is nothing tenant-specific to special-case.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const identity = await tryGetServerIdentity();
  if (!identity) return NextResponse.redirect(new URL("/", req.url), 303);
  // Nested act-as is disallowed — exit to the portfolio first.
  if (identity.actingAs) return NextResponse.redirect(new URL("/portfolio", req.url), 303);

  const agency = await loadTenantMeta(identity.tenantId);
  if (!agency?.isAgency || !can(identity.role, "portfolio:manage")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const form = await req.formData();
  const targetId = String(form.get("tenantId") ?? "");
  if (!targetId) return new NextResponse("Missing tenantId", { status: 400 });

  // The security boundary: the target must be managed by THIS agency.
  const target = await loadTenantMeta(targetId);
  if (!target || target.agencyId !== identity.tenantId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const svc = await withSystem((tx) => ensureAgencyServiceUser(tx, identity.tenantId, targetId));
  const token = await signSession({
    tid: targetId,
    uid: svc.id,
    sub: `agency:${identity.tenantId}`,
    email: identity.email,
    role: "admin",
    epoch: svc.epoch,
    agency: {
      tid: identity.tenantId,
      uid: identity.userId,
      email: identity.email,
      name: agency.name,
    },
  });
  await setSessionCookie(token);
  return NextResponse.redirect(new URL("/", req.url), 303);
}
