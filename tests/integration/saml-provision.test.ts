import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * SAML provisioning is TENANT-SCOPED (the assertion came from one tenant's IdP).
 * Asserts the relink/invite/returning paths bind only within the tenant — a
 * shared email in another workspace is never matched — plus the config save op.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let provision: typeof import("@/auth/provision");
let sso: typeof import("@/domain/sso/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let scimUserA = ""; // scim-provisioned in A, email shared@corp.test
const SHARED = "shared@corp.test";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@t`, role: "owner" as const };
}
function runAs<T>(id: ReturnType<typeof identity>, permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "saml.test", resourceType: "sso_config", handler },
    { resolveIdentity: async () => id },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  provision = await import("@/auth/provision");
  sso = await import("@/domain/sso/operations");

  const { withSystem } = db.client;
  const { tenants, users, invitations } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "scim:placeholder-1", email: SHARED, role: "member" },
        // SAME email exists as a real user in tenant B — must never be matched by A's SAML.
        { tenantId: tenantB, oidcSubject: "okta|b-real", email: SHARED, role: "member" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    scimUserA = ins.find((u) => u.sub === "scim:placeholder-1")!.id;
    await tx.insert(invitations).values({ tenantId: tenantA, email: "invitee@acme.test", role: "manager", token: "tok-1" });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("SAML provisioning (tenant-scoped)", () => {
  it("binds a SAML login to the SCIM user in the SAME tenant, never another's", async () => {
    const claims = await db.client.withSystem((tx) =>
      provision.provisionSamlWithinTx(tx, tenantA, { sub: `saml:${tenantA}:nameid-1`, email: SHARED }),
    );
    expect(claims.uid).toBe(scimUserA); // tenant A's row, not tenant B's
    expect(claims.tid).toBe(tenantA);
    expect(claims.sub).toBe(`saml:${tenantA}:nameid-1`);

    // Tenant B's same-email user is untouched.
    const [b] = await db.client.withSystem((tx) =>
      tx
        .select({ sub: db.schema.users.oidcSubject })
        .from(db.schema.users)
        .where(and(eq(db.schema.users.email, SHARED), eq(db.schema.users.tenantId, tenantB))),
    );
    expect(b!.sub).toBe("okta|b-real");
  });

  it("matches a returning SAML user by subject on the next login", async () => {
    const again = await db.client.withSystem((tx) =>
      provision.provisionSamlWithinTx(tx, tenantA, { sub: `saml:${tenantA}:nameid-1`, email: SHARED }),
    );
    expect(again.uid).toBe(scimUserA);
  });

  it("consumes a pending invitation in the tenant", async () => {
    const claims = await db.client.withSystem((tx) =>
      provision.provisionSamlWithinTx(tx, tenantA, { sub: `saml:${tenantA}:nameid-2`, email: "Invitee@acme.test" }),
    );
    expect(claims.role).toBe("manager");
    expect(claims.tid).toBe(tenantA);
  });

  it("rejects an identity with no account in the tenant", async () => {
    await expect(
      db.client.withSystem((tx) =>
        provision.provisionSamlWithinTx(tx, tenantA, { sub: `saml:${tenantA}:stranger`, email: "stranger@nowhere.test" }),
      ),
    ).rejects.toBeInstanceOf(errors.UnauthorizedError);
  });

  it("saves SAML config; refuses to enable without a cert", async () => {
    await runAs(identity(tenantA, ownerA), "settings:manage", "saml-save-1", (ctx) =>
      sso.saveSamlConfigOp(ctx, { enabled: true, idpEntityId: "https://idp/meta", idpSsoUrl: "https://idp/sso", idpCert: "CERTBODY" }),
    );
    const [row] = await db.client.withSystem((tx) =>
      tx.select({ on: db.schema.ssoConfig.samlEnabled, url: db.schema.ssoConfig.samlIdpSsoUrl }).from(db.schema.ssoConfig).where(eq(db.schema.ssoConfig.tenantId, tenantA)),
    );
    expect(row!.on).toBe(true);
    expect(row!.url).toBe("https://idp/sso");

    await expect(
      runAs(identity(tenantA, ownerA), "settings:manage", "saml-save-bad", (ctx) =>
        sso.saveSamlConfigOp(ctx, { enabled: true, idpEntityId: null, idpSsoUrl: null, idpCert: null }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});
