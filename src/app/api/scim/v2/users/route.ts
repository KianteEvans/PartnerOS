import type { NextResponse } from "next/server";
import { authScimTenant, scimBaseUrl, scimJson, scimUnauthorized } from "@/domain/scim/auth";
import { scimCreateUser, scimListUsers } from "@/domain/scim/operations";
import {
  scimUserResource,
  scimListResponse,
  scimError,
  parseScimCreate,
  parseUserNameFilter,
} from "@/domain/scim/mapping";

/** SCIM 2.0 /Users collection: create (provision) + list/filter. */

export async function POST(req: Request): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body"), 400);
  }
  const { email, active } = parseScimCreate(body);
  if (!email) return scimJson(scimError(400, "userName (email) is required"), 400);

  const { user, created } = await scimCreateUser(tenantId, { email, active });
  return scimJson(scimUserResource(user, scimBaseUrl(req)), created ? 201 : 200);
}

export async function GET(req: Request): Promise<NextResponse> {
  const tenantId = await authScimTenant(req);
  if (!tenantId) return scimUnauthorized();

  const filter = parseUserNameFilter(new URL(req.url).searchParams.get("filter"));
  const rows = await scimListUsers(tenantId, filter);
  const base = scimBaseUrl(req);
  return scimJson(scimListResponse(rows.map((u) => scimUserResource(u, base)), rows.length));
}
