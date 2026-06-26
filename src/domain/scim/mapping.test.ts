import { describe, it, expect } from "vitest";
import {
  scimUserResource,
  scimListResponse,
  scimError,
  parseUserNameFilter,
  parseScimCreate,
  parseScimPatchActive,
  SCIM_USER_SCHEMA,
} from "@/domain/scim/mapping";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "jo@acme.test",
  status: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("scim mapping", () => {
  it("serializes a user resource", () => {
    const r = scimUserResource(row, "https://x/scim/v2");
    expect(r.schemas).toEqual([SCIM_USER_SCHEMA]);
    expect(r.id).toBe(row.id);
    expect(r.userName).toBe("jo@acme.test");
    expect(r.active).toBe(true);
    expect(r.emails).toEqual([{ value: "jo@acme.test", primary: true }]);
    expect((r.meta as Record<string, unknown>).location).toBe(`https://x/scim/v2/Users/${row.id}`);
  });

  it("reflects disabled status as active:false", () => {
    expect(scimUserResource({ ...row, status: "disabled" }, "https://x").active).toBe(false);
  });

  it("wraps a list response", () => {
    const list = scimListResponse([scimUserResource(row, "https://x")], 1);
    expect(list.totalResults).toBe(1);
    expect(list.itemsPerPage).toBe(1);
    expect(Array.isArray(list.Resources)).toBe(true);
  });

  it("builds an error envelope", () => {
    const e = scimError(404, "Not found");
    expect(e.status).toBe("404");
    expect(e.detail).toBe("Not found");
  });

  it("parses a userName eq filter (case-insensitive, lowercased value)", () => {
    expect(parseUserNameFilter('userName eq "Jo@Acme.test"')).toBe("jo@acme.test");
    expect(parseUserNameFilter('USERNAME EQ "x@y.z"')).toBe("x@y.z");
    expect(parseUserNameFilter("displayName eq \"x\"")).toBeNull();
    expect(parseUserNameFilter(null)).toBeNull();
  });

  it("extracts email + active from a create payload (userName preferred)", () => {
    expect(parseScimCreate({ userName: "New@Acme.test", active: true })).toEqual({
      email: "new@acme.test",
      active: true,
    });
    expect(
      parseScimCreate({ emails: [{ value: "a@b.co", primary: false }, { value: "p@b.co", primary: true }] }),
    ).toEqual({ email: "p@b.co", active: true });
    expect(parseScimCreate({ userName: "x@y.z", active: false }).active).toBe(false);
  });

  it("reads the active value from both PatchOp shapes", () => {
    expect(
      parseScimPatchActive({ Operations: [{ op: "replace", path: "active", value: false }] }),
    ).toBe(false);
    expect(
      parseScimPatchActive({ Operations: [{ op: "Replace", value: { active: false } }] }),
    ).toBe(false);
    expect(
      parseScimPatchActive({ Operations: [{ op: "replace", value: { active: true } }] }),
    ).toBe(true);
    expect(parseScimPatchActive({ Operations: [{ op: "add", path: "nickName", value: "x" }] })).toBeUndefined();
    expect(parseScimPatchActive({})).toBeUndefined();
  });
});
