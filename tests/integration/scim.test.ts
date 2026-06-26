import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * SCIM provisioning end-to-end against a real DB: token→tenant resolution,
 * create/list/get/deprovision (all tenant-scoped under the privileged path), and
 * the login bridge where a SCIM-provisioned user's `scim:` placeholder subject is
 * swapped for the real OIDC subject on first login.
 */

let db: TestDb;
let ops: typeof import("@/domain/scim/operations");
let provision: typeof import("@/auth/provision");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TOKEN_A = "scim_secret_token_for_tenant_a";

beforeAll(async () => {
  db = await setupTestDb();
  ops = await import("@/domain/scim/operations");
  provision = await import("@/auth/provision");

  const { withSystem } = db.client;
  const { tenants, ssoConfig } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    await tx.insert(ssoConfig).values({
      tenantId: tenantA,
      scimEnabled: true,
      scimTokenHash: ops.hashScimToken(TOKEN_A),
    });
    // Tenant B has a config row but SCIM disabled.
    await tx.insert(ssoConfig).values({
      tenantId: tenantB,
      scimEnabled: false,
      scimTokenHash: ops.hashScimToken("token-b-disabled"),
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("scim provisioning", () => {
  it("resolves a tenant from its bearer token; rejects unknown/disabled", async () => {
    expect(await ops.resolveScimTenant(TOKEN_A)).toBe(tenantA);
    expect(await ops.resolveScimTenant("nope")).toBeNull();
    expect(await ops.resolveScimTenant("token-b-disabled")).toBeNull(); // disabled
  });

  it("creates a user (idempotent on email)", async () => {
    const first = await ops.scimCreateUser(tenantA, { email: "Jo@Acme.test", active: true });
    expect(first.created).toBe(true);
    expect(first.user.email).toBe("jo@acme.test");
    expect(first.user.status).toBe("active");

    const again = await ops.scimCreateUser(tenantA, { email: "jo@acme.test", active: true });
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
  });

  it("lists + filters within the tenant only", async () => {
    const all = await ops.scimListUsers(tenantA, null);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const filtered = await ops.scimListUsers(tenantA, "jo@acme.test");
    expect(filtered).toHaveLength(1);
    // Tenant B can't see tenant A's user.
    expect(await ops.scimListUsers(tenantB, "jo@acme.test")).toHaveLength(0);
  });

  it("isolates get by tenant", async () => {
    const [u] = await ops.scimListUsers(tenantA, "jo@acme.test");
    expect(await ops.scimGetUser(tenantA, u!.id)).not.toBeNull();
    expect(await ops.scimGetUser(tenantB, u!.id)).toBeNull();
  });

  it("deprovisions via active:false (disables + bumps epoch)", async () => {
    const [u] = await ops.scimListUsers(tenantA, "jo@acme.test");
    const before = await db.client.withSystem((tx) =>
      tx.select({ e: db.schema.users.sessionEpoch }).from(db.schema.users).where(eq(db.schema.users.id, u!.id)),
    );
    const updated = await ops.scimSetActive(tenantA, u!.id, false);
    expect(updated!.status).toBe("disabled");
    const after = await db.client.withSystem((tx) =>
      tx.select({ e: db.schema.users.sessionEpoch }).from(db.schema.users).where(eq(db.schema.users.id, u!.id)),
    );
    expect(after[0]!.e).toBe(before[0]!.e + 1);
    // re-activate for the login-bridge test below
    await ops.scimSetActive(tenantA, u!.id, true);
  });

  it("links the real OIDC subject on first login (placeholder swapped)", async () => {
    const [u] = await ops.scimListUsers(tenantA, "jo@acme.test");
    const claims = await db.client.withSystem((tx) =>
      provision.provisionWithinTx(tx, { sub: "okta|jo-123", email: "jo@acme.test" }, false),
    );
    // Same row, now bound to the real subject and tenant A.
    expect(claims.uid).toBe(u!.id);
    expect(claims.tid).toBe(tenantA);
    expect(claims.sub).toBe("okta|jo-123");

    // A second login now matches by subject (the placeholder is gone).
    const again = await db.client.withSystem((tx) =>
      provision.provisionWithinTx(tx, { sub: "okta|jo-123", email: "jo@acme.test" }, false),
    );
    expect(again.uid).toBe(u!.id);
  });
});
