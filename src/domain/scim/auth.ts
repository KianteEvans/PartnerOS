import { NextResponse } from "next/server";
import { resolveScimTenant } from "@/domain/scim/operations";
import { scimError } from "@/domain/scim/mapping";

/** Resolve the `Authorization: Bearer <token>` to a tenant id, or null. */
export async function authScimTenant(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  return resolveScimTenant(m[1]!.trim());
}

/** The SCIM base URL for `meta.location`, derived from the request origin. */
export function scimBaseUrl(req: Request): string {
  return `${new URL(req.url).origin}/api/scim/v2`;
}

/** A SCIM JSON response with the spec content type. */
export function scimJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/scim+json" },
  });
}

/** A fresh 401 each call — a Response body can only be consumed once. */
export function scimUnauthorized(): NextResponse {
  return scimJson(scimError(401, "Invalid or missing bearer token"), 401);
}
