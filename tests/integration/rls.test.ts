import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Tenant isolation is the load-bearing security property (Rule 2). These tests
 * run against a REAL Postgres and FAIL if isolation breaks (Rule 6). The central
 * claim: a query that forgets to scope returns this tenant's rows only — never
 * another tenant's — because RLS, not app code, does the filtering.
 */

let db: TestDb;
const tenantA = "11111111-1111-1111-1111-111111111111";
const tenantB = "22222222-2222-2222-2222-222222222222";
let userA: string;
let userB: string;

beforeAll(async () => {
  db = await setupTestDb();
  const { withSystem } = db.client;
  const { tenants, users } = db.schema;

  // Provisioning happens via the privileged path (no session yet).
  await withSystem(async (tx) => {
    await tx
      .insert(tenants)
      .values([
        { id: tenantA, name: "Acme", slug: "acme" },
        { id: tenantB, name: "Globex", slug: "globex" },
      ]);
    const [a] = await tx
      .insert(users)
      .values({
        tenantId: tenantA,
        oidcSubject: "sub-a",
        email: "a@acme.test",
        role: "owner",
      })
      .returning({ id: users.id });
    const [b] = await tx
      .insert(users)
      .values({
        tenantId: tenantB,
        oidcSubject: "sub-b",
        email: "b@globex.test",
        role: "owner",
      })
      .returning({ id: users.id });
    userA = a!.id;
    userB = b!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

function idFor(tenantId: string, userId: string) {
  return { tenantId, userId, role: "owner" };
}

describe("RLS tenant isolation", () => {
  it("an unscoped SELECT returns only the current tenant's rows", async () => {
    const { withTenant } = db.client;
    const { users } = db.schema;

    const seenByA = await withTenant(idFor(tenantA, userA), (tx) =>
      tx.select({ id: users.id, email: users.email }).from(users),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.email).toBe("a@acme.test");

    const seenByB = await withTenant(idFor(tenantB, userB), (tx) =>
      tx.select({ id: users.id, email: users.email }).from(users),
    );
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.email).toBe("b@globex.test");
  });

  it("cannot read another tenant's row even when explicitly targeting its id", async () => {
    const { withTenant } = db.client;
    const { users } = db.schema;

    const rows = await withTenant(idFor(tenantA, userA), (tx) =>
      tx.select().from(users).where(eq(users.id, userB)),
    );
    expect(rows).toHaveLength(0); // RLS makes B's row invisible to A
  });

  it("WITH CHECK blocks inserting a row for another tenant", async () => {
    const { withTenant } = db.client;
    const { users } = db.schema;

    await expect(
      withTenant(idFor(tenantA, userA), (tx) =>
        tx.insert(users).values({
          tenantId: tenantB, // forging another tenant's id
          oidcSubject: "forged",
          email: "forged@globex.test",
          role: "member",
        }),
      ),
    ).rejects.toThrow();
  });

  it("with no tenant GUC set, the app role sees zero rows (fail closed)", async () => {
    // Drive a transaction as partneros_app WITHOUT setting app.tenant_id.
    const { withSystem } = db.client;
    const { users } = db.schema;

    const count = await withSystem(async (tx) => {
      await tx.execute(sql.raw("set local role partneros_app"));
      const rows = await tx.select({ id: users.id }).from(users);
      return rows.length;
    });
    expect(count).toBe(0);
  });

  it("the privileged path can see all tenants (confirming data really exists)", async () => {
    const { withSystem } = db.client;
    const { users } = db.schema;
    const all = await withSystem((tx) =>
      tx.select({ id: users.id }).from(users),
    );
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
