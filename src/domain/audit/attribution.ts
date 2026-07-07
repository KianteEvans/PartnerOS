/**
 * Agency act-as attribution for the audit trail (pure half).
 *
 * When an OBP (agency) operator acts inside a managed customer workspace, the
 * mutation gate records the action under the synthetic agency service user but
 * stamps the REAL operator + agency into the audit row's metadata jsonb
 * (src/gate/mutation-gate.ts):
 *   metadata.agencyOperator  -> operator's user id IN THE AGENCY tenant
 *   metadata.actingAsAgency  -> the agency tenant id
 * Both are cross-tenant ids, so resolving them to an email + agency name is the
 * server loader's job (attribution-load.ts, via withSystem). This module is the
 * PURE half: pull the ids out of the untyped metadata and format the label.
 */

export interface OperatorRef {
  readonly agencyId: string;
  readonly operatorId: string;
}

/**
 * Extract the act-as attribution from one audit row's metadata, or null when the
 * action was performed directly (not delegated through an agency operator).
 */
export function operatorRefFromMetadata(metadata: unknown): OperatorRef | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const agencyId = m.actingAsAgency;
  const operatorId = m.agencyOperator;
  if (typeof agencyId === "string" && agencyId && typeof operatorId === "string" && operatorId) {
    return { agencyId, operatorId };
  }
  return null;
}

/** The DISTINCT operator+agency pairs referenced across a set of audit metadatas. */
export function collectOperatorRefs(metadatas: readonly unknown[]): OperatorRef[] {
  const seen = new Set<string>();
  const refs: OperatorRef[] = [];
  for (const meta of metadatas) {
    const ref = operatorRefFromMetadata(meta);
    if (!ref) continue;
    const key = `${ref.agencyId}:${ref.operatorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** Human label for a resolved attribution, e.g. "acted by jane@obp.com via OBP". */
export function formatAttribution(
  operatorEmail: string | undefined,
  agencyName: string | undefined,
): string {
  const who = operatorEmail ?? "an agency operator";
  return agencyName ? `acted by ${who} via ${agencyName}` : `acted by ${who}`;
}
