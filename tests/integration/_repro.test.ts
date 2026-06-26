import { beforeAll, afterAll, describe, it } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

let db: TestDb;
let provision: typeof import("@/auth/provision");

beforeAll(async () => {
  db = await setupTestDb();
  provision = await import("@/auth/provision");
}, 120_000);
afterAll(async () => {
  await db?.stop();
});

function summarize(label: string, results: PromiseSettledResult<{ uid: string; tid: string }>[]) {
  // eslint-disable-next-line no-console
  console.log(
    `\n[REPRO ${label}]`,
    JSON.stringify(
      results.map((r) =>
        r.status === "fulfilled"
          ? { ok: true, uid: r.value.uid, tid: r.value.tid }
          : { ok: false, err: (r.reason as Error).message },
      ),
      null,
      2,
    ),
  );
}

describe("REPRO re-login 500", () => {
  it("A) sequential double local-dev provision, identical claims", async () => {
    const claims = { sub: "dev-user", email: "dev@partneros.local" };
    const results: PromiseSettledResult<{ uid: string; tid: string }>[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        const c = await db.client.withSystem((tx) => provision.provisionWithinTx(tx, claims, true));
        results.push({ status: "fulfilled", value: c } as PromiseFulfilledResult<typeof c>);
      } catch (err) {
        results.push({ status: "rejected", reason: err } as PromiseRejectedResult);
      }
    }
    summarize("A sequential same-claims", results);
  });

  it("B) concurrent double local-dev provision, identical claims (race)", async () => {
    const claims = { sub: "race-user", email: "race@partneros.local" };
    const results = await Promise.allSettled([
      db.client.withSystem((tx) => provision.provisionWithinTx(tx, claims, true)),
      db.client.withSystem((tx) => provision.provisionWithinTx(tx, claims, true)),
    ]);
    summarize("B concurrent same-claims", results);
  });

  it("C) two different subs that normalize to the same dev slug", async () => {
    // slug = `dev-${sub}`.replace(/[^a-z0-9-]/g,'-'). 'a|b' and 'a-b' collide.
    const results: PromiseSettledResult<{ uid: string; tid: string }>[] = [];
    for (const sub of ["okta|same", "okta-same"]) {
      try {
        const c = await db.client.withSystem((tx) =>
          provision.provisionWithinTx(tx, { sub, email: `${sub}@x.test` }, true),
        );
        results.push({ status: "fulfilled", value: c } as PromiseFulfilledResult<typeof c>);
      } catch (err) {
        results.push({ status: "rejected", reason: err } as PromiseRejectedResult);
      }
    }
    summarize("C slug-collision", results);
  });
});
