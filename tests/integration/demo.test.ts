import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Public "Book a demo" intake: the operation persists a tenant-free lead through
 * the system path, and the public server action validates input, honors the
 * honeypot, and rejects bad payloads. Runs against a real embedded Postgres so
 * the migration (drizzle/0032) is exercised exactly as in production.
 */

let db: TestDb;
let ops: typeof import("@/domain/demo/operations");
let actions: typeof import("@/domain/demo/actions");

async function allRequests() {
  const { withSystem } = db.client;
  const { demoRequests } = db.schema;
  return withSystem((tx) => tx.select().from(demoRequests));
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  db = await setupTestDb();
  ops = await import("@/domain/demo/operations");
  actions = await import("@/domain/demo/actions");
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("demo requests", () => {
  it("createDemoRequestOp persists a lead with defaults", async () => {
    const before = (await allRequests()).length;
    const { id } = await ops.createDemoRequestOp({
      name: "Jordan Lee",
      email: "jordan@acme.com",
      company: "Acme Partners",
      teamSize: "11-50",
      message: "Pursuing two competencies.",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await allRequests();
    expect(rows.length).toBe(before + 1);
    const row = rows.find((r) => r.id === id)!;
    expect(row.email).toBe("jordan@acme.com");
    expect(row.company).toBe("Acme Partners");
    expect(row.teamSize).toBe("11-50");
    expect(row.status).toBe("new");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("stores optional fields as null when omitted", async () => {
    const { id } = await ops.createDemoRequestOp({
      name: "Sam Rivera",
      email: "sam@globex.com",
      company: "Globex",
      teamSize: null,
      message: null,
    });
    const row = (await allRequests()).find((r) => r.id === id)!;
    expect(row.teamSize).toBeNull();
    expect(row.message).toBeNull();
  });

  it("submitDemoRequest accepts a valid submission", async () => {
    const before = (await allRequests()).length;
    const state = await actions.submitDemoRequest(
      { ok: false },
      form({ name: "Pat Kim", email: "pat@initech.com", company: "Initech", teamSize: "51-200" }),
    );
    expect(state.ok).toBe(true);
    expect((await allRequests()).length).toBe(before + 1);
  });

  it("drops honeypot-filled submissions silently (no row, reports ok)", async () => {
    const before = (await allRequests()).length;
    const state = await actions.submitDemoRequest(
      { ok: false },
      form({ name: "Bot", email: "bot@spam.com", company: "Spam Co", companyUrl: "http://spam.example" }),
    );
    expect(state.ok).toBe(true);
    expect((await allRequests()).length).toBe(before);
  });

  it("rejects an invalid email and writes nothing", async () => {
    const before = (await allRequests()).length;
    const state = await actions.submitDemoRequest(
      { ok: false },
      form({ name: "No Email", email: "not-an-email", company: "Nope" }),
    );
    expect(state.ok).toBe(false);
    expect(state.error).toBeTruthy();
    expect((await allRequests()).length).toBe(before);
  });

  it("rejects a missing company", async () => {
    const state = await actions.submitDemoRequest(
      { ok: false },
      form({ name: "X", email: "x@y.com", company: "" }),
    );
    expect(state.ok).toBe(false);
  });
});
