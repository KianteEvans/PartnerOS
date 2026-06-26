/**
 * SCIM 2.0 (RFC 7643/7644) serialization + payload parsing — pure and
 * unit-tested. We expose the `users` table as SCIM Users: `userName` is the
 * email, `active` mirrors status. There's no separate display-name column, so
 * `name`/`displayName` on input are accepted but not persisted.
 */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export interface ScimUserRow {
  readonly id: string;
  readonly email: string;
  readonly status: "active" | "disabled";
  readonly createdAt: Date;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Map a user row to a SCIM User resource. */
export function scimUserResource(u: ScimUserRow, baseUrl: string): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    userName: u.email,
    active: u.status === "active",
    emails: [{ value: u.email, primary: true }],
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      location: `${baseUrl}/Users/${u.id}`,
    },
  };
}

/** Wrap resources in a SCIM ListResponse. */
export function scimListResponse(
  resources: ReadonlyArray<Record<string, unknown>>,
  total: number,
  startIndex = 1,
): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/** A SCIM error envelope. */
export function scimError(status: number, detail: string): Record<string, unknown> {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail };
}

/**
 * Parse a SCIM `filter` of the form `userName eq "value"` (the only filter IdPs
 * use to check existence before create). Returns the lowercased value, or null.
 */
export function parseUserNameFilter(filter: string | null | undefined): string | null {
  if (!filter) return null;
  const m = /^\s*userName\s+eq\s+"(.+)"\s*$/i.exec(filter);
  return m ? m[1]!.trim().toLowerCase() : null;
}

/** Pull the email (from userName or a primary email) + active out of a create body. */
export function parseScimCreate(body: unknown): { email: string; active: boolean } {
  const b = asRecord(body);
  const userName = typeof b.userName === "string" ? b.userName : "";
  let primaryEmail = "";
  if (Array.isArray(b.emails)) {
    const chosen =
      b.emails.find((e) => asRecord(e).primary === true) ?? b.emails[0];
    const value = asRecord(chosen).value;
    if (typeof value === "string") primaryEmail = value;
  }
  const email = (userName || primaryEmail).trim().toLowerCase();
  const active = b.active === undefined ? true : Boolean(b.active);
  return { email, active };
}

/**
 * From a SCIM PatchOp body, the new `active` value if some op sets it — handling
 * both `{op:"replace", path:"active", value:false}` and the path-less
 * `{op:"replace", value:{active:false}}` that Okta/Azure send to deprovision.
 */
export function parseScimPatchActive(body: unknown): boolean | undefined {
  const ops = asRecord(body).Operations;
  if (!Array.isArray(ops)) return undefined;
  for (const raw of ops) {
    const op = asRecord(raw);
    if (typeof op.op !== "string" || op.op.toLowerCase() !== "replace") continue;
    const path = typeof op.path === "string" ? op.path.toLowerCase() : "";
    if (path === "active") return Boolean(op.value);
    if (path === "") {
      const val = asRecord(op.value);
      if ("active" in val) return Boolean(val.active);
    }
  }
  return undefined;
}
