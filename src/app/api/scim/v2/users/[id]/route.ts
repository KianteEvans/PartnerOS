import { NextResponse } from "next/server";
import { authScimTenant, scimBaseUrl, scimJson, scimUnauthorized } from "@/domain/scim/auth";
import { scimGetUser, scimSetActive } from "@/domain/scim/operations";
import { scimUserResource, scimError, parseScimPatchActive } from "@/domain/scim/mapping";

/** SCIM 2.0 /Users/{id}: read, PATCH/PUT (active), DELETE (= deprovision). */

type Ctx = { params: Promise<{ id: string }> };

function bodyActive(body: unknown): boolean {
  const b = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return b.active === undefined ? true : Boolean(b.active);
}

export async function GET(req: Request, ctx: Ctx): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();
  const { id } = await ctx.params;
  const u = await scimGetUser(tenantId, id);
  if (!u) return scimJson(scimError(404, "User not found"), 404);
  return scimJson(scimUserResource(u, scimBaseUrl(req)));
}

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body"), 400);
  }
  const active = parseScimPatchActive(body);
  // Only `active` toggles are supported; any other op is a no-op echo.
  const u =
    active === undefined
      ? await scimGetUser(tenantId, id)
      : await scimSetActive(tenantId, id, active);
  if (!u) return scimJson(scimError(404, "User not found"), 404);
  return scimJson(scimUserResource(u, scimBaseUrl(req)));
}

export async function PUT(req: Request, ctx: Ctx): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body"), 400);
  }
  const u = await scimSetActive(tenantId, id, bodyActive(body));
  if (!u) return scimJson(scimError(404, "User not found"), 404);
  return scimJson(scimUserResource(u, scimBaseUrl(req)));
}

export async function DELETE(req: Request, ctx: Ctx): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();
  const { id } = await ctx.params;
  // Deprovision = deactivate (keep the row for audit + work-product attribution).
  const u = await scimSetActive(tenantId, id, false);
  if (!u) return scimJson(scimError(404, "User not found"), 404);
  return new NextResponse(null, { status: 204 });
}
