/**
 * Pure reconciliation between local ACE opportunities (the editable source of
 * record) and the read-only Partner Central mirror. No database, no clock — the
 * caller passes already-loaded rows. Deterministic and unit-testable.
 *
 * Local opps with a null externalId are manual / partner-originated and never came
 * from AWS, so they're excluded entirely — they have nothing to reconcile against
 * and must never be touched by an "accept AWS" write-back.
 */

export type ReconcileClass = "in_sync" | "drift" | "local_only" | "mirror_only";

export type ReconcileField = "stage" | "status" | "amount" | "name";

export interface FieldDiff<T> {
  readonly local: T;
  readonly mirror: T;
  readonly changed: boolean;
}

export interface ReconcileRow {
  readonly externalId: string;
  /** The local opportunity id, or null for a mirror_only row (no local opp yet). */
  readonly localId: string | null;
  readonly name: string;
  readonly accountName: string;
  readonly classification: ReconcileClass;
  readonly fields: {
    readonly stage: FieldDiff<string>;
    readonly status: FieldDiff<string>;
    readonly amount: FieldDiff<number>;
    readonly name: FieldDiff<string>;
  };
  readonly driftFields: readonly ReconcileField[];
}

export interface ReconcileLocalOpp {
  readonly id: string;
  readonly externalId: string | null;
  readonly name: string;
  readonly accountName: string;
  readonly stage: string;
  readonly status: string;
  readonly amount: number;
}

export interface ReconcileMirrorOpp {
  readonly externalId: string;
  readonly name: string;
  readonly accountName: string;
  readonly stage: string;
  readonly status: string;
  readonly amount: number;
}

// Actionable rows (drift) first; then new-in-AWS, stale links, and matches.
const CLASS_RANK: Record<ReconcileClass, number> = {
  drift: 0,
  mirror_only: 1,
  local_only: 2,
  in_sync: 3,
};

function strDiff(local: string, mirror: string): FieldDiff<string> {
  return { local, mirror, changed: local !== mirror };
}
function numDiff(local: number, mirror: number): FieldDiff<number> {
  return { local, mirror, changed: local !== mirror };
}

/**
 * Classify every AWS-linked opportunity as in_sync / drift / local_only / mirror_only,
 * with a per-field local-vs-AWS diff. Sorted drift-first (the rows a human acts on),
 * then by externalId for stability.
 */
export function reconcileOpportunities(
  local: readonly ReconcileLocalOpp[],
  mirror: readonly ReconcileMirrorOpp[],
): ReconcileRow[] {
  const localByExt = new Map<string, ReconcileLocalOpp>();
  for (const o of local) {
    if (o.externalId !== null) localByExt.set(o.externalId, o);
  }
  const mirrorByExt = new Map<string, ReconcileMirrorOpp>();
  for (const m of mirror) mirrorByExt.set(m.externalId, m);

  const rows: ReconcileRow[] = [];

  // Local opps linked to AWS (non-null externalId) → in_sync / drift / local_only.
  for (const [ext, o] of localByExt.entries()) {
    const m = mirrorByExt.get(ext);
    if (!m) {
      rows.push({
        externalId: ext,
        localId: o.id,
        name: o.name,
        accountName: o.accountName,
        classification: "local_only",
        fields: {
          stage: strDiff(o.stage, o.stage),
          status: strDiff(o.status, o.status),
          amount: numDiff(o.amount, o.amount),
          name: strDiff(o.name, o.name),
        },
        driftFields: [],
      });
      continue;
    }
    const fields = {
      stage: strDiff(o.stage, m.stage),
      status: strDiff(o.status, m.status),
      amount: numDiff(o.amount, m.amount),
      name: strDiff(o.name, m.name),
    };
    const driftFields: ReconcileField[] = [];
    if (fields.stage.changed) driftFields.push("stage");
    if (fields.status.changed) driftFields.push("status");
    if (fields.amount.changed) driftFields.push("amount");
    if (fields.name.changed) driftFields.push("name");
    rows.push({
      externalId: ext,
      localId: o.id,
      name: m.name || o.name,
      accountName: m.accountName || o.accountName,
      classification: driftFields.length > 0 ? "drift" : "in_sync",
      fields,
      driftFields,
    });
  }

  // Mirror rows with no local opp → mirror_only (a new AWS deal not yet in ACE).
  for (const m of mirror) {
    if (localByExt.has(m.externalId)) continue;
    rows.push({
      externalId: m.externalId,
      localId: null,
      name: m.name,
      accountName: m.accountName,
      classification: "mirror_only",
      fields: {
        stage: strDiff(m.stage, m.stage),
        status: strDiff(m.status, m.status),
        amount: numDiff(m.amount, m.amount),
        name: strDiff(m.name, m.name),
      },
      driftFields: [],
    });
  }

  return rows.sort((a, b) => {
    const r = CLASS_RANK[a.classification] - CLASS_RANK[b.classification];
    return r !== 0 ? r : a.externalId.localeCompare(b.externalId);
  });
}

/** Count of drifted (actionable) rows — the "N opportunities differ from AWS" number. */
export function driftCount(rows: readonly ReconcileRow[]): number {
  return rows.filter((r) => r.classification === "drift").length;
}

export interface ReconcileSummary {
  readonly inSync: number;
  readonly drift: number;
  readonly localOnly: number;
  readonly mirrorOnly: number;
}

/** Roll classified rows into per-class counts for the header strip. */
export function reconcileSummary(rows: readonly ReconcileRow[]): ReconcileSummary {
  const s = { inSync: 0, drift: 0, localOnly: 0, mirrorOnly: 0 };
  for (const r of rows) {
    if (r.classification === "in_sync") s.inSync++;
    else if (r.classification === "drift") s.drift++;
    else if (r.classification === "local_only") s.localOnly++;
    else s.mirrorOnly++;
  }
  return s;
}
