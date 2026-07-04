import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Proactive playbook triggers (Wave 2). Verifies the Command loader detects the three
 * new PROACTIVE situations end-to-end: funding re-match (an open deal eligible for a
 * program it has not applied for), evidence_expired (approved evidence already lapsed),
 * and stalled_deal (a high-value deal gone cold) — and that the shipped playbook engine
 * fires on the funding_rematch trigger (a materialized playbook_runs row), all under RLS.
 */

let db: TestDb;
let load: typeof import("@/domain/command/load");
let brief: typeof import("@/domain/command/brief");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let rematchPbId = "";

const idA = () => ({ tenantId: tenantA, userId: ownerA, role: "owner" });
const idB = () => ({ tenantId: tenantB, userId: ownerB, role: "owner" });
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/command/load");
  brief = await import("@/domain/command/brief");
  const { withSystem } = db.client;
  const { tenants, users, programs, opportunities, evidence, playbooks } = db.schema;

  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "own-a", email: "a@a.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "own-b", email: "b@b.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = us.find((u) => u.sub === "own-a")!.id;
    ownerB = us.find((u) => u.sub === "own-b")!.id;

    // Tenant A holds an active Competency, so competency_required is satisfied (WAFR eligible).
    await tx.insert(programs).values({
      tenantId: tenantA,
      libraryKey: "migration_competency",
      name: "Migration Competency",
      programType: "Competency",
      deliveryModel: "Consulting",
      fundingFit: "high",
      status: "active",
      createdBy: ownerA,
    });

    // Absolute anchor dates: "2026-01-01" is well in the past (stale + expired) vs the real
    // today; "2099-01-01" is future (fresh). No funding_submissions rows for A's deals -> the
    // eligible programs are all un-applied -> funding_rematch fires.
    await tx.insert(opportunities).values([
      // Open, fundable, amazon-originated, $80k, FRESH -> funding_rematch (not stalled).
      { tenantId: tenantA, name: "Initech pilot", status: "open", stage: "qualified", amount: 80000, source: "amazon_originated", lastInteraction: "2099-01-01", nextStep: "Scope PoC", externalId: "PC-A1" },
      // Open, high-value, COLD -> stalled_deal (and also a rematch candidate).
      { tenantId: tenantA, name: "Cold whale", status: "open", stage: "business_validation", amount: 300000, source: "partner_originated", lastInteraction: "2026-01-01", nextStep: "Re-engage", externalId: "PC-A2" },
      // Tenant B's own fundable deal (must never appear in A's re-match).
      { tenantId: tenantB, name: "B deal", status: "open", stage: "qualified", amount: 200000, source: "amazon_originated", lastInteraction: "2026-01-01", nextStep: "x" },
    ]);

    // Approved evidence that has already lapsed -> evidence_expired (tenant A only).
    await tx.insert(evidence).values({
      tenantId: tenantA,
      title: "SOC 2 (lapsed)",
      status: "approved",
      expirationDate: "2026-01-01",
    });

    // A playbook that fires on the proactive funding_rematch trigger.
    const pb = await tx
      .insert(playbooks)
      .values({
        tenantId: tenantA,
        name: "Chase un-applied funding",
        triggerSituation: "funding_rematch",
        triggerMinSeverity: "medium",
        actionType: "notify",
        createdBy: ownerA,
      })
      .returning({ id: playbooks.id });
    rematchPbId = pb[0]!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("proactive playbook triggers", () => {
  it("loadCommandData populates fundingRematch and derives all three new situations", async () => {
    const data = await load.loadCommandData(idA());
    const candidates = data.inputs.fundingRematch ?? [];
    expect(candidates.length).toBeGreaterThan(0);
    // Every candidate carries at least one eligible, un-applied program.
    expect(candidates.every((c) => c.programs.length > 0)).toBe(true);

    const decisions = brief.deriveDecisions(data.inputs, today());
    const situations = new Set(decisions.map((d) => d.situation));
    expect(situations.has("funding_rematch")).toBe(true);
    expect(situations.has("stalled_deal")).toBe(true);
    expect(situations.has("evidence_expired")).toBe(true);
    // The cold whale is BOTH a stalled deal and a re-match candidate (distinct decision ids).
    expect(decisions.some((d) => d.situation === "stalled_deal" && d.id.startsWith("opp-"))).toBe(true);
    expect(decisions.some((d) => d.situation === "funding_rematch" && d.id.startsWith("rematch-"))).toBe(true);
  });

  it("materializes a playbook_run for the funding_rematch trigger (the engine acts on the proactive signal)", async () => {
    // Materialize-on-read: maybeRunPlaybooks runs inside loadCommandData (recommend_only default).
    await load.loadCommandData(idA());
    const runs = await db.client.withSystem(async (tx) =>
      tx.select().from(db.schema.playbookRuns).where(eq(db.schema.playbookRuns.playbookId, rematchPbId)),
    );
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => (r.decisionId as string).startsWith("rematch-"))).toBe(true);
  });

  it("isolates the re-match under RLS — tenant B never sees tenant A's deals or evidence", async () => {
    const data = await load.loadCommandData(idB());
    const names = (data.inputs.fundingRematch ?? []).map((c) => c.oppName);
    expect(names).not.toContain("Cold whale");
    expect(names).not.toContain("Initech pilot");
    const situations = new Set(brief.deriveDecisions(data.inputs, today()).map((d) => d.situation));
    expect(situations.has("evidence_expired")).toBe(false); // A's lapsed evidence must not leak
  });
});
